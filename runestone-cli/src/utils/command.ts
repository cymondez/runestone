import { Command, Help, Option } from 'commander';

class RunestoneHelp extends Help {
  commandUsage(cmd: Command): string {
    const usage = super.commandUsage(cmd);
    if (this.hasVisibleNonHelpOptions(cmd)) {
      return usage;
    }

    return usage
      .replace(/\s*\[options\]\s*/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  visibleOptions(cmd: Command): Option[] {
    const options = super.visibleOptions(cmd);
    return this.hasVisibleNonHelpOptions(cmd) ? options : [];
  }

  private hasVisibleNonHelpOptions(cmd: Command): boolean {
    return super.visibleOptions(cmd).some((option) => option.short !== '-h' && option.long !== '--help');
  }
}

export class RunestoneCommand extends Command {
  createHelp(): Help {
    return new RunestoneHelp();
  }
}

export function createCommand(name?: string): Command {
  return new RunestoneCommand(name).addHelpCommand(false);
}
