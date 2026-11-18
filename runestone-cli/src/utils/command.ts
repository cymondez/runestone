import { Command, Help, Option } from 'commander';

/**
 * A titled set of subcommands for the help listing.
 *
 * Commander 12 prints subcommands as one flat list in registration order. For
 * the root command that list is the first thing anyone reads, an AI agent
 * included, and a flat list says nothing about which commands connect a
 * project and which change every project on the machine. Groups say it.
 */
export interface CommandGroup {
  title: string;
  names: string[];
}

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

  /**
   * Empty when the command declares groups, so Commander's flat "Commands:"
   * section is not printed; `formatHelp` prints the groups in its place.
   */
  visibleCommands(cmd: Command): Command[] {
    return groupsOf(cmd) ? [] : super.visibleCommands(cmd);
  }

  /** Keeps option and command columns aligned while the commands are grouped. */
  padWidth(cmd: Command, helper: Help): number {
    const width = super.padWidth(cmd, helper);
    if (!groupsOf(cmd)) {
      return width;
    }

    return Math.max(width, ...super.visibleCommands(cmd).map((sub) => helper.subcommandTerm(sub).length));
  }

  formatHelp(cmd: Command, helper: Help): string {
    const base = super.formatHelp(cmd, helper);
    const groups = groupsOf(cmd);
    if (!groups) {
      return base;
    }

    const termWidth = helper.padWidth(cmd, helper);
    const helpWidth = helper.helpWidth || 80;
    const formatItem = (sub: Command): string => {
      const term = helper.subcommandTerm(sub);
      const description = helper.subcommandDescription(sub);
      if (!description) {
        return term;
      }

      return helper.wrap(`${term.padEnd(termWidth + 2)}${description}`, helpWidth - 2, termWidth + 2);
    };

    const commands = super.visibleCommands(cmd);
    const named = new Set(groups.flatMap((group) => group.names));
    // A command missing from every group is still listed, so registering a new
    // one without updating the groups cannot hide it from the help.
    const ungrouped = commands.filter((sub) => !named.has(sub.name()));
    const sections = [
      ...groups.map((group) => ({
        title: group.title,
        items: group.names
          .map((name) => commands.find((sub) => sub.name() === name))
          .filter((sub): sub is Command => Boolean(sub))
      })),
      ...(ungrouped.length > 0 ? [{ title: 'Commands', items: ungrouped }] : [])
    ].filter((section) => section.items.length > 0);

    const rendered = sections.map((section) =>
      [`${section.title}:`, section.items.map(formatItem).join('\n').replace(/^/gm, '  '), ''].join('\n')
    );

    return `${base}\n${rendered.join('\n')}`;
  }

  private hasVisibleNonHelpOptions(cmd: Command): boolean {
    return super.visibleOptions(cmd).some((option) => option.short !== '-h' && option.long !== '--help');
  }
}

function groupsOf(cmd: Command): CommandGroup[] | undefined {
  return cmd instanceof RunestoneCommand && cmd.commandGroups.length > 0 ? cmd.commandGroups : undefined;
}

export class RunestoneCommand extends Command {
  commandGroups: CommandGroup[] = [];

  createHelp(): Help {
    return new RunestoneHelp();
  }

  /** Print the subcommands under these titles instead of as one flat list. */
  groupCommands(groups: CommandGroup[]): this {
    this.commandGroups = groups;
    return this;
  }
}

export function createCommand(name?: string): RunestoneCommand {
  return new RunestoneCommand(name).addHelpCommand(false);
}
