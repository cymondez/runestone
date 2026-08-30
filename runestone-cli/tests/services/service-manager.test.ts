import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createDomainCertificate, listDomainCertificates } from '../../src/services/cert-manager';
import {
  addServiceRecord,
  buildServiceDynamicConfig,
  ensureCertificateCoverage,
  listServices,
  normalizeRouteDomain,
  normalizeServiceUrl,
  prepareServiceInput,
  isContainerLoopbackUrl,
  removeServiceDynamicConfig,
  removeServiceRecord,
  replaceServiceUrlHost,
  serviceDynamicConfigFile,
  updateServiceRecord,
  writeServiceDynamicConfig
} from '../../src/services/service-manager';
import { RunestoneEnv } from '../../src/utils/env-loader';
import { toolState } from '../../src/utils/tool-state';
import { testEnv } from '../helpers/env';

jest.mock('../../src/services/cert-manager', () => ({
  createDomainCertificate: jest.fn(),
  listDomainCertificates: jest.fn()
}));

jest.mock('../../src/services/docker-compose', () => ({
  ...jest.requireActual('../../src/services/docker-compose'),
  composeService: {
    ps: jest.fn(() => [{ State: 'running' }]),
    restart: jest.fn()
  }
}));

const listDomainCertificatesMock = listDomainCertificates as jest.MockedFunction<typeof listDomainCertificates>;
const createDomainCertificateMock = createDomainCertificate as jest.MockedFunction<typeof createDomainCertificate>;

function config(projectDir: string): RunestoneEnv {
  return testEnv(projectDir, { HOST_DOMAIN: 'example.test', MKCERT_INSTALLED: 'true' });
}

describe('service-manager', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runestone-service-manager-'));
    process.env.RUNESTONE_TOOL_STATE_PATH = path.join(tempDir, 'runestone.config.json');
    process.env.RUNESTONE_LANG = 'en';
  });

  afterEach(() => {
    delete process.env.RUNESTONE_TOOL_STATE_PATH;
    delete process.env.RUNESTONE_LANG;
    fs.rmSync(tempDir, { recursive: true, force: true });
    jest.clearAllMocks();
  });

  it('normalizes service input without adding a default route domain', () => {
    const result = prepareServiceInput(
      { name: 'api', route: 'backend', url: 'https://127.0.0.1:8443', group: 'team-a' },
      config(tempDir)
    );

    expect(result).toEqual({
      name: 'api',
      route: 'backend',
      url: 'https://127.0.0.1:8443',
      group: 'team-a'
    });
    expect(prepareServiceInput({ name: 'web', route: 'web', url: 'http://localhost', group: 'none' }, config(tempDir)).group).toBeNull();
    expect(prepareServiceInput({ name: 'db', route: 'db', url: 'http://localhost' }, config(tempDir)).group).toBeNull();
    expect(normalizeRouteDomain('api', 'example.test')).toBe('api');
    expect(normalizeRouteDomain('api.test', 'example.test')).toBe('api.test');
    expect(normalizeServiceUrl('http://localhost')).toBe('http://localhost');
    expect(normalizeServiceUrl('http://localhost:11434/v1')).toBe('http://localhost:11434/v1');
    expect(normalizeServiceUrl('http://localhost:11434/v1?debug=true')).toBe('http://localhost:11434/v1?debug=true');
  });

  it('rejects invalid names, routes, and urls', () => {
    expect(() => prepareServiceInput({ name: 'Bad Name', route: 'api', url: 'http://localhost' }, config(tempDir))).toThrow('lowercase');
    expect(() => prepareServiceInput({ name: 'api', route: 'https://api.test/path', url: 'http://localhost' }, config(tempDir))).toThrow('Route domain');
    expect(() => prepareServiceInput({ name: 'api', route: 'api', url: 'ftp://localhost' }, config(tempDir))).toThrow('protocol');
  });

  it('detects container loopback URLs and can replace them with host.docker.internal', () => {
    expect(isContainerLoopbackUrl('http://localhost:11434')).toBe(true);
    expect(isContainerLoopbackUrl('http://127.0.0.1:11434')).toBe(true);
    expect(isContainerLoopbackUrl('http://[::1]:11434')).toBe(true);
    expect(isContainerLoopbackUrl('http://host.docker.internal:11434')).toBe(false);
    expect(replaceServiceUrlHost('http://127.0.0.1:11434', 'host.docker.internal')).toBe('http://host.docker.internal:11434');
    expect(replaceServiceUrlHost('http://127.0.0.1:11434/v1?debug=true', 'host.docker.internal')).toBe('http://host.docker.internal:11434/v1?debug=true');
  });

  it('writes, lists, repairs, and removes service records and dynamic config', () => {
    const runestoneConfig = config(tempDir);
    const service = prepareServiceInput({ name: 'api', route: 'api.example.test', url: 'http://host.docker.internal:3000' }, runestoneConfig);

    addServiceRecord(service);
    writeServiceDynamicConfig(runestoneConfig, service);

    const dynamicConfig = serviceDynamicConfigFile(tempDir, 'api');
    expect(fs.existsSync(dynamicConfig)).toBe(true);
    expect(fs.readFileSync(dynamicConfig, 'utf8')).toBe(buildServiceDynamicConfig(service, 'websecure'));
    expect(listServices(runestoneConfig)[0]).toMatchObject({ name: 'api', dynamicConfigExists: true });

    updateServiceRecord({ ...service, group: 'ops' });
    expect(toolState.readServices()[0].group).toBe('ops');

    expect(removeServiceRecord('api').name).toBe('api');
    expect(removeServiceDynamicConfig(runestoneConfig, 'api')).toBe(true);
    expect(listServices(runestoneConfig)).toEqual([]);
  });

  it('creates a wildcard certificate when no existing certificate covers the route', async () => {
    listDomainCertificatesMock.mockReturnValue([]);
    createDomainCertificateMock.mockResolvedValue({
      artifacts: {
        domain: 'netzeropro.docker.so',
        wildcardHost: '*.netzeropro.docker.so',
        certFile: '',
        keyFile: '',
        dynamicConfigFile: ''
      },
      certificateChanged: true,
      dynamicConfigChanged: true
    });

    await ensureCertificateCoverage(config(tempDir), 'app.netzeropro.docker.so', async () => true);

    expect(createDomainCertificateMock).toHaveBeenCalledWith(
      tempDir,
      'netzeropro.docker.so',
      { composeFilePath: path.join(tempDir, 'compose.yml') }
    );
  });

  it('reuses an existing single-label wildcard certificate', async () => {
    listDomainCertificatesMock.mockReturnValue([
      {
        status: '✓',
        sans: ['*.docker.so'],
        issuer: 'Runestone',
        validUntil: '2030-01-01',
        expiry: '100d',
        certFile: '',
        keyFile: '',
        dynamicConfigFile: ''
      }
    ]);

    await ensureCertificateCoverage(config(tempDir), 'netzeropro.docker.so', async () => {
      throw new Error('should not ask');
    });

    expect(createDomainCertificateMock).not.toHaveBeenCalled();
  });
});
