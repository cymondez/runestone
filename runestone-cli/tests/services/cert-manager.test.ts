import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as mkcert from '@mkcert/node';
import {
  buildTlsDynamicConfig,
  certificateArtifacts,
  createDomainCertificate,
  ensureRootCaAliases,
  ensureWildcardCertificate,
  removeDomainCertificate
} from '../../src/services/cert-manager';

jest.mock('@mkcert/node', () => ({
  generate: jest.fn()
}));

const generateMock = mkcert.generate as jest.MockedFunction<typeof mkcert.generate>;

describe('cert-manager', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runestone-certs-'));
    generateMock.mockImplementation(async (options) => {
      if (options.certFile) {
        fs.mkdirSync(path.dirname(options.certFile), { recursive: true });
        fs.writeFileSync(options.certFile, `cert for ${options.hosts.join(',')}`, 'utf8');
      }
      if (options.keyFile) {
        fs.mkdirSync(path.dirname(options.keyFile), { recursive: true });
        fs.writeFileSync(options.keyFile, 'key', 'utf8');
      }
      if (options.caroot) {
        fs.mkdirSync(options.caroot, { recursive: true });
        fs.writeFileSync(path.join(options.caroot, 'rootCA.pem'), 'root cert', 'utf8');
        fs.writeFileSync(path.join(options.caroot, 'rootCA-key.pem'), 'root key', 'utf8');
      }
    });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    generateMock.mockReset();
  });

  it('creates wildcard crt/key files and a Traefik dynamic TLS config', async () => {
    const result = await createDomainCertificate(tempDir, 'example.test');

    expect(generateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        hosts: ['*.example.test'],
        certFile: path.join(tempDir, 'certs', 'example.test.crt'),
        keyFile: path.join(tempDir, 'certs', 'example.test.key'),
        caroot: path.join(tempDir, 'certs')
      })
    );
    expect(result.certificateChanged).toBe(true);
    expect(result.dynamicConfigChanged).toBe(true);
    expect(fs.readFileSync(result.artifacts.certFile, 'utf8')).toContain('*.example.test');
    expect(fs.readFileSync(result.artifacts.dynamicConfigFile, 'utf8')).toBe(buildTlsDynamicConfig('example.test'));
    expect(fs.existsSync(path.join(tempDir, 'certs', 'rootCA.crt'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, 'certs', 'rootCA.key'))).toBe(true);
  });

  it('reuses existing matching certificate and dynamic config files', async () => {
    const artifacts = certificateArtifacts(tempDir, 'example.test');
    fs.mkdirSync(path.dirname(artifacts.certFile), { recursive: true });
    fs.mkdirSync(path.dirname(artifacts.dynamicConfigFile), { recursive: true });
    fs.writeFileSync(artifacts.certFile, 'cert', 'utf8');
    fs.writeFileSync(artifacts.keyFile, 'key', 'utf8');
    fs.writeFileSync(artifacts.dynamicConfigFile, buildTlsDynamicConfig('example.test'), 'utf8');

    const result = await createDomainCertificate(tempDir, 'example.test');

    expect(generateMock).not.toHaveBeenCalled();
    expect(result.certificateChanged).toBe(false);
    expect(result.dynamicConfigChanged).toBe(false);
  });

  it('rejects mismatched existing dynamic TLS config', async () => {
    const artifacts = certificateArtifacts(tempDir, 'example.test');
    fs.mkdirSync(path.dirname(artifacts.certFile), { recursive: true });
    fs.mkdirSync(path.dirname(artifacts.dynamicConfigFile), { recursive: true });
    fs.writeFileSync(artifacts.certFile, 'cert', 'utf8');
    fs.writeFileSync(artifacts.keyFile, 'key', 'utf8');
    fs.writeFileSync(artifacts.dynamicConfigFile, 'tls: {}\n', 'utf8');

    await expect(createDomainCertificate(tempDir, 'example.test')).rejects.toThrow('does not match');
  });

  it('rejects incomplete certificate pairs before writing new files', async () => {
    const artifacts = certificateArtifacts(tempDir, 'example.test');
    fs.mkdirSync(path.dirname(artifacts.certFile), { recursive: true });
    fs.writeFileSync(artifacts.certFile, 'cert', 'utf8');

    await expect(ensureWildcardCertificate(tempDir, 'example.test')).rejects.toThrow('Incomplete certificate pair');
    expect(generateMock).not.toHaveBeenCalled();
  });

  it('removes certificate and dynamic config files independently when they exist', () => {
    const artifacts = certificateArtifacts(tempDir, 'example.test');
    fs.mkdirSync(path.dirname(artifacts.certFile), { recursive: true });
    fs.mkdirSync(path.dirname(artifacts.dynamicConfigFile), { recursive: true });
    fs.writeFileSync(artifacts.certFile, 'cert', 'utf8');
    fs.writeFileSync(artifacts.keyFile, 'key', 'utf8');
    fs.writeFileSync(artifacts.dynamicConfigFile, buildTlsDynamicConfig('example.test'), 'utf8');

    const result = removeDomainCertificate(tempDir, 'example.test');

    expect(result.certificateChanged).toBe(true);
    expect(result.dynamicConfigChanged).toBe(true);
    expect(fs.existsSync(artifacts.certFile)).toBe(false);
    expect(fs.existsSync(artifacts.keyFile)).toBe(false);
    expect(fs.existsSync(artifacts.dynamicConfigFile)).toBe(false);
  });

  it('does not overwrite existing root CA aliases on repeated setup runs', () => {
    const certsDir = path.join(tempDir, 'certs');
    fs.mkdirSync(certsDir, { recursive: true });
    fs.writeFileSync(path.join(certsDir, 'rootCA.pem'), 'new root cert', 'utf8');
    fs.writeFileSync(path.join(certsDir, 'rootCA-key.pem'), 'new root key', 'utf8');
    fs.writeFileSync(path.join(certsDir, 'rootCA.crt'), 'existing root cert', 'utf8');
    fs.writeFileSync(path.join(certsDir, 'rootCA.key'), 'existing root key', 'utf8');

    const aliasResult = ensureRootCaAliases(certsDir);

    expect(aliasResult.warnings).toEqual([]);
    expect(fs.readFileSync(path.join(certsDir, 'rootCA.crt'), 'utf8')).toBe('existing root cert');
    expect(fs.readFileSync(path.join(certsDir, 'rootCA.key'), 'utf8')).toBe('existing root key');
  });
});
