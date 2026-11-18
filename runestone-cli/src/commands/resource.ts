import { Command } from 'commander';
import * as p from '@clack/prompts';
import { dim } from 'kleur';
import {
  addResource,
  listResources,
  prepareResource,
  removeResource,
  resourceExists,
  updateResource,
  validateResourceAddress,
  validateResourceKind,
  validateResourceName,
  validateResourceNotes
} from '../services/resource-manager';
import { t } from '../i18n';
import { createCommand } from '../utils/command';
import { logger } from '../utils/logger';
import { displayWidth } from '../utils/text';
import { RunestoneResourceRecord } from '../utils/tool-state';

interface ResourceFlags {
  kind?: string;
  host?: string;
  container?: string;
  notes?: string;
}

interface ListOptions {
  header: boolean;
  json?: boolean;
}

interface RemoveOptions {
  force?: boolean;
}

type Field = 'name' | 'kind' | 'host' | 'container' | 'notes';

/** One validator per field, shared by the flags and the prompts. */
function validatorFor(field: Field): (value: string) => unknown {
  switch (field) {
    case 'name':
      return validateResourceName;
    case 'kind':
      return validateResourceKind;
    case 'host':
      return (value) => validateResourceAddress(value, t('resource.label.host'));
    case 'container':
      return (value) => validateResourceAddress(value, t('resource.label.container'));
    default:
      return validateResourceNotes;
  }
}

function errorOf(field: Field, value: string): string | undefined {
  try {
    validatorFor(field)(value);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * Ask for one field. An invalid answer keeps the same prompt open with the
 * reason shown on it, which is the prompt rule in AGENTS.md. A value that came
 * from a flag and was invalid is offered again with its reason in the message.
 */
async function promptField(field: Field, initialValue: string, extraCheck?: (value: string) => string | undefined): Promise<string> {
  const initialError = initialValue ? errorOf(field, initialValue) ?? extraCheck?.(initialValue) : undefined;
  const result = await p.text({
    message: initialError ? `${t(`resource.prompt.${field}` as never)} (${initialError})` : t(`resource.prompt.${field}` as never),
    placeholder: t(`resource.placeholder.${field}` as never),
    initialValue,
    validate: (value) => errorOf(field, value ?? '') ?? extraCheck?.(value ?? '')
  });
  if (p.isCancel(result)) {
    p.cancel(t('resource.cancelled'));
    process.exit(0);
  }

  return String(result ?? '');
}

/** Without a terminal there is nobody to ask: say which flags would have answered. */
function failWithoutTerminal(missing: string[]): void {
  logger.error(t('resource.nonInteractive', { flags: missing.join(' ') }));
  process.exitCode = 1;
}

async function handleAdd(name: string | undefined, flags: ResourceFlags): Promise<void> {
  const values = { name: name ?? '', kind: flags.kind ?? '', host: flags.host ?? '', container: flags.container ?? '', notes: flags.notes ?? '' };
  const taken = (value: string) => (resourceExists(value.trim()) ? t('resource.error.exists', { name: value.trim() }) : undefined);
  const required: Array<Exclude<Field, 'notes'>> = ['name', 'kind', 'host', 'container'];
  const invalid = required.filter((field) => !values[field] || errorOf(field, values[field]) || (field === 'name' && taken(values.name)));
  const notesInvalid = Boolean(values.notes) && Boolean(errorOf('notes', values.notes));

  if (invalid.length > 0 || notesInvalid) {
    if (!process.stdin.isTTY) {
      // Report every problem at once, before anything is written, rather than
      // the first one only.
      for (const field of [...invalid, ...(notesInvalid ? ['notes' as const] : [])]) {
        const reason = values[field] ? errorOf(field, values[field]) ?? (field === 'name' ? taken(values.name) : undefined) : t('resource.error.missing');
        logger.error(`${t(`resource.label.${field}` as never)}: ${reason}`);
      }
      failWithoutTerminal(['<name>', '--kind <kind>', '--host <host:port>', '--container <host:port>']);
      return;
    }

    for (const field of invalid) {
      values[field] = await promptField(field, values[field], field === 'name' ? taken : undefined);
    }
    if (notesInvalid) {
      values.notes = await promptField('notes', values.notes);
    }
  }

  const resource = prepareResource({
    name: values.name,
    kind: values.kind,
    hostAccess: values.host,
    containerAccess: values.container,
    notes: values.notes
  });
  addResource(resource);
  logger.success(t('resource.success.added', { name: resource.name }));
}

async function handleModify(name: string, flags: ResourceFlags): Promise<void> {
  const normalized = validateResourceName(name);
  const current = listResources().find((resource) => resource.name === normalized);
  if (!current) {
    throw new Error(t('resource.error.notFound', { name: normalized }));
  }

  const given = flags.kind !== undefined || flags.host !== undefined || flags.container !== undefined || flags.notes !== undefined;
  let values = {
    kind: flags.kind ?? current.kind,
    host: flags.host ?? current.hostAccess,
    container: flags.container ?? current.containerAccess,
    notes: flags.notes ?? current.notes ?? ''
  };

  if (!given) {
    if (!process.stdin.isTTY) {
      failWithoutTerminal(['--kind <kind>', '--host <host:port>', '--container <host:port>', '--notes <text>']);
      return;
    }
    values = {
      kind: await promptField('kind', values.kind),
      host: await promptField('host', values.host),
      container: await promptField('container', values.container),
      notes: await promptField('notes', values.notes)
    };
  }

  const resource = prepareResource({ name: normalized, kind: values.kind, hostAccess: values.host, containerAccess: values.container, notes: values.notes });
  updateResource(resource);
  logger.success(t('resource.success.updated', { name: resource.name }));
}

async function handleRemove(name: string, options: RemoveOptions): Promise<void> {
  const normalized = validateResourceName(name);
  if (!resourceExists(normalized)) {
    throw new Error(t('resource.error.notFound', { name: normalized }));
  }

  if (!options.force) {
    if (!process.stdin.isTTY) {
      logger.error(t('resource.remove.nonInteractive', { name: normalized }));
      process.exitCode = 1;
      return;
    }
    const confirmed = await p.confirm({ message: t('resource.remove.prompt', { name: normalized }), initialValue: false });
    if (p.isCancel(confirmed) || !confirmed) {
      logger.warn(t('resource.cancelled'));
      return;
    }
  }

  removeResource(normalized);
  logger.success(t('resource.success.removed', { name: normalized }));
}

function pad(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - displayWidth(text)));
}

function handleList(options: ListOptions): void {
  const resources = listResources();
  if (options.json) {
    process.stdout.write(`${JSON.stringify(resources, null, 2)}\n`);
    return;
  }
  if (resources.length === 0) {
    if (options.header !== false) {
      logger.info(t('resource.list.empty'));
    }
    return;
  }

  const headings = [t('resource.table.name'), t('resource.table.kind'), t('resource.table.host'), t('resource.table.container'), t('resource.table.notes')];
  const rows = resources.map((resource: RunestoneResourceRecord) => [resource.name, resource.kind, resource.hostAccess, resource.containerAccess, resource.notes ?? '']);
  const all = options.header !== false ? [headings, ...rows] : rows;
  const widths = headings.map((_, column) => Math.max(...all.map((row) => displayWidth(row[column]))));
  for (const row of all) {
    console.log(row.map((cell, column) => pad(cell, widths[column])).join('  ').trimEnd());
  }
  if (options.header !== false) {
    console.log(dim(t('resource.list.note')));
  }
}

async function wrap(action: () => Promise<void> | void, message: string): Promise<void> {
  try {
    await action();
  } catch (error) {
    logger.error(`${message}: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

function withFieldOptions(command: Command): Command {
  return command
    .option('--kind <kind>', t('resource.option.kind'))
    .option('--host <host:port>', t('resource.option.host'))
    .option('--container <host:port>', t('resource.option.container'))
    .option('--notes <text>', t('resource.option.notes'));
}

export function createResourceCommand(): Command {
  const command = createCommand('resource').description(t('commands.resource.description'));

  command.addCommand(
    withFieldOptions(createCommand('add').description(t('commands.resource.add.description')).argument('[name]', t('resource.label.name')))
      .action((name: string | undefined, flags: ResourceFlags) => wrap(() => handleAdd(name, flags), t('resource.failure.add')))
  );

  command.addCommand(
    createCommand('list')
      .alias('ls')
      .description(t('commands.resource.list.description'))
      .option('--no-header', t('options.noHeader.description'))
      .option('--json', t('options.json.description'))
      .action((options: ListOptions) => wrap(() => handleList(options), t('resource.failure.list')))
  );

  command.addCommand(
    withFieldOptions(createCommand('modify').alias('m').description(t('commands.resource.modify.description')).argument('<name>', t('resource.label.name')))
      .action((name: string, flags: ResourceFlags) => wrap(() => handleModify(name, flags), t('resource.failure.modify')))
  );

  command.addCommand(
    createCommand('remove')
      .alias('rm')
      .description(t('commands.resource.remove.description'))
      .argument('<name>', t('resource.label.name'))
      .option('--force', t('resource.option.force'))
      .action((name: string, options: RemoveOptions) => wrap(() => handleRemove(name, options), t('resource.failure.remove')))
  );

  return command;
}
