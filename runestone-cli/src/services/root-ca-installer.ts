import * as fs from 'fs';
import * as path from 'path';
import * as mkcert from '@mkcert/node';
import { ensureRootCaAliases, RootCaAliasResult } from './cert-manager';
import { importRootCaToNssDatabases, NssImportResult, rootCaPath } from './nss-certutil';
import { pathHelpers } from '../utils/path-helpers';

export interface RootCaInstallResult {
  rootCaPath: string;
  aliasResult: RootCaAliasResult;
  nss?: NssImportResult;
}

function removeGeneratedInstallProbe(certFile: string, keyFile: string): void {
  for (const filePath of [certFile, keyFile]) {
    try {
      fs.rmSync(filePath, { force: true });
    } catch {
      // The probe certificate is disposable; a cleanup failure should not hide a successful CA install.
    }
  }
}

export async function installRootCa(projectDir: string): Promise<RootCaInstallResult> {
  const certsDir = path.join(projectDir, 'certs');
  pathHelpers.ensureDir(certsDir);

  const probeBase = path.join(certsDir, `.runestone-ca-install-${process.pid}-${Date.now()}`);
  const probeCertFile = `${probeBase}.crt`;
  const probeKeyFile = `${probeBase}.key`;

  await mkcert.generate({
    install: true,
    trustStores: ['system'],
    hosts: ['localhost'],
    certFile: probeCertFile,
    keyFile: probeKeyFile,
    caroot: certsDir
  });
  removeGeneratedInstallProbe(probeCertFile, probeKeyFile);

  const aliasResult = ensureRootCaAliases(certsDir);
  const caPath = rootCaPath(projectDir);
  const nss = process.platform === 'win32' ? undefined : importRootCaToNssDatabases(caPath);

  return {
    rootCaPath: caPath,
    aliasResult,
    nss
  };
}
