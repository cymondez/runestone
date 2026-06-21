import { Command } from 'commander';
import { SelectPrompt, TextPrompt } from '@clack/core';
import * as p from '@clack/prompts';
import { cyan, dim, gray, green, hidden, inverse, red, strikethrough, yellow } from 'kleur';
import {
  addServiceRecord,
  assertRouteCanCreateWildcardCertificate,
  assertNoTraefikHostConflict,
  assertNoTraefikNameConflict,
  certificateBaseDomainForRoute,
  ensureCertificateCoverage,
  findCoveringCertificate,
  isContainerLoopbackUrl,
  isManagedServiceDynamicConfig,
  listServices,
  normalizeRouteDomain,
  normalizeServiceUrl,
  prepareServiceInput,
  replaceServiceUrlHost,
  removeServiceDynamicConfig,
  removeServiceRecord,
  serviceDynamicConfigExists,
  serviceExists,
  updateServiceRecord,
  validateGroupName,
  validateServiceName,
  writeServiceDynamicConfig
} from '../services/service-manager';
import { listDomainCertificates } from '../services/cert-manager';
import { readTraefikSnapshot } from '../services/traefik-api';
import { envLoader, RunestoneEnv } from '../utils/env-loader';
import { logger } from '../utils/logger';
import { toolState, RunestoneServiceRecord } from '../utils/tool-state';
import { createCommand } from '../utils/command';
import { t } from '../i18n';
import { runInDynamicConfigBatch } from '../services/dynamic-config-manager';

interface AddOptions {
  route?: string;
  url?: string;
  group?: string;
}

interface ListOptions {
  header: boolean;
}

interface RemoveOptions {
  force?: boolean;
}

interface GroupCleanOptions {
  force?: boolean;
  keepServices?: boolean;
}

interface GroupListOptions {
  tree?: boolean;
  detail?: boolean;
}

const GROUP_CREATE_VALUE = '__runestone_create_group__';
const ROUTE_MANUAL_VALUE = '__runestone_manual_route__';

interface PromptFrame {
  description?: string | string[];
}

interface SelectOption {
  value: string;
  label: string;
  hint?: string;
}

interface RoutePromptResult {
  route: string;
  forcePrompt: boolean;
  description?: string;
}

function traefikApiBaseUrl(config: RunestoneEnv): string {
  return `https://traefik.${config.HOST_DOMAIN}`;
}

async function loadTraefikSnapshot(config: RunestoneEnv) {
  try {
    return await readTraefikSnapshot(traefikApiBaseUrl(config));
  } catch {
    throw new Error(t('service.traefik.unavailable'));
  }
}

function formatTable(rows: string[][], header: boolean, headings: string[]): string {
  const allRows = header ? [headings, ...rows] : rows;
  const widths = allRows.reduce<number[]>(
    (next, row) => row.map((cell, index) => Math.max(next[index] ?? 0, cell.length)),
    []
  );

  return allRows.map((row) => row.map((cell, index) => cell.padEnd(widths[index])).join('  ').trimEnd()).join('\n');
}

function displayGroupName(group: string | null | undefined): string {
  return group || 'none';
}

function promptDescription(description?: string | string[]): string {
  if (!description) {
    return '';
  }

  const lines = Array.isArray(description) ? description : [description];
  return `${lines.map((line) => `${gray('│')}  ${dim(`- ${line}`)}`).join('\n')}\n`;
}

function promptSymbol(state: string): string {
  switch (state) {
    case 'submit':
      return green('◇');
    case 'cancel':
      return red('■');
    case 'error':
      return yellow('▲');
    default:
      return cyan('◆');
  }
}

function promptHeader(state: string, message: string, frame?: PromptFrame): string {
  return `${gray('│')}\n${promptSymbol(state)}  ${message}\n${promptDescription(frame?.description)}`;
}

function optionLabel(option: SelectOption, state: 'active' | 'inactive' | 'selected' | 'cancelled'): string {
  const hint = option.hint ? ` ${dim(`(${option.hint})`)}` : '';
  if (state === 'active') {
    return `${green('●')} ${option.label}${hint}`;
  }
  if (state === 'selected') {
    return dim(option.label);
  }
  if (state === 'cancelled') {
    return strikethrough(dim(option.label));
  }
  return `${dim('○')} ${dim(option.label)}${hint}`;
}

async function promptText(message: string, initialValue = '', frame?: PromptFrame): Promise<string> {
  if (process.env.JEST_WORKER_ID) {
    const result = await p.text({ message, initialValue, frame } as Parameters<typeof p.text>[0] & { frame?: PromptFrame });
    if (p.isCancel(result)) {
      p.cancel(t('service.cancelled'));
      process.exit(0);
    }

    return String(result);
  }

  const prompt = new TextPrompt({
    initialValue,
    render() {
      const header = promptHeader(this.state, message, frame);
      const value = this.value ? this.valueWithCursor : inverse(hidden('_'));
      switch (this.state) {
        case 'submit':
          return `${header}${gray('│')}  ${dim(this.value || initialValue)}`;
        case 'cancel':
          return `${header}${gray('│')}  ${strikethrough(dim(this.value ?? ''))}`;
        default:
          return `${header}${cyan('│')}  ${value}`;
      }
    }
  });
  const result = await prompt.prompt();
  if (p.isCancel(result)) {
    p.cancel(t('service.cancelled'));
    process.exit(0);
  }

  return String(result);
}

async function promptConfirm(message: string, initialValue = true): Promise<boolean> {
  const result = await p.confirm({
    message,
    initialValue,
    active: t('common.yes'),
    inactive: t('common.no')
  });
  if (p.isCancel(result)) {
    p.cancel(t('service.cancelled'));
    process.exit(0);
  }

  return Boolean(result);
}

async function promptSelect(message: string, options: SelectOption[], initialValue?: string, frame?: PromptFrame): Promise<string> {
  if (process.env.JEST_WORKER_ID) {
    const result = await p.select({ message, options, initialValue, frame } as Parameters<typeof p.select>[0] & { frame?: PromptFrame });
    if (p.isCancel(result)) {
      p.cancel(t('service.cancelled'));
      process.exit(0);
    }

    return String(result);
  }

  const prompt = new SelectPrompt<SelectOption>({
    options,
    initialValue,
    render() {
      const header = promptHeader(this.state, message, frame);
      switch (this.state) {
        case 'submit':
          return `${header}${gray('│')}  ${optionLabel(this.options[this.cursor], 'selected')}`;
        case 'cancel':
          return `${header}${gray('│')}  ${optionLabel(this.options[this.cursor], 'cancelled')}`;
        default:
          return `${header}${cyan('│')}  ${this.options
            .map((option, index) => optionLabel(option, index === this.cursor ? 'active' : 'inactive'))
            .join(`\n${cyan('│')}  `)}`;
      }
    }
  });
  const result = await prompt.prompt();
  if (p.isCancel(result)) {
    p.cancel(t('service.cancelled'));
    process.exit(0);
  }

  return String(result);
}

async function maybeReplaceLoopbackUrl(service: RunestoneServiceRecord): Promise<RunestoneServiceRecord> {
  if (!isContainerLoopbackUrl(service.url)) {
    return service;
  }

  return { ...service, url: await maybeReplaceLoopbackServiceUrl(service.url) };
}

async function maybeReplaceLoopbackServiceUrl(url: string): Promise<string> {
  if (!isContainerLoopbackUrl(url)) {
    return url;
  }

  const replace = await promptConfirm(
    t('service.loopback.prompt', { url }),
    true
  );
  return replace ? replaceServiceUrlHost(url, 'host.docker.internal') : url;
}

function snapshotWithoutRouteOwner(snapshot: Awaited<ReturnType<typeof loadTraefikSnapshot>>, serviceName?: string) {
  if (!serviceName) {
    return snapshot;
  }

  return {
    ...snapshot,
    routers: snapshot.routers.filter((router) => router.name !== serviceName && !router.name.startsWith(`${serviceName}@`))
  };
}

async function routeHostAvailabilityError(config: RunestoneEnv, route: string, ignoredRouteOwnerName?: string): Promise<string | undefined> {
  const snapshot = await loadTraefikSnapshot(config);
  try {
    assertNoTraefikHostConflict(route, snapshotWithoutRouteOwner(snapshot, ignoredRouteOwnerName));
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function assertRouteHostAvailable(config: RunestoneEnv, route: string, ignoredRouteOwnerName?: string): Promise<void> {
  const snapshot = await loadTraefikSnapshot(config);
  assertNoTraefikHostConflict(route, snapshotWithoutRouteOwner(snapshot, ignoredRouteOwnerName));
}

function certificateBaseDomains(config: RunestoneEnv): string[] {
  return Array.from(new Set(
    listDomainCertificates(config.PROJECT_DIR)
      .filter((certificate) => certificate.status === '✓')
      .flatMap((certificate) => certificate.sans)
      .map((san) => san.trim().toLowerCase())
      .filter((san) => san.startsWith('*.'))
      .map((san) => san.slice(2))
  )).sort((left, right) => left.localeCompare(right));
}

function routeCertificateError(config: RunestoneEnv, route: string): string | undefined {
  if (findCoveringCertificate(route, listDomainCertificates(config.PROJECT_DIR))) {
    return undefined;
  }

  try {
    assertRouteCanCreateWildcardCertificate(route);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function assertRouteCertificateReady(config: RunestoneEnv, route: string): void {
  const error = routeCertificateError(config, route);
  if (error) {
    throw new Error(error);
  }
}

function mergeRouteWithBaseDomain(route: string, baseDomain: string): string {
  const routeLabels = route.split('.');
  const baseLabels = baseDomain.split('.');
  const maxOverlap = Math.min(routeLabels.length, baseLabels.length);

  for (let size = maxOverlap; size > 0; size -= 1) {
    const routeSuffix = routeLabels.slice(routeLabels.length - size).join('.');
    const basePrefix = baseLabels.slice(0, size).join('.');
    if (routeSuffix === basePrefix) {
      return [...routeLabels, ...baseLabels.slice(size)].join('.');
    }
  }

  return [...routeLabels, ...baseLabels].join('.');
}

function routeBaseOptions(config: RunestoneEnv, route: string): SelectOption[] {
  const byRoute = new Map<string, { option: SelectOption; baseLabelCount: number }>();

  for (const baseDomain of certificateBaseDomains(config)) {
    const label = mergeRouteWithBaseDomain(route, baseDomain);
    const candidate = {
      option: {
        value: baseDomain,
        label,
        hint: `*.${baseDomain}`
      },
      baseLabelCount: baseDomain.split('.').length
    };
    const existing = byRoute.get(label);
    if (!existing || candidate.baseLabelCount > existing.baseLabelCount) {
      byRoute.set(label, candidate);
    }
  }

  return Array.from(byRoute.values())
    .map((item) => item.option)
    .sort((left, right) => left.label.localeCompare(right.label) || left.value.localeCompare(right.value));
}

async function promptForRouteBaseDomain(config: RunestoneEnv, route: string, description: string): Promise<RoutePromptResult> {
  const selected = await promptSelect(
    t('service.routeBase.prompt'),
    [
      ...routeBaseOptions(config, route),
      { value: ROUTE_MANUAL_VALUE, label: t('service.routeBase.option.manual') }
    ],
    ROUTE_MANUAL_VALUE,
    { description }
  );

  if (selected === ROUTE_MANUAL_VALUE) {
    return { route, forcePrompt: true, description };
  }

  return { route: mergeRouteWithBaseDomain(route, selected), forcePrompt: false };
}

async function promptForRouteDomain(
  config: RunestoneEnv,
  initialRoute: string,
  options: { forcePrompt?: boolean; ignoredRouteOwnerName?: string }
): Promise<string> {
  let route = initialRoute;
  let forcePrompt = options.forcePrompt || !route;
  let description: string | undefined;

  while (true) {
    const candidate = forcePrompt ? await promptText(t('service.prompt.route'), route, { description }) : route;
    description = undefined;
    let normalized: string;
    try {
      normalized = normalizeRouteDomain(candidate, config.HOST_DOMAIN);
    } catch (error) {
      description = error instanceof Error ? error.message : String(error);
      route = candidate;
      forcePrompt = true;
      continue;
    }

    const certificateError = routeCertificateError(config, normalized);
    if (certificateError) {
      const next = await promptForRouteBaseDomain(config, normalized, certificateError);
      route = next.route;
      forcePrompt = next.forcePrompt;
      description = next.description;
      continue;
    }

    const availabilityError = await routeHostAvailabilityError(config, normalized, options.ignoredRouteOwnerName);
    if (!availabilityError) {
      return normalized;
    }

    description = availabilityError;
    route = normalized;
    forcePrompt = true;
  }
}

async function promptForServiceUrl(initialUrl: string, forcePromptOption?: boolean): Promise<string> {
  let url = initialUrl;
  let forcePrompt = forcePromptOption || !url;
  let loopbackPromptedUrl = '';
  let description: string | undefined;

  while (true) {
    const candidate = forcePrompt ? await promptText(t('service.prompt.url'), url, { description }) : url;
    description = undefined;
    let normalized: string;
    try {
      normalized = normalizeServiceUrl(candidate);
    } catch (error) {
      description = error instanceof Error ? error.message : String(error);
      url = candidate;
      forcePrompt = true;
      continue;
    }

    if (normalized === loopbackPromptedUrl) {
      return normalized;
    }

    const checkedUrl = await maybeReplaceLoopbackServiceUrl(normalized);
    if (checkedUrl === normalized) {
      loopbackPromptedUrl = normalized;
    }

    return checkedUrl;
  }
}

async function promptForGroupName(initialGroup: string | null | undefined, forcePromptOption?: boolean): Promise<string | null> {
  let group = initialGroup ?? '';
  let forcePrompt = forcePromptOption || !group;
  let description: string | undefined;

  if (forcePrompt) {
    const existingGroups = Array.from(new Set(toolState.readServices()
      .map((service) => service.group)
      .filter((value): value is string => Boolean(value))))
      .sort((left, right) => left.localeCompare(right));
    const selected = await promptSelect(
      t('service.prompt.group'),
      [
        { value: 'none', label: t('service.group.option.none') },
        ...existingGroups.map((value) => ({ value, label: value })),
        { value: GROUP_CREATE_VALUE, label: t('service.group.option.createNew') }
      ],
      group || 'none'
    );

    if (selected !== GROUP_CREATE_VALUE) {
      return validateGroupName(selected);
    }

    group = '';
  }

  while (true) {
    const candidate = forcePrompt ? await promptText(t('service.prompt.group'), group || '', { description }) : group;
    description = undefined;
    try {
      return validateGroupName(candidate);
    } catch (error) {
      description = error instanceof Error ? error.message : String(error);
      group = candidate;
      forcePrompt = true;
    }
  }
}

async function promptForServiceInput(
  config: RunestoneEnv,
  initial: Partial<RunestoneServiceRecord>,
  options: { includeName: boolean; forcePrompt?: boolean; ignoredRouteOwnerName?: string }
): Promise<RunestoneServiceRecord> {
  let name = initial.name ?? '';

  if (options.includeName) {
    name = await promptForServiceName(name, { forcePrompt: options.forcePrompt });
  }

  const route = await promptForRouteDomain(config, initial.route ?? '', {
    forcePrompt: options.forcePrompt,
    ignoredRouteOwnerName: options.ignoredRouteOwnerName
  });
  const url = await promptForServiceUrl(initial.url ?? '', options.forcePrompt);
  const group = await promptForGroupName(initial.group ?? '', options.forcePrompt);
  return { name, route, url, group };
}

async function promptForServiceName(initialName?: string, options: { forcePrompt?: boolean; description?: string } = {}): Promise<string> {
  let value = initialName ?? '';
  let forcePrompt = options.forcePrompt || !value;
  let description = options.description;

  while (true) {
    const candidate = forcePrompt ? await promptText(t('service.prompt.name'), value, { description }) : value;
    description = undefined;
    try {
      return validateServiceName(candidate);
    } catch (error) {
      description = error instanceof Error ? error.message : String(error);
      value = candidate;
      forcePrompt = true;
    }
  }
}

async function assertServiceNameAvailable(config: RunestoneEnv, name: string): Promise<void> {
  if (serviceExists(name)) {
    throw new Error(t('service.error.existsUseModify', { name }));
  }

  const snapshot = await loadTraefikSnapshot(config);
  assertNoTraefikNameConflict(name, snapshot);
}

async function serviceNameAvailabilityError(config: RunestoneEnv, name: string): Promise<string | undefined> {
  try {
    await assertServiceNameAvailable(config, name);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function promptForAvailableServiceName(config: RunestoneEnv, initialName?: string): Promise<string> {
  let name = initialName;
  let forcePrompt = !name;
  let description: string | undefined;

  while (true) {
    const candidate = await promptForServiceName(name, { forcePrompt, description });
    description = undefined;
    const availabilityError = await serviceNameAvailabilityError(config, candidate);
    if (!availabilityError) {
      return candidate;
    }

    description = availabilityError;
    name = candidate;
    forcePrompt = true;
  }
}

async function createService(config: RunestoneEnv, input: RunestoneServiceRecord): Promise<void> {
  const snapshot = await loadTraefikSnapshot(config);
  assertNoTraefikHostConflict(input.route, snapshot);
  await ensureCertificateCoverage(config, input.route, () =>
    promptConfirm(
      t('service.certificate.createWildcard.prompt', {
        route: input.route,
        wildcard: `*.${certificateBaseDomainForRoute(input.route)}`
      })
    )
  );
  addServiceRecord(input);
  writeServiceDynamicConfig(config, input);
}

async function handleAdd(name: string | undefined, options: AddOptions): Promise<void> {
  const config = envLoader.load();

  let input: RunestoneServiceRecord;
  let directInput: RunestoneServiceRecord | undefined;
  let loopbackCheckedDuringInput = false;
  let routeCheckedDuringInput = false;

  if (name && options.route && options.url) {
    try {
      directInput = prepareServiceInput({ name, route: options.route, url: options.url, group: options.group }, config);
    } catch {
      directInput = undefined;
    }
  }

  if (directInput) {
    input = directInput;
    await assertServiceNameAvailable(config, directInput.name);
  } else {
    const serviceName = await promptForAvailableServiceName(config, name);
    try {
      input = prepareServiceInput({ name: serviceName, route: options.route ?? '', url: options.url ?? '', group: options.group }, config);
    } catch {
      input = await promptForServiceInput(config, { name: serviceName, route: options.route, url: options.url, group: options.group }, { includeName: false });
      input.name = serviceName;
      loopbackCheckedDuringInput = true;
      routeCheckedDuringInput = true;
    }
  }

  if (!routeCheckedDuringInput) {
    await assertRouteHostAvailable(config, input.route);
  }
  assertRouteCertificateReady(config, input.route);
  if (!loopbackCheckedDuringInput) {
    input = await maybeReplaceLoopbackUrl(input);
  }
  await runInDynamicConfigBatch(
    { composeFilePath: config.COMPOSE_FILE_PATH },
    () => createService(config, input)
  );
  logger.success(t('service.success.created', { name: input.name }));
}

async function handleModify(name: string): Promise<void> {
  const config = envLoader.load();
  const service = toolState.readServices().find((item) => item.name === validateServiceName(name));
  if (!service) {
    throw new Error(t('service.error.notFound', { name }));
  }

  const next = await promptForServiceInput(config, service, {
    includeName: false,
    forcePrompt: true,
    ignoredRouteOwnerName: service.name
  });
  next.name = service.name;
  const adjusted = next;
  await runInDynamicConfigBatch({ composeFilePath: config.COMPOSE_FILE_PATH }, async () => {
    await ensureCertificateCoverage(config, adjusted.route, () =>
      promptConfirm(
        t('service.certificate.createWildcard.prompt', {
          route: adjusted.route,
          wildcard: `*.${certificateBaseDomainForRoute(adjusted.route)}`
        })
      )
    );
    updateServiceRecord(adjusted);
    writeServiceDynamicConfig(config, adjusted);
  });
  logger.success(t('service.success.updated', { name: adjusted.name }));
}

function handleList(options: ListOptions): void {
  const config = envLoader.load();
  const rows = listServices(config).map((service) => [
    displayGroupName(service.group),
    service.name,
    service.route,
    service.url,
    service.dynamicConfigExists ? t('service.config.ok') : t('service.config.missing')
  ]);
  const table = formatTable(rows, options.header, [
    t('service.table.groupName'),
    t('service.table.serviceName'),
    t('service.table.route'),
    t('service.table.url'),
    t('service.table.config')
  ]);
  if (table) {
    console.log(table);
  }
}

async function handleRemove(name: string, options: RemoveOptions): Promise<void> {
  const config = envLoader.load();
  const normalized = validateServiceName(name);
  const hasMetadata = serviceExists(normalized);
  const hasDynamicConfig = serviceDynamicConfigExists(config, normalized);
  if (!hasMetadata && !hasDynamicConfig) {
    logger.warn(t('service.warn.notFoundInMetadataOrConfig', { name: normalized }));
    return;
  }

  if (!options.force && !(await promptConfirm(t('service.remove.prompt', { name: normalized }), false))) {
    logger.warn(t('service.remove.cancelled'));
    return;
  }

  let changed = false;
  await runInDynamicConfigBatch({ composeFilePath: config.COMPOSE_FILE_PATH }, () => {
    if (hasMetadata) {
      removeServiceRecord(normalized);
    } else if (!isManagedServiceDynamicConfig(config, normalized)) {
      throw new Error(t('service.error.unmanagedDynamicConfig', { name: normalized }));
    } else {
      logger.warn(t('service.warn.removingManagedConfigOnly', { name: normalized }));
    }
    changed = removeServiceDynamicConfig(config, normalized);
  });
  logger.success(changed || hasMetadata ? t('service.success.removed', { name: normalized }) : t('service.success.metadataRemoved', { name: normalized }));
}

async function handleRepair(name: string): Promise<void> {
  const config = envLoader.load();
  const normalized = validateServiceName(name);
  const service = toolState.readServices().find((item) => item.name === normalized);
  if (!service) {
    throw new Error(t('service.error.notFound', { name: normalized }));
  }

  await runInDynamicConfigBatch(
    { composeFilePath: config.COMPOSE_FILE_PATH },
    () => writeServiceDynamicConfig(config, service)
  );
  logger.success(t('service.success.repaired', { name: normalized }));
}

function handleGroupList(options: GroupListOptions): void {
  const services = toolState.readServices();
  const groups = Array.from(new Set(services.map((service) => displayGroupName(service.group)))).sort();
  if (!options.tree) {
    groups.forEach((group) => console.log(group));
    return;
  }

  for (const group of groups) {
    console.log(group);
    const groupServices = services
      .filter((item) => displayGroupName(item.group) === group)
      .sort((left, right) => left.name.localeCompare(right.name));
    groupServices.forEach((service, index) => {
      const connector = index === groupServices.length - 1 ? '└── ' : '├── ';
      console.log(options.detail
        ? `${connector}${service.name}  ${service.route}  ${service.url}`
        : `${connector}${service.name}`);
    });
  }
}

async function handleGroupClean(groupName: string, options: GroupCleanOptions): Promise<void> {
  const config = envLoader.load();
  const group = validateGroupName(groupName);
  const services = toolState.readServices();
  const targets = services.filter((service) => service.group === group);
  if (targets.length === 0) {
    logger.warn(t('service.group.warn.empty', { group: displayGroupName(group) }));
    return;
  }
  if (!options.force && !(await promptConfirm(t('service.group.clean.prompt', { group: displayGroupName(group) }), false))) {
    logger.warn(t('service.group.clean.cancelled'));
    return;
  }

  if (options.keepServices) {
    toolState.writeServices(services.map((service) => service.group === group ? { ...service, group: null } : service));
    logger.success(t('service.group.success.ungrouped', { group: displayGroupName(group) }));
    return;
  }

  await runInDynamicConfigBatch({ composeFilePath: config.COMPOSE_FILE_PATH }, () => {
    toolState.writeServices(services.filter((service) => service.group !== group));
    for (const service of targets) {
      removeServiceDynamicConfig(config, service.name);
    }
  });
  logger.success(t('service.group.success.removed', { group: displayGroupName(group), count: targets.length }));
}

async function promptForExistingServiceName(initialName?: string): Promise<string> {
  let name = initialName;
  let forcePrompt = !name;
  let description: string | undefined;

  while (true) {
    const candidate = await promptForServiceName(name, { forcePrompt, description });
    description = undefined;
    if (serviceExists(candidate)) {
      return candidate;
    }

    description = t('service.error.notFound', { name: candidate });
    name = candidate;
    forcePrompt = true;
  }
}

async function handleGroupMove(name: string | undefined, groupName: string | undefined): Promise<void> {
  const normalized = await promptForExistingServiceName(name);
  const group = await promptForGroupName(groupName ?? '', !groupName);
  const services = toolState.readServices();
  const service = services.find((item) => item.name === normalized);
  if (!service) {
    throw new Error(t('service.error.notFound', { name: normalized }));
  }

  const next = { ...service, group };
  toolState.writeServices(services.map((item) => item.name === normalized ? next : item));
  logger.success(t('service.group.success.moved', { name: normalized, group: displayGroupName(group) }));
}

async function wrapAsync(action: () => Promise<void> | void, message: string): Promise<void> {
  try {
    await action();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    logger.error(`${message}: ${detail}`);
    process.exit(1);
  }
}

export function createServiceCommand(): Command {
  const command = createCommand('service')
    .description(t('commands.service.description'));

  command
    .addCommand(createCommand('add')
      .description(t('commands.service.add.description'))
      .argument('[name]', t('arguments.serviceName'))
      .option('--route <domain>', t('options.route.description'))
      .option('--url <url>', t('options.url.description'))
      .option('--group <group>', t('options.group.description'))
      .action((name: string | undefined, options: AddOptions) => wrapAsync(() => handleAdd(name, options), t('service.failure.add'))));

  command
    .addCommand(createCommand('modify')
      .alias('m')
      .description(t('commands.service.modify.description'))
      .argument('<name>', t('arguments.serviceName'))
      .action((name: string) => wrapAsync(() => handleModify(name), t('service.failure.modify'))));

  command
    .addCommand(createCommand('repair')
      .description(t('commands.service.repair.description'))
      .argument('<name>', t('arguments.serviceName'))
      .action((name: string) => wrapAsync(() => handleRepair(name), t('service.failure.repair'))));

  command
    .addCommand(createCommand('list')
      .alias('ls')
      .description(t('commands.service.list.description'))
      .option('--no-header', t('options.noHeader.description'))
      .action((options: ListOptions) => wrapAsync(() => handleList(options), t('service.failure.list'))));

  command
    .addCommand(createCommand('remove')
      .alias('rm')
      .description(t('commands.service.remove.description'))
      .argument('<name>', t('arguments.serviceName'))
      .option('--force', t('options.force.description'))
      .action((name: string, options: RemoveOptions) => wrapAsync(() => handleRemove(name, options), t('service.failure.remove'))));

  const group = createCommand('group').description(t('commands.service.group.description'));
  group
    .addCommand(createCommand('list')
      .alias('ls')
      .description(t('commands.service.group.list.description'))
      .option('--tree', t('options.tree.description'))
      .option('--detail', t('options.detail.description'))
      .action((options: GroupListOptions) => wrapAsync(() => handleGroupList(options), t('service.failure.groupList'))));

  group
    .addCommand(createCommand('clean')
      .description(t('commands.service.group.clean.description'))
      .argument('<group>', t('arguments.groupName'))
      .option('--force', t('options.force.description'))
      .option('--keep-services', t('options.keepServices.description'))
      .action((groupName: string, options: GroupCleanOptions) => wrapAsync(() => handleGroupClean(groupName, options), t('service.failure.groupClean'))));

  group
    .addCommand(createCommand('move')
      .alias('mv')
      .description(t('commands.service.group.move.description'))
      .argument('[name]', t('arguments.serviceName'))
      .argument('[group]', t('arguments.groupName'))
      .action((name: string | undefined, groupName: string | undefined) => wrapAsync(() => handleGroupMove(name, groupName), t('service.failure.groupMove'))));

  command.addCommand(group);
  return command;
}
