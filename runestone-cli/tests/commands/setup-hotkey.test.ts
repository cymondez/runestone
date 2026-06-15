import { setupPromptTestHooks } from '../../src/commands/setup';

describe('setup prompt back hotkey', () => {
  it('submits STEP_BACK when Escape is pressed', () => {
    const prompt = {
      value: 'current',
      state: 'active',
      emit: jest.fn(),
      render: jest.fn(),
      close: jest.fn(),
      onKeypress: jest.fn()
    };

    setupPromptTestHooks.enableBackHotkey(prompt, true);
    prompt.onKeypress('', { name: 'escape', sequence: '\x1b' });

    expect(prompt.value).toBe(setupPromptTestHooks.STEP_BACK);
    expect(prompt.state).toBe('submit');
    expect(prompt.emit).toHaveBeenCalledWith('finalize');
    expect(prompt.render).toHaveBeenCalled();
    expect(prompt.close).toHaveBeenCalled();
  });

  it('passes non-Escape keys to the original Clack handler', () => {
    const original = jest.fn();
    const prompt = {
      value: 'current',
      state: 'active',
      emit: jest.fn(),
      render: jest.fn(),
      close: jest.fn(),
      onKeypress: original
    };

    setupPromptTestHooks.enableBackHotkey(prompt, true);
    prompt.onKeypress('a', { name: 'a', sequence: 'a' });

    expect(original).toHaveBeenCalledWith('a', { name: 'a', sequence: 'a' });
    expect(prompt.value).toBe('current');
    expect(prompt.close).not.toHaveBeenCalled();
  });

  it('does not install the back hotkey on the first setup step', () => {
    const original = jest.fn();
    const prompt = {
      onKeypress: original
    };

    setupPromptTestHooks.enableBackHotkey(prompt, false);

    expect(prompt.onKeypress).toBe(original);
  });
});
