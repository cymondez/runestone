import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as mkcert from '@mkcert/node';
import { installRootCa } from '../../src/services/root-ca-installer';
import { importRootCaToNssDatabases } from '../../src/services/nss-certutil';

jest.mock('@mkcert/node', () => ({
  generate: jest.fn()
}));

jest.mock('../../src/services/nss-certutil', () => ({
  ...jest.requireActual('../../src/services/nss-certutil'),
  importRootCaToNssDatabases: jest.fn()
}));

const generateMock = mkcert.generate as jest.MockedFunction<typeof mkcert.generate>;
const importNssMock = importRootCaToNssDatabases as jest.MockedFunction<typeof importRootCaToNssDatabases>;

describe('root-ca-installer', () => {
  let tempDir: string;
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');

  function mockPlatform(platform: NodeJS.Platform): void {
    Object.defineProperty(process, 'platform', { value: platform });
  }

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runestone-root-ca-'));
    generateMock.mockImplementation(async (options) => {
      if (options.certFile) {
        fs.writeFileSync(options.certFile, 'probe cert', 'utf8');
      }
      if (options.keyFile) {
        fs.writeFileSync(options.keyFile, 'probe key', 'utf8');
      }
      if (options.caroot) {
        fs.mkdirSync(options.caroot, { recursive: true });
        fs.writeFileSync(path.join(options.caroot, 'rootCA.pem'), 'root cert', 'utf8');
        fs.writeFileSync(path.join(options.caroot, 'rootCA-key.pem'), 'root key', 'utf8');
      }
    });
    importNssMock.mockReturnValue({
      certutilPath: 'certutil',
      imported: [{ dir: '/home/user/.local/share/pki/nssdb', version: 'cert9' }],
      skipped: []
    });
  });

  afterEach(() => {
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
    jest.clearAllMocks();
  });

  it('installs with mkcert system trust first, then imports NSS databases off Windows', async () => {
    mockPlatform('linux');

    const result = await installRootCa(tempDir);

    expect(generateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        install: true,
        trustStores: ['system'],
        hosts: ['localhost'],
        caroot: path.join(tempDir, 'certs')
      })
    );
    expect(importNssMock).toHaveBeenCalledWith(path.join(tempDir, 'certs', 'rootCA.pem'));
    expect(result.nss?.imported[0].dir).toBe('/home/user/.local/share/pki/nssdb');
    expect(fs.existsSync(path.join(tempDir, 'certs', 'rootCA.crt'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, 'certs', 'rootCA.key'))).toBe(true);
    expect(fs.readdirSync(path.join(tempDir, 'certs')).some((file) => file.startsWith('.runestone-ca-install-'))).toBe(false);
  });

  it('uses mkcert only on Windows', async () => {
    mockPlatform('win32');

    const result = await installRootCa(tempDir);

    expect(generateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        install: true,
        trustStores: ['system'],
        caroot: path.join(tempDir, 'certs')
      })
    );
    expect(importNssMock).not.toHaveBeenCalled();
    expect(result.nss).toBeUndefined();
    expect(result.rootCaPath).toBe(path.join(tempDir, 'certs', 'rootCA.pem'));
  });
});
