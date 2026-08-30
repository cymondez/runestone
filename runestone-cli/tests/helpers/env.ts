import * as path from 'path';
import { DEFAULT_ENV, RunestoneEnv } from '../../src/utils/env-loader';

/**
 * A complete `RunestoneEnv` for tests, built from the shipped defaults so that
 * adding a field to the environment does not break every fixture that happens to
 * spell one out.
 */
export function testEnv(projectDir: string, overrides: Partial<RunestoneEnv> = {}): RunestoneEnv {
  return {
    ...DEFAULT_ENV,
    RUNESTONE_LANG: 'en',
    PROJECT_DIR: projectDir,
    ENV_PATH: path.join(projectDir, '.env'),
    COMPOSE_FILE_PATH: path.join(projectDir, 'compose.yml'),
    NETWORK_NAME: `${DEFAULT_ENV.PREFIX}-network`,
    SSH_VOLUME_NAME: `${DEFAULT_ENV.PREFIX}-ssh`,
    ENV_FILE_EXISTS: true,
    REQUIRED_VARS_PRESENT: true,
    ...overrides
  };
}
