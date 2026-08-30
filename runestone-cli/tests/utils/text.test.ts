import { displayWidth, padToWidth } from '../../src/utils/text';

describe('terminal text measurement', () => {
  it('counts a CJK character as two cells', () => {
    expect(displayWidth('abc')).toBe(3);
    expect(displayWidth('寫入')).toBe(4);
    expect(displayWidth('Web UI')).toBe(6);
  });

  it('pads by cells, which is what keeps a CJK label column straight', () => {
    // `padEnd` would stop at two characters here and leave the column ragged in
    // exactly the locales that need it most.
    expect(padToWidth('寫入', 6)).toBe('寫入  ');
    expect(padToWidth('Port', 6)).toBe('Port  ');
    expect(displayWidth(padToWidth('寫入', 6))).toBe(displayWidth(padToWidth('Port', 6)));
  });

  it('never truncates something already wider than the column', () => {
    expect(padToWidth('Upstream', 4)).toBe('Upstream');
  });
});
