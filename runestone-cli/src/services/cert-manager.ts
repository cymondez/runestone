import * as fs from 'fs';
import * as path from 'path';
import { X509Certificate } from 'crypto';
import * as mkcert from '@mkcert/node';
import { pathHelpers } from '../utils/path-helpers';

export interface CertificateArtifacts {
  domain: string;
  wildcardHost: string;
  certFile: string;
  keyFile: string;
  dynamicConfigFile: string;
}

export interface CertificateChangeResult {
  artifacts: CertificateArtifacts;
  certificateChanged: boolean;
  dynamicConfigChanged: boolean;
}

export interface RootCaAliasResult {
  copied: string[];
  warnings: string[];
}

export interface CertificateListItem {
  status: '✓' | '✗';
  sans: string[];
  issuer: string;
  validUntil: string;
  expiry: string;
  certFile: string;
  keyFile: string;
  dynamicConfigFile: string;
  error?: string;
}

const domainLabel = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;

export function normalizeDomain(domain: string): string {
  const value = domain.trim();
  if (!value) {
    throw new Error('Domain is required');
  }

  if (value.startsWith('*.')) {
    throw new Error('Provide the base domain only. Wildcard certificates are created automatically.');
  }

  if (value.includes('..')) {
    throw new Error(`Invalid domain '${domain}'`);
  }

  const labels = value.split('.');
  if (labels.length < 2 || labels.some((label) => !domainLabel.test(label))) {
    throw new Error(`Invalid domain '${domain}'`);
  }

  return value;
}

export function certificateArtifacts(projectDir: string, domain: string): CertificateArtifacts {
  const normalized = normalizeDomain(domain);
  const certsDir = path.join(projectDir, 'certs');
  const dynamicDir = path.join(projectDir, 'configuration', 'traefik', 'dynamic');

  return {
    domain: normalized,
    wildcardHost: `*.${normalized}`,
    certFile: path.join(certsDir, `${normalized}.crt`),
    keyFile: path.join(certsDir, `${normalized}.key`),
    dynamicConfigFile: path.join(dynamicDir, `${normalized}.ssl.yml`)
  };
}

export function buildTlsDynamicConfig(domain: string): string {
  const normalized = normalizeDomain(domain);
  return [
    'tls:',
    '  certificates:',
    `    - certFile: /ssl/${normalized}.crt`,
    `      keyFile: /ssl/${normalized}.key`,
    ''
  ].join('\n');
}

function ensureExpectedDynamicConfig(dynamicConfigFile: string, domain: string): void {
  const normalized = normalizeDomain(domain);
  const content = fs.readFileSync(dynamicConfigFile, 'utf8');
  if (!content.includes(`certFile: /ssl/${normalized}.crt`) || !content.includes(`keyFile: /ssl/${normalized}.key`)) {
    throw new Error(
      `${dynamicConfigFile} already exists but does not match the expected Traefik TLS configuration.`
    );
  }
}

export function ensureRootCaAliases(certsDir: string): RootCaAliasResult {
  const aliases = [
    { source: 'rootCA.pem', target: 'rootCA.crt' },
    { source: 'rootCA-key.pem', target: 'rootCA.key' }
  ];
  const result: RootCaAliasResult = { copied: [], warnings: [] };

  for (const alias of aliases) {
    const source = path.join(certsDir, alias.source);
    const target = path.join(certsDir, alias.target);
    if (fs.existsSync(target)) {
      continue;
    }

    if (fs.existsSync(source)) {
      try {
        fs.copyFileSync(source, target);
        result.copied.push(target);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result.warnings.push(`Could not create ${target} from ${source}: ${message}`);
      }
    }
  }

  return result;
}

export async function ensureWildcardCertificate(
  projectDir: string,
  domain: string,
  options: { installLocalCa?: boolean } = {}
): Promise<CertificateChangeResult> {
  const artifacts = certificateArtifacts(projectDir, domain);
  const certExists = fs.existsSync(artifacts.certFile);
  const keyExists = fs.existsSync(artifacts.keyFile);

  if (certExists !== keyExists) {
    throw new Error(
      `Incomplete certificate pair for '${artifacts.domain}'. Expected both ${artifacts.certFile} and ${artifacts.keyFile}.`
    );
  }

  pathHelpers.ensureDir(path.dirname(artifacts.certFile));

  let certificateChanged = false;
  if (!certExists && !keyExists) {
    await mkcert.generate({
      install: Boolean(options.installLocalCa),
      hosts: [artifacts.wildcardHost],
      certFile: artifacts.certFile,
      keyFile: artifacts.keyFile,
      caroot: path.dirname(artifacts.certFile)
    });
    ensureRootCaAliases(path.dirname(artifacts.certFile));
    certificateChanged = true;
  } else {
    ensureRootCaAliases(path.dirname(artifacts.certFile));
  }

  return {
    artifacts,
    certificateChanged,
    dynamicConfigChanged: false
  };
}

export async function createDomainCertificate(projectDir: string, domain: string): Promise<CertificateChangeResult> {
  const certificateResult = await ensureWildcardCertificate(projectDir, domain);
  const { artifacts } = certificateResult;

  pathHelpers.ensureDir(path.dirname(artifacts.dynamicConfigFile));

  let dynamicConfigChanged = false;
  if (fs.existsSync(artifacts.dynamicConfigFile)) {
    ensureExpectedDynamicConfig(artifacts.dynamicConfigFile, artifacts.domain);
  } else {
    fs.writeFileSync(artifacts.dynamicConfigFile, buildTlsDynamicConfig(artifacts.domain), 'utf8');
    dynamicConfigChanged = true;
  }

  return {
    artifacts,
    certificateChanged: certificateResult.certificateChanged,
    dynamicConfigChanged
  };
}

export function removeDomainCertificate(projectDir: string, domain: string): CertificateChangeResult {
  const artifacts = certificateArtifacts(projectDir, domain);
  let certificateChanged = false;
  let dynamicConfigChanged = false;

  for (const filePath of [artifacts.certFile, artifacts.keyFile]) {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      certificateChanged = true;
    }
  }

  if (fs.existsSync(artifacts.dynamicConfigFile)) {
    fs.unlinkSync(artifacts.dynamicConfigFile);
    dynamicConfigChanged = true;
  }

  return {
    artifacts,
    certificateChanged,
    dynamicConfigChanged
  };
}

function parseSubjectAltName(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((entry) => entry.trim())
    .map((entry) => entry.replace(/^DNS:/i, '').replace(/^IP Address:/i, ''))
    .filter(Boolean);
}

function parseIssuer(value: string): string {
  const parts = value.split('\n').map((part) => part.trim()).filter(Boolean);
  const organization = parts.find((part) => part.startsWith('O='));
  if (organization) {
    return organization.slice(2);
  }

  const commonName = parts.find((part) => part.startsWith('CN='));
  return commonName ? commonName.slice(3) : parts.join(', ');
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function formatExpiry(validTo: Date, now: Date): string {
  const milliseconds = validTo.getTime() - now.getTime();
  if (milliseconds < 0) {
    return 'expired';
  }

  return `${Math.ceil(milliseconds / 86_400_000)}d`;
}

export function listDomainCertificates(projectDir: string, now = new Date()): CertificateListItem[] {
  const certsDir = path.join(projectDir, 'certs');
  if (!fs.existsSync(certsDir)) {
    return [];
  }

  return fs.readdirSync(certsDir)
    .filter((fileName) => fileName.endsWith('.crt') && fileName !== 'rootCA.crt')
    .sort((left, right) => left.localeCompare(right))
    .map((fileName) => {
      const domain = path.basename(fileName, '.crt');
      const artifacts = certificateArtifacts(projectDir, domain);

      try {
        const certificate = new X509Certificate(fs.readFileSync(artifacts.certFile));
        const validTo = new Date(certificate.validTo);
        const keyExists = fs.existsSync(artifacts.keyFile);
        const isValid = keyExists && validTo.getTime() >= now.getTime();

        return {
          status: isValid ? '✓' : '✗',
          sans: parseSubjectAltName(certificate.subjectAltName),
          issuer: parseIssuer(certificate.issuer),
          validUntil: formatDate(validTo),
          expiry: formatExpiry(validTo, now),
          certFile: artifacts.certFile,
          keyFile: artifacts.keyFile,
          dynamicConfigFile: artifacts.dynamicConfigFile
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          status: '✗',
          sans: [],
          issuer: '-',
          validUntil: '-',
          expiry: 'invalid',
          certFile: artifacts.certFile,
          keyFile: artifacts.keyFile,
          dynamicConfigFile: artifacts.dynamicConfigFile,
          error: message
        };
      }
    });
}
