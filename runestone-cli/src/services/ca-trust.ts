/**
 * Whether this machine's system trust store holds Runestone's root CA.
 *
 * Without it every Runestone hostname shows a certificate warning, and nothing
 * the CLI reported said so: `certs list` shows whether a certificate is valid,
 * not whether anything trusts its issuer. AI agents worked it out by hand with
 * curl. This reads the root CA from the Runestone directory and looks for its
 * fingerprint in the system store, which needs no Docker and no Traefik.
 *
 * Measured on 2026-10-14 (Windows 11, Node 22.22.3): reading the system store
 * took 0.5 ms; the root CA was present, and absent from Node's bundled list
 * (the control). A TLS request to the Traefik dashboard verified against the
 * system store and failed against the bundled list, so the fingerprint answer
 * matches what a TLS client sees.
 *
 * What it answers is the system store, not every browser: Firefox, and browsers
 * on Linux, may keep their own store. And it reads nothing else: no process is
 * spawned, so the offline tier of the agent context may call it.
 */

import { X509Certificate } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as tls from 'tls';

/**
 * - `trusted`: the root CA's fingerprint is in the system store.
 * - `not-trusted`: the root CA exists and the system store does not hold it.
 * - `no-root-ca`: there is no root CA yet, so there is nothing to trust.
 * - `unknown`: this Node cannot read the system store, or reading failed.
 */
export type CaTrust = 'trusted' | 'not-trusted' | 'no-root-ca' | 'unknown';

export interface CaTrustDependencies {
  /** The root CA as PEM, or undefined when there is none. */
  readRootCa: (runestoneDir: string) => string | undefined;
  /** The system store as PEM strings, or undefined when this Node cannot read it. */
  systemCertificates: () => string[] | undefined;
}

/** The same two names `rootCaPath` in nss-certutil looks for, which mkcert writes. */
const ROOT_CA_FILES = ['rootCA.pem', 'rootCA.crt'];

export const defaultCaTrustDependencies: CaTrustDependencies = {
  readRootCa: (runestoneDir) => {
    for (const name of ROOT_CA_FILES) {
      const file = path.join(runestoneDir, 'certs', name);
      if (fs.existsSync(file)) {
        return fs.readFileSync(file, 'utf8');
      }
    }
    return undefined;
  },
  // `tls.getCACertificates` is newer than the oldest Node this package supports,
  // so it is detected rather than assumed. Without it the answer is unknown.
  systemCertificates: () => {
    const read = (tls as unknown as { getCACertificates?: (type: string) => string[] }).getCACertificates;
    return typeof read === 'function' ? read('system') : undefined;
  }
};

export function checkCaTrust(runestoneDir: string, overrides: Partial<CaTrustDependencies> = {}): CaTrust {
  const deps = { ...defaultCaTrustDependencies, ...overrides };
  try {
    const rootPem = deps.readRootCa(runestoneDir);
    if (!rootPem) {
      return 'no-root-ca';
    }

    const system = deps.systemCertificates();
    if (!system) {
      return 'unknown';
    }

    const fingerprint = new X509Certificate(rootPem).fingerprint256;
    // One entry the parser rejects must not hide the one that matches.
    const matches = (pem: string): boolean => {
      try {
        return new X509Certificate(pem).fingerprint256 === fingerprint;
      } catch {
        return false;
      }
    };
    return system.some(matches) ? 'trusted' : 'not-trusted';
  } catch {
    return 'unknown';
  }
}
