import { loadRunestoneLogo } from '../../src/utils/logo';

describe('logo loader', () => {
  it('loads the runestone wide text logo', () => {
    const logo = loadRunestoneLogo();

    expect(logo).toContain('██████╗');
    expect(logo).toContain('╚═════╝');
  });
});
