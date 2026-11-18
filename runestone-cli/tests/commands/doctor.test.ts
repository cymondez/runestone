import * as p from '@clack/prompts';
import { createProgram } from '../../src/cli';
import { checkEnvironment, installDoctorCheck } from '../../src/services/environment-doctor';
import { envLoader } from '../../src/utils/env-loader';
import { testEnv } from '../helpers/env';

jest.mock('../../src/services/environment-doctor', () => ({
  ...jest.requireActual('../../src/services/environment-doctor'),
  checkEnvironment: jest.fn(),
  installDoctorCheck: jest.fn()
}));

jest.mock('../../src/utils/env-loader', () => ({
  ...jest.requireActual('../../src/utils/env-loader'),
  envLoader: {
    ...jest.requireActual('../../src/utils/env-loader').envLoader,
    load: jest.fn()
  }
}));

jest.mock('@clack/prompts', () => ({
  intro: jest.fn(),
  outro: jest.fn(),
  cancel: jest.fn(),
  confirm: jest.fn(),
  isCancel: jest.fn(() => false),
  spinner: jest.fn(() => ({ start: jest.fn(), stop: jest.fn() })),
  log: { info: jest.fn(), success: jest.fn(), warn: jest.fn(), error: jest.fn() }
}));

describe('doctor without a terminal', () => {
  const originalIsTTY = process.stdin.isTTY;
  let exitSpy: jest.SpyInstance;

  beforeEach(() => {
    process.env.RUNESTONE_LANG = 'en';
    Object.defineProperty(process.stdin, 'isTTY', { value: undefined, configurable: true });
    exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    (envLoader.load as jest.Mock).mockReturnValue(testEnv('/tmp/runestone-doctor-test', { DNS_ENABLE: 'false' }));
    (checkEnvironment as jest.Mock).mockReturnValue({
      passed: false,
      checks: [
        {
          id: 'certutil',
          label: 'NSS certutil',
          status: 'fail',
          required: 'certutil',
          message: 'not found',
          canInstall: true
        }
      ]
    });
  });

  afterEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
    exitSpy.mockRestore();
    delete process.env.RUNESTONE_LANG;
    jest.clearAllMocks();
  });

  it('installs nothing, says how to get it installed, and still fails', async () => {
    // The confirm opened a terminal on stdin and crashed in an agent's shell.
    // With nobody to ask, nothing may be installed.
    await createProgram().parseAsync(['node', 'runestone', 'doctor']);

    expect(p.confirm).not.toHaveBeenCalled();
    expect(installDoctorCheck).not.toHaveBeenCalled();
    expect((p.log.warn as jest.Mock).mock.calls.join(' ')).toContain('run `runestone doctor` in a terminal');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('still asks in a terminal', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    (p.confirm as jest.Mock).mockResolvedValue(false);

    await createProgram().parseAsync(['node', 'runestone', 'doctor']);

    expect(p.confirm).toHaveBeenCalledTimes(1);
    expect(installDoctorCheck).not.toHaveBeenCalled();
  });
});
