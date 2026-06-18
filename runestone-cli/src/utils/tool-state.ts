import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

interface ToolState {
  runestonePath?: string;
  locale?: string;
}

function packageRoot(): string {
  return path.resolve(__dirname, '..', '..');
}

function stateFilePath(): string {
  return process.env.RUNESTONE_TOOL_STATE_PATH || path.join(os.homedir(), '.runestone', 'runestone.config.json');
}

function readState(): ToolState {
  const statePath = stateFilePath();
  if (!fs.existsSync(statePath)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf8')) as ToolState;
  } catch {
    return {};
  }
}

function writeState(nextState: ToolState): void {
  const statePath = stateFilePath();
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(
    statePath,
    `${JSON.stringify(nextState, null, 2)}\n`,
    'utf8'
  );
}

export const toolState = {
  packageRoot,
  stateFilePath,

  readRunestonePath(): string | undefined {
    const runestonePath = readState().runestonePath;
    return runestonePath ? path.resolve(runestonePath) : undefined;
  },

  readLocale(): string | undefined {
    return readState().locale;
  },

  writeRunestonePath(runestonePath: string): void {
    writeState({ ...readState(), runestonePath: path.resolve(runestonePath) });
  },

  writeLocale(locale: string): void {
    writeState({ ...readState(), locale });
  },

  writeSetupState(state: { runestonePath: string; locale: string }): void {
    writeState({
      ...readState(),
      runestonePath: path.resolve(state.runestonePath),
      locale: state.locale
    });
  }
};
