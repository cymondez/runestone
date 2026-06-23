import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  removeDynamicConfigFile,
  runInDynamicConfigBatch,
  writeDynamicConfigFile
} from '../../src/services/dynamic-config-manager';
import { composeService } from '../../src/services/docker-compose';

jest.mock('../../src/services/docker-compose', () => ({
  composeService: {
    ps: jest.fn(() => [{ State: 'running' }]),
    restart: jest.fn()
  }
}));

const restartMock = composeService.restart as jest.MockedFunction<typeof composeService.restart>;

describe('dynamic-config-manager', () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  let tempDir: string;
  let logSpy: jest.SpyInstance<void, Parameters<typeof console.log>>;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runestone-dynamic-config-'));
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
    logSpy.mockRestore();
    fs.rmSync(tempDir, { recursive: true, force: true });
    jest.clearAllMocks();
  });

  it('restarts once for multiple async writes in one batch', async () => {
    const composeFilePath = path.join(tempDir, 'compose.yml');

    await runInDynamicConfigBatch({ composeFilePath }, async () => {
      writeDynamicConfigFile(path.join(tempDir, 'configuration', 'one.yml'), 'one\n', { composeFilePath });
      await Promise.resolve();
      writeDynamicConfigFile(path.join(tempDir, 'configuration', 'two.yml'), 'two\n', { composeFilePath });
    });

    expect(restartMock).toHaveBeenCalledTimes(1);
    expect(restartMock).toHaveBeenCalledWith(composeFilePath);
  });

  it('shares the outer batch with nested batches', async () => {
    const composeFilePath = path.join(tempDir, 'compose.yml');

    await runInDynamicConfigBatch({ composeFilePath }, async () => {
      await runInDynamicConfigBatch({ composeFilePath }, async () => {
        writeDynamicConfigFile(path.join(tempDir, 'configuration', 'nested.yml'), 'nested\n', { composeFilePath });
      });
      writeDynamicConfigFile(path.join(tempDir, 'configuration', 'outer.yml'), 'outer\n', { composeFilePath });
    });

    expect(restartMock).toHaveBeenCalledTimes(1);
  });

  it('restarts once for multiple removals in one batch', async () => {
    const composeFilePath = path.join(tempDir, 'compose.yml');
    const first = path.join(tempDir, 'configuration', 'one.yml');
    const second = path.join(tempDir, 'configuration', 'two.yml');
    fs.mkdirSync(path.dirname(first), { recursive: true });
    fs.writeFileSync(first, 'one\n', 'utf8');
    fs.writeFileSync(second, 'two\n', 'utf8');

    await runInDynamicConfigBatch({ composeFilePath }, () => {
      removeDynamicConfigFile(first, { composeFilePath });
      removeDynamicConfigFile(second, { composeFilePath });
    });

    expect(restartMock).toHaveBeenCalledTimes(1);
  });

  it('restarts on non-Windows platforms too', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const composeFilePath = path.join(tempDir, 'compose.yml');

    await runInDynamicConfigBatch({ composeFilePath }, () => {
      writeDynamicConfigFile(path.join(tempDir, 'configuration', 'linux.yml'), 'linux\n', { composeFilePath });
    });

    expect(restartMock).toHaveBeenCalledTimes(1);
    expect(restartMock).toHaveBeenCalledWith(composeFilePath);
  });
});
