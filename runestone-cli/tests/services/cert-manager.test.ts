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
  listDomainCertificates,
  readCertificateDnsNames,
  removeDomainCertificate
} from '../../src/services/cert-manager';

jest.mock('@mkcert/node', () => ({
  generate: jest.fn()
}));

const generateMock = mkcert.generate as jest.MockedFunction<typeof mkcert.generate>;
const fixtureCertificate = [
  '-----BEGIN CERTIFICATE-----',
  'MIIDJTCCAg2gAwIBAgIUPKizl1OYPKYUvomO2YHiu2BEKCUwDQYJKoZIhvcNAQEL',
  'BQAwNjEaMBgGA1UEAwwRUnVuZXN0b25lIFRlc3QgQ0ExGDAWBgNVBAoMD1J1bmVz',
  'dG9uZSBUZXN0czAeFw0yNjA2MTYwNDA5MjNaFw0zNjA2MTMwNDA5MjNaMDYxGjAY',
  'BgNVBAMMEVJ1bmVzdG9uZSBUZXN0IENBMRgwFgYDVQQKDA9SdW5lc3RvbmUgVGVz',
  'dHMwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQC2j4tekaJUdHX4XDas',
  'XE836KsvxsA5s5gZPy7UtKmKUTEFNAHLDncE6zftYFRRv+VvFyjJSVFfGy89fGwX',
  'u+0hLDVMcSvdjvPuyUUrRfWIODoQQzwLbRTDbOnf+TWtqNdmHMumbAMm/IDFNuum',
  'vDHRn6NgZb05uMVojC/HyyblCfd52JyMnD2yiZsobvHH2hDKFBkmP44CvaG2DWfR',
  'dkAuzLYrCZxjvHkq4k4xj9geP7YWdn2+kv5jciGQnPKHZDI0/mKphm8dJDZ65SwT',
  'MOFKn9VAtUd9qXjL9aZ2jMyYKOaze9p+FgzeNYfaeks2d9AZ2AasfTnasNgyjURr',
  'Y8SjAgMBAAGjKzApMCcGA1UdEQQgMB6CDiouZXhhbXBsZS50ZXN0ggxleGFtcGxl',
  'LnRlc3QwDQYJKoZIhvcNAQELBQADggEBAHrxDjBY1pdz9r1RU+C2XALMJmPvjOfa',
  'tVmFds9JA7C2WbfigmIqMAiOs1Gf410ZruShASqimvgGYgqMgJSMStOM3naod6Kv',
  'k59ZbwApRsyR8RGmZCisYp4yQlcklUfKPEqMR6uwEo8kJ8yiaFQPvy209uRkoTEI',
  'tSNw4Eo1n/0m2IKKsO/hoBC2pzITpvKCn8v0zPmPY4VBiTOnsz3/wKFKAfkSakE2',
  'UDpahDTm4ik3d3oeVDdP77Gv5wAurcnAEKsVIl6X4bySr4lxaVNA4DR+WlNQhqEU',
  '2VHdQGhhz8TbVlCOpP8KieEOyEdpY9Z3vJsvJr7jl3VyFtKpb2PjDdU=',
  '-----END CERTIFICATE-----',
  ''
].join('\n');

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
    expect(result.artifacts.dynamicConfigFile).toBe(path.join(tempDir, 'configuration', 'certs', 'example.test.ssl.yml'));
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

  it('lists generated certificate details and ignores the root CA certificate', () => {
    const artifacts = certificateArtifacts(tempDir, 'example.test');
    fs.mkdirSync(path.dirname(artifacts.certFile), { recursive: true });
    fs.mkdirSync(path.dirname(artifacts.dynamicConfigFile), { recursive: true });
    fs.writeFileSync(artifacts.certFile, fixtureCertificate, 'utf8');
    fs.writeFileSync(artifacts.keyFile, 'key', 'utf8');
    fs.writeFileSync(artifacts.dynamicConfigFile, buildTlsDynamicConfig('example.test'), 'utf8');
    fs.writeFileSync(path.join(tempDir, 'certs', 'rootCA.crt'), fixtureCertificate, 'utf8');

    const result = listDomainCertificates(tempDir, new Date('2026-06-16T05:00:00Z'));

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      status: '✓',
      sans: ['*.example.test', 'example.test'],
      issuer: 'Runestone Tests',
      validUntil: '2036-06-13',
      expiry: '3650d'
    });
  });

  it('reads the DNS names out of a real certificate and leaves the wildcard alone', () => {
    const certFile = path.join(tempDir, 'certs', 'named-something-else.crt');
    fs.mkdirSync(path.dirname(certFile), { recursive: true });
    fs.writeFileSync(certFile, fixtureCertificate, 'utf8');

    // Straight from the certificate, in its order, with the wildcard as written.
    // The filename says nothing and is not consulted.
    expect(readCertificateDnsNames(certFile)).toEqual(['*.example.test', 'example.test']);
  });

  it('throws rather than guessing when the certificate cannot be parsed', () => {
    const certFile = path.join(tempDir, 'certs', 'corrupt.test.crt');
    fs.mkdirSync(path.dirname(certFile), { recursive: true });
    fs.writeFileSync(certFile, 'not a certificate', 'utf8');

    expect(() => readCertificateDnsNames(certFile)).toThrow();
  });

  it('marks certificates without dynamic config as usable when the key exists', () => {
    const withoutDynamicConfig = certificateArtifacts(tempDir, 'without-dynamic-config.test');
    fs.mkdirSync(path.dirname(withoutDynamicConfig.certFile), { recursive: true });
    fs.writeFileSync(withoutDynamicConfig.certFile, fixtureCertificate, 'utf8');
    fs.writeFileSync(withoutDynamicConfig.keyFile, 'key', 'utf8');

    const result = listDomainCertificates(tempDir, new Date('2026-06-16T05:00:00Z'));

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      status: '✓',
      expiry: '3650d'
    });
  });

  it('marks certificates without keys and unreadable certificates as unavailable', () => {
    const missingKey = certificateArtifacts(tempDir, 'missing-key.test');
    const invalid = certificateArtifacts(tempDir, 'invalid.test');
    fs.mkdirSync(path.dirname(missingKey.certFile), { recursive: true });
    fs.writeFileSync(missingKey.certFile, fixtureCertificate, 'utf8');
    fs.writeFileSync(invalid.certFile, 'not a certificate', 'utf8');

    const result = listDomainCertificates(tempDir, new Date('2026-06-16T05:00:00Z'));

    expect(result.map((item) => item.status)).toEqual(['✗', '✗']);
    expect(result.find((item) => item.certFile.endsWith('invalid.test.crt'))?.expiry).toBe('invalid');
    expect(result.find((item) => item.certFile.endsWith('missing-key.test.crt'))?.expiry).toBe('3650d');
  });
});
