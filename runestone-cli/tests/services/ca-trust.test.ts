import * as tls from 'tls';
import { checkCaTrust } from '../../src/services/ca-trust';

// Real certificates to fingerprint, without generating any: Node ships the
// public roots it trusts. Which one stands in for Runestone's CA is irrelevant.
const [rootCa, other] = tls.rootCertificates;

describe('whether the system trust store holds the root CA', () => {
  it('is trusted when the root CA fingerprint is in the system store', () => {
    expect(checkCaTrust('/runestone', { readRootCa: () => rootCa, systemCertificates: () => [other, rootCa] })).toBe('trusted');
  });

  it('is not trusted when the store lacks it', () => {
    expect(checkCaTrust('/runestone', { readRootCa: () => rootCa, systemCertificates: () => [other] })).toBe('not-trusted');
  });

  it('has nothing to trust before a root CA exists', () => {
    expect(checkCaTrust('/runestone', { readRootCa: () => undefined, systemCertificates: () => [other] })).toBe('no-root-ca');
  });

  it('is unknown, not untrusted, when this Node cannot read the system store', () => {
    // tls.getCACertificates is newer than the oldest supported Node.
    expect(checkCaTrust('/runestone', { readRootCa: () => rootCa, systemCertificates: () => undefined })).toBe('unknown');
  });

  it('is unknown when the root CA cannot be read', () => {
    expect(
      checkCaTrust('/runestone', {
        readRootCa: () => {
          throw new Error('EACCES');
        },
        systemCertificates: () => [rootCa]
      })
    ).toBe('unknown');
  });

  it('does not let one malformed store entry hide the match', () => {
    expect(
      checkCaTrust('/runestone', { readRootCa: () => rootCa, systemCertificates: () => ['not a certificate', rootCa] })
    ).toBe('trusted');
  });
});
