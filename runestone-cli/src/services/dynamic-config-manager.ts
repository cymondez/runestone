import * as fs from 'fs';
import * as path from 'path';
import { AsyncLocalStorage } from 'async_hooks';
import { composeService } from './docker-compose';
import { logger } from '../utils/logger';
import { pathHelpers } from '../utils/path-helpers';
import { t } from '../i18n';

export interface DynamicConfigRuntime {
  composeFilePath?: string;
}

interface DynamicConfigBatch {
  changed: boolean;
  composeFilePaths: Set<string>;
}

const batchStorage = new AsyncLocalStorage<DynamicConfigBatch>();

function restartRunestoneOnWindows(runtime: DynamicConfigRuntime | undefined, changed: boolean): void {
  if (!changed || process.platform !== 'win32' || !runtime?.composeFilePath) {
    return;
  }

  const running = composeService.ps(runtime.composeFilePath).some((container) => container.State === 'running');
  if (!running) {
    logger.warn(t('dynamicConfig.restart.notRunning'));
    return;
  }

  logger.info(t('dynamicConfig.restart.info'));
  composeService.restart(runtime.composeFilePath);
}

function markDynamicConfigChanged(runtime?: DynamicConfigRuntime): void {
  const batch = batchStorage.getStore();
  if (!batch) {
    restartRunestoneOnWindows(runtime, true);
    return;
  }

  batch.changed = true;
  if (runtime?.composeFilePath) {
    batch.composeFilePaths.add(runtime.composeFilePath);
  }
}

function flushBatch(batch: DynamicConfigBatch): void {
  if (!batch.changed) {
    return;
  }

  for (const composeFilePath of batch.composeFilePaths) {
    restartRunestoneOnWindows({ composeFilePath }, true);
  }
}

export async function runInDynamicConfigBatch<T>(
  runtime: DynamicConfigRuntime,
  action: () => Promise<T> | T
): Promise<T> {
  const activeBatch = batchStorage.getStore();
  if (activeBatch) {
    if (runtime.composeFilePath) {
      activeBatch.composeFilePaths.add(runtime.composeFilePath);
    }
    return action();
  }

  const batch: DynamicConfigBatch = {
    changed: false,
    composeFilePaths: new Set(runtime.composeFilePath ? [runtime.composeFilePath] : [])
  };

  let result: T | undefined;
  let actionError: unknown;
  try {
    result = await batchStorage.run(batch, action);
  } catch (error) {
    actionError = error;
  }

  try {
    flushBatch(batch);
  } catch (flushError) {
    if (!actionError) {
      throw flushError;
    }
    logger.warn(flushError instanceof Error ? flushError.message : String(flushError));
  }

  if (actionError) {
    throw actionError;
  }

  return result as T;
}

export function writeDynamicConfigFile(filePath: string, content: string, runtime?: DynamicConfigRuntime): boolean {
  pathHelpers.ensureDir(path.dirname(filePath));
  if (fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8') === content) {
    return false;
  }

  fs.writeFileSync(filePath, content, 'utf8');
  markDynamicConfigChanged(runtime);
  return true;
}

export function removeDynamicConfigFile(filePath: string, runtime?: DynamicConfigRuntime): boolean {
  if (!fs.existsSync(filePath)) {
    return false;
  }

  fs.unlinkSync(filePath);
  markDynamicConfigChanged(runtime);
  return true;
}
