import * as fs from 'fs';
import * as path from 'path';
import { osDetector } from '../utils/os-detector';
import { runService } from './docker-run';
import { volumeService } from './docker-volume';

const DEFAULT_VOLUME_NAME = 'runestone-ssh';
const SSH_MOUNT_PATH = '/root/.ssh';
const PRIVATE_KEY_NAMES = new Set(['id_rsa', 'id_ecdsa', 'id_ed25519', 'id_dsa']);

function isPrivateKeyFile(filePath: string): boolean {
  return PRIVATE_KEY_NAMES.has(path.basename(filePath));
}

function quoteForShell(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function ensureVolume(volumeName: string): void {
  if (!volumeService.exists(volumeName)) {
    volumeService.createVolume(volumeName);
  }
}

function writeFileToVolume(volumeName: string, basename: string, content: string, mode?: string): void {
  const target = `${SSH_MOUNT_PATH}/${basename}`;
  const fileMode = mode ?? '644';

  runService.run('alpine:latest', ['sh', '-c', 'dd of="$1"; chmod "$2" "$1"', 'sh', target, fileMode], {
    rm: true,
    interactive: true,
    volumes: [{ source: volumeName, target: SSH_MOUNT_PATH }],
    input: content
  });
}

export const sshManager = {
  scanHomeDirectory(): string[] {
    const sshDir = osDetector.sshDir();
    if (!fs.existsSync(sshDir)) {
      return [];
    }

    return fs
      .readdirSync(sshDir)
      .map((file) => path.join(sshDir, file))
      .filter((file) => fs.statSync(file).isFile() && isPrivateKeyFile(file));
  },

  listKeys(volumeName = DEFAULT_VOLUME_NAME): string[] {
    try {
      const output = runService.run(
        'alpine:latest',
        [
          'sh',
          '-c',
          'for f in "$1"/*; do [ -f "$f" ] || continue; case "$f" in *.pub) continue;; esac; basename "$f"; done',
          'sh',
          SSH_MOUNT_PATH
        ],
        {
          rm: true,
          volumes: [{ source: volumeName, target: SSH_MOUNT_PATH }]
        }
      );

      return output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    } catch {
      return [];
    }
  },

  addKey(keyPath: string, volumeName = DEFAULT_VOLUME_NAME): boolean {
    const absolutePath = path.resolve(keyPath);
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`SSH key not found: ${absolutePath}`);
    }
    if (!fs.statSync(absolutePath).isFile()) {
      throw new Error(`SSH key is not a file: ${absolutePath}`);
    }
    if (!isPrivateKeyFile(absolutePath)) {
      throw new Error(`File '${path.basename(absolutePath)}' is not a supported SSH private key name`);
    }

    ensureVolume(volumeName);
    const basename = path.basename(absolutePath);
    writeFileToVolume(volumeName, basename, fs.readFileSync(absolutePath, 'utf8'), '600');

    const publicKeyPath = `${absolutePath}.pub`;
    if (fs.existsSync(publicKeyPath) && fs.statSync(publicKeyPath).isFile()) {
      writeFileToVolume(volumeName, `${basename}.pub`, fs.readFileSync(publicKeyPath, 'utf8'));
    }

    return true;
  },

  addKeys(keys?: string[], volumeName = DEFAULT_VOLUME_NAME): void {
    const keyPaths = keys ?? this.scanHomeDirectory();
    for (const keyPath of keyPaths) {
      this.addKey(keyPath, volumeName);
    }
  }
};
