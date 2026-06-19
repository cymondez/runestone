import * as fs from 'fs';
import * as path from 'path';
import { composeService } from './docker-compose';
import { logger } from '../utils/logger';
import { pathHelpers } from '../utils/path-helpers';
import { t } from '../i18n';

export interface DynamicConfigRuntime {
  composeFilePath?: string;
}

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

export function writeDynamicConfigFile(filePath: string, content: string, runtime?: DynamicConfigRuntime): boolean {
  pathHelpers.ensureDir(path.dirname(filePath));
  if (fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8') === content) {
    return false;
  }

  fs.writeFileSync(filePath, content, 'utf8');
  restartRunestoneOnWindows(runtime, true);
  return true;
}

export function removeDynamicConfigFile(filePath: string, runtime?: DynamicConfigRuntime): boolean {
  if (!fs.existsSync(filePath)) {
    return false;
  }

  fs.unlinkSync(filePath);
  restartRunestoneOnWindows(runtime, true);
  return true;
}
