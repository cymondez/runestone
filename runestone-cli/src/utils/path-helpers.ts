import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function maybeComposeFile(projectOrFile: string): string {
  const resolved = path.resolve(projectOrFile);
  const ext = path.extname(resolved).toLowerCase();

  if (ext === '.yml' || ext === '.yaml') {
    return resolved;
  }

  const yamlPath = path.join(resolved, 'compose.yaml');
  if (fs.existsSync(yamlPath)) {
    return yamlPath;
  }

  return path.join(resolved, 'compose.yml');
}

export const pathHelpers = {
  runestoneDir(): string {
    return path.join(os.homedir(), '.runestone');
  },

  resolveProjectDir(projectArg?: string): string {
    if (!projectArg) {
      return this.runestoneDir();
    }

    const resolved = path.resolve(projectArg);
    const ext = path.extname(resolved).toLowerCase();
    if (ext === '.yml' || ext === '.yaml') {
      return path.dirname(resolved);
    }

    return resolved;
  },

  resolveComposePath(projectArg?: string): string {
    if (!projectArg) {
      return path.join(this.runestoneDir(), 'compose.yml');
    }

    return maybeComposeFile(projectArg);
  },

  resolveEnvPath(cliArg?: string, projectDir?: string): string {
    if (cliArg) {
      return path.resolve(cliArg);
    }

    const cwdEnv = path.resolve(process.cwd(), '.env');
    if (fs.existsSync(cwdEnv)) {
      return cwdEnv;
    }

    return path.join(projectDir ?? this.runestoneDir(), '.env');
  },

  ensureDir(dir: string): void {
    fs.mkdirSync(path.resolve(dir), { recursive: true });
  },

  normalizePath(value: string): string {
    if (process.platform !== 'win32') {
      return value;
    }

    const drivePath = /^([a-zA-Z]):\\(.*)$/.exec(value);
    if (!drivePath) {
      return value;
    }

    const drive = drivePath[1].toLowerCase();
    const rest = drivePath[2].replace(/\\/g, '/');
    return `/mnt/${drive}/${rest}`;
  }
};
