import {
  validateResourceAddress,
  validateResourceKind,
  validateResourceName,
  validateResourceNotes
} from '../../src/services/resource-manager';

describe('shared resource fields', () => {
  beforeEach(() => {
    process.env.RUNESTONE_LANG = 'en';
  });

  afterEach(() => {
    delete process.env.RUNESTONE_LANG;
  });

  it.each([
    ['localhost:5432', 'localhost:5432'],
    ['host.docker.internal:6379', 'host.docker.internal:6379'],
    ['Shared-PG:5432', 'shared-pg:5432'],
    ['[::1]:5432', '[::1]:5432'],
    ['192.168.1.10:9000', '192.168.1.10:9000']
  ])('accepts the address %s', (input, expected) => {
    expect(validateResourceAddress(input, 'Address')).toBe(expected);
  });

  it.each([
    ['', 'required'],
    ['localhost', 'no port'],
    ['postgres://localhost:5432', 'a scheme'],
    ['localhost:5432/app', 'a path'],
    ['app:secret@localhost:5432', 'credentials'],
    ['localhost:0', 'port 0'],
    ['localhost:70000', 'port above 65535'],
    ['local host:5432', 'a space'],
    ['-bad.example:5432', 'a label starting with a hyphen']
  ])('rejects the address %j (%s)', (input) => {
    expect(() => validateResourceAddress(input, 'Address')).toThrow();
  });

  it('names a credential as the reason, because the record is shown to agents', () => {
    expect(() => validateResourceAddress('app:secret@localhost:5432', 'Address')).toThrow(/user@ or a password/);
  });

  it('applies the route-name rule to names and kinds', () => {
    expect(validateResourceName('shared-pg')).toBe('shared-pg');
    expect(validateResourceKind('postgres')).toBe('postgres');
    expect(() => validateResourceName('Shared PG')).toThrow();
    expect(() => validateResourceKind('-redis')).toThrow();
  });

  it('keeps notes to one short line, and treats empty as none', () => {
    expect(validateResourceNotes('One database per project')).toBe('One database per project');
    expect(validateResourceNotes('   ')).toBeNull();
    expect(() => validateResourceNotes('two\nlines')).toThrow();
    expect(() => validateResourceNotes('x'.repeat(201))).toThrow();
  });
});
