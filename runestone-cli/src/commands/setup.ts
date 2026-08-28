import { Command } from 'commander';
import { ConfirmPrompt, SelectPrompt, TextPrompt } from '@clack/core';
import * as p from '@clack/prompts';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { cyan, dim, gray, green, hidden, inverse, red, strikethrough, yellow } from 'kleur';
import { DEFAULT_ENV, EnvInput, RunestoneEnv, envLoader } from '../utils/env-loader';
import { ensureProjectFiles } from '../utils/project-files';
import { COMPOSE_SERVICES, composeService } from '../services/docker-compose';
import { ensureWildcardCertificate } from '../services/cert-manager';
import { installRootCa } from '../services/root-ca-installer';
import { checkDomainResolvesToThisMachine, DomainResolutionCheck } from '../services/domain-checker';
import { checkEnvironment, DoctorReport, formatDoctorCheck } from '../services/environment-doctor';
import { isPortAvailable } from '../services/port-checker';
import { DnsSetupFacts, dnsSetupFacts } from '../services/dns/lifecycle';
import { preflight } from '../services/dns/enable';
import { DEFAULT_UPSTREAM, invalidAddresses, parseUpstreamList } from '../services/dns/upstream';
import { printPreflight } from './dns-enable';
import { pathHelpers } from '../utils/path-helpers';
import { createCommand } from '../utils/command';
import { loadRunestoneLogo } from '../utils/logo';
import { toolState } from '../utils/tool-state';
import { createTranslator, initialSetupLocale, languageChoices, Locale, resolveLocale, t as translate } from '../i18n';

export interface SetupOptions {
  envPath?: string;
  project?: string;
}

type ReviewAction = 'apply' | 'back' | 'cancel';
type StepResult = 'next' | 'back';
/**
 * `direction` is what the previous step returned. A step that does not apply —
 * the three DNS follow-up questions when DNS is off (spec 11.2) — returns it
 * unchanged, so skipping works the same going backwards as going forwards
 * instead of trapping the user in a step that answers itself.
 */
type SetupStep = (canBack: boolean, direction: StepResult) => Promise<StepResult>;
type DnsUpstreamAction = 'keep' | 'replace' | 'append';
type PromptResult<T> = T | typeof STEP_BACK;

const STEP_BACK = Symbol('runestone:step-back');
const BACK_KEY = '\x1b';

interface SetupDraft {
  projectDir: string;
  envPath: string;
  existingConfig?: RunestoneEnv;
  selectedLocale: Locale;
  dockerDomain?: string;
  projectPrefix?: string;
  webEntrypointName?: string;
  webEntrypointPort?: string;
  webSecureEntrypointName?: string;
  webSecureEntrypointPort?: string;
  smtpPort?: string;
  installMkcert?: boolean;
  enableDns?: boolean;
  dnsUpstream?: string;
  dnsFallback?: boolean;
  dnsAutoReorder?: boolean;
}

interface PromptFrame {
  description?: string | string[];
}

interface SetupSelectOption<T> {
  value: T;
  label?: string;
  hint?: string;
}

let activeT = createTranslator(resolveLocale());

function setActiveLocale(locale: Locale): void {
  activeT = createTranslator(locale);
}

function cancelIfNeeded<T>(value: T | symbol): T {
  if (p.isCancel(value)) {
    p.cancel(activeT('setup.cancelled'));
    process.exit(0);
  }

  return value as T;
}

function isStepBack(value: unknown): value is typeof STEP_BACK {
  return value === STEP_BACK;
}

function expandHome(value: string): string {
  if (value === '~') {
    return os.homedir();
  }

  if (value.startsWith(`~${path.sep}`) || value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(os.homedir(), value.slice(2));
  }

  return value;
}

function setupEnvPath(projectDir: string, envPath?: string): string {
  return envPath ? path.resolve(expandHome(envPath)) : path.join(projectDir, '.env');
}

function childPrompt(message: string): string {
  return `── ${message}`;
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

function optionLabel<T>(option: SetupSelectOption<T>, state: 'active' | 'inactive' | 'selected' | 'cancelled'): string {
  const label = option.label ?? String(option.value);
  if (state === 'active') {
    return `${green('●')} ${label}${option.hint ? ` ${dim(`(${option.hint})`)}` : ''}`;
  }
  if (state === 'selected') {
    return dim(label);
  }
  if (state === 'cancelled') {
    return strikethrough(dim(label));
  }
  return `${dim('○')} ${dim(label)}`;
}

interface BackHotkeyPrompt {
  onKeypress?: (input: string, key?: { name?: string; sequence?: string }) => void;
  value?: unknown;
  state?: string;
  emit?: (event: string) => void;
  render?: () => void;
  close?: () => void;
}

function enableBackHotkey(prompt: unknown, canBack: boolean): void {
  if (!canBack) {
    return;
  }

  const promptInternal = prompt as BackHotkeyPrompt;
  const originalOnKeypress = promptInternal.onKeypress?.bind(prompt);
  promptInternal.onKeypress = (input, key) => {
    if (input === BACK_KEY || key?.name === 'escape' || key?.sequence === BACK_KEY) {
      promptInternal.value = STEP_BACK;
      promptInternal.state = 'submit';
      promptInternal.emit?.('finalize');
      promptInternal.render?.();
      promptInternal.close?.();
      return;
    }

    originalOnKeypress?.(input, key);
  };
}

export const setupPromptTestHooks = {
  enableBackHotkey,
  STEP_BACK
};

function promptDescription(description?: string | string[]): string {
  if (!description) {
    return '';
  }

  const lines = Array.isArray(description) ? description : [description];
  return `${lines.map((line) => `${gray('│')}  ${dim(`- ${line}`)}`).join('\n')}\n`;
}

function promptHotkeys(canBack: boolean): string {
  const hotkeys = [canBack ? activeT('setup.hotkey.back') : undefined, activeT('setup.hotkey.next'), activeT('setup.hotkey.cancel')];
  return hotkeys.filter(Boolean).join(dim(' / '));
}

function promptHeader(state: string, message: string, frame?: PromptFrame): string {
  return `${gray('│')}\n${promptSymbol(state)}  ${message}\n${promptDescription(frame?.description)}`;
}

function promptFooter(canBack: boolean, color: (value: string) => string = cyan): string {
  return `${color('│')}\n${color('└')}  ${dim(promptHotkeys(canBack))}\n`;
}

function settingsChanged(existing: RunestoneEnv | undefined, next: EnvInput): boolean {
  if (!existing?.ENV_FILE_EXISTS) {
    return false;
  }

  return (Object.keys(next) as Array<keyof EnvInput>).some((key) => String(existing[key]) !== String(next[key]));
}

function resetConfiguredValues(draft: SetupDraft): void {
  draft.dockerDomain = undefined;
  draft.projectPrefix = undefined;
  draft.webEntrypointName = undefined;
  draft.webEntrypointPort = undefined;
  draft.webSecureEntrypointName = undefined;
  draft.webSecureEntrypointPort = undefined;
  draft.smtpPort = undefined;
  draft.installMkcert = undefined;
  draft.enableDns = undefined;
  draft.dnsUpstream = undefined;
  draft.dnsFallback = undefined;
  draft.dnsAutoReorder = undefined;
}

function setupConfigInput(draft: SetupDraft): EnvInput {
  return {
    HOST_DOMAIN: draft.dockerDomain,
    PREFIX: draft.projectPrefix,
    HTTPS_PORT: draft.webSecureEntrypointPort,
    HTTP_PORT: draft.webEntrypointPort,
    SMTP_PORT: draft.smtpPort,
    WEB_ENTRYPOINT_PORT: draft.webEntrypointPort,
    WEB_SECURE_ENTRYPOINT_PORT: draft.webSecureEntrypointPort,
    RUNESTONE_IMAGE: 'cymondez/runestone',
    RUNESTONE_TAG: '5.2',
    MKCERT_INSTALLED: String(Boolean(draft.installMkcert)),
    WEB_ENTRYPOINT_NAME: draft.webEntrypointName,
    WEB_SECURE_ENTRYPOINT_NAME: draft.webSecureEntrypointName,
    // The three DNS settings are written; `DNS_ENABLE` is not. Setup never
    // touches the Docker daemon configuration, so claiming DNS is on before
    // `dns enable` has passed preflight and written the entry would be claiming
    // something that is not true (spec 11.2, 13).
    DNS_UPSTREAM: draft.enableDns ? draft.dnsUpstream : undefined,
    DNS_DAEMON_FALLBACK: draft.enableDns && draft.dnsFallback ? dnsFallbackValue(draft) : undefined,
    DNS_AUTO_REORDER: draft.enableDns ? String(Boolean(draft.dnsAutoReorder)) : undefined
  };
}

/**
 * The value the spec 9.7 fallback entry takes: the first upstream, which is the
 * resolver this machine was already using. Anything else would be Runestone
 * choosing a resolver for the user's whole machine on their behalf.
 */
function dnsFallbackValue(draft: SetupDraft): string {
  return parseUpstreamList(draft.dnsUpstream)[0] ?? DEFAULT_UPSTREAM;
}

function reviewLines(draft: SetupDraft): string[] {
  return [
    `${activeT('setup.runestonePath.title')}: ${draft.projectDir}`,
    `${activeT('setup.language.title')}: ${draft.selectedLocale}`,
    `${activeT('setup.dockerDomain.title')}: ${draft.dockerDomain}`,
    `${activeT('setup.projectPrefix.title')}: ${draft.projectPrefix}`,
    `${activeT('setup.httpName.prompt')}: ${draft.webEntrypointName}`,
    `${activeT('setup.httpPort.prompt')}: ${draft.webEntrypointPort}`,
    `${activeT('setup.httpsName.prompt')}: ${draft.webSecureEntrypointName}`,
    `${activeT('setup.httpsPort.prompt')}: ${draft.webSecureEntrypointPort}`,
    `${activeT('setup.mailpit.prompt')}: ${draft.smtpPort}`,
    `${activeT('setup.localCa.prompt')} ${draft.installMkcert ? activeT('common.yes') : activeT('common.no')}`,
    `${activeT('setup.dns.title')}: ${draft.enableDns ? activeT('setup.dns.review.enabled') : activeT('common.no')}`,
    ...(draft.enableDns
      ? [
          `${activeT('setup.dns.upstream.title')}: ${draft.dnsUpstream}`,
          `${activeT('setup.dns.fallback.title')}: ${
            draft.dnsFallback ? dnsFallbackValue(draft) : activeT('common.no')
          }`,
          `${activeT('setup.dns.autoReorder.title')}: ${
            draft.dnsAutoReorder ? activeT('common.yes') : activeT('common.no')
          }`
        ]
      : [])
  ];
}

function environmentCheckDescription(report: DoctorReport): string[] {
  const lines = report.checks.map(formatDoctorCheck);
  if (!report.passed) {
    lines.push(activeT('setup.environment.failed'));
    lines.push(activeT('setup.environment.doctor'));
  }
  return lines;
}

function logPromptDescription(message: string, description: string[]): void {
  console.log(promptHeader('initial', message, { description }).trimEnd());
}

/**
 * Per `AGENTS.md`, a correctable input error returns to the same prompt with the
 * message in its description rather than aborting setup.
 */
function validateUpstreamList(value: string): string | undefined {
  if (parseUpstreamList(value).length === 0) {
    return activeT('setup.dns.upstream.required');
  }

  const invalid = invalidAddresses(value);
  return invalid.length > 0
    ? activeT('setup.dns.upstream.invalid', { values: invalid.join(', ') })
    : undefined;
}

function validatePort(value: string): string | undefined {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return activeT('setup.port.number');
  }

  const port = Number(trimmed);
  if (port < 1 || port > 65535) {
    return activeT('setup.port.range');
  }

  return undefined;
}

async function promptText(
  message: string,
  initialValue: string,
  validate?: (value: string) => string | void,
  canBack = false,
  frame?: PromptFrame
): Promise<PromptResult<string>> {
  const prompt = new TextPrompt({
    initialValue,
    validate,
    render() {
      const header = promptHeader(this.state, message, frame);
      const value = this.value ? this.valueWithCursor : inverse(hidden('_'));
      switch (this.state) {
        case 'error':
          return `${header}${yellow('│')}  ${value}\n${yellow('│')}  ${yellow(this.error)}\n${promptFooter(canBack, yellow)}`;
        case 'submit':
          if (isStepBack(this.value)) {
            return `${header}${gray('│')}  ${dim(activeT('setup.backSubmitted'))}`;
          }
          return `${header}${gray('│')}  ${dim(this.value || initialValue)}`;
        case 'cancel':
          return `${header}${gray('│')}  ${strikethrough(dim(this.value ?? ''))}`;
        default:
          return `${header}${cyan('│')}  ${value}\n${promptFooter(canBack)}`;
      }
    }
  });
  enableBackHotkey(prompt, canBack);
  const result = cancelIfNeeded(
    await prompt.prompt()
  );

  return isStepBack(result) ? STEP_BACK : result.trim();
}

async function promptConfirm(options: {
  message: string;
  initialValue: boolean;
  active?: string;
  inactive?: string;
  canBack?: boolean;
  frame?: PromptFrame;
}): Promise<PromptResult<boolean>> {
  const active = options.active ?? activeT('common.yes');
  const inactive = options.inactive ?? activeT('common.no');
  const canBack = options.canBack ?? false;
  const prompt = new ConfirmPrompt({
    active,
    inactive,
    initialValue: options.initialValue,
    render() {
      const header = promptHeader(this.state, options.message, options.frame);
      const value = this.value ? active : inactive;
      switch (this.state) {
        case 'submit':
          if (isStepBack(this.value)) {
            return `${header}${gray('│')}  ${dim(activeT('setup.backSubmitted'))}`;
          }
          return `${header}${gray('│')}  ${dim(value)}`;
        case 'cancel':
          return `${header}${gray('│')}  ${strikethrough(dim(value))}\n${gray('│')}`;
        default:
          return `${header}${cyan('│')}  ${this.value ? `${green('●')} ${active}` : `${dim('○')} ${dim(active)}`} ${dim('/')} ${this.value ? `${dim('○')} ${dim(inactive)}` : `${green('●')} ${inactive}`}\n${promptFooter(canBack)}`;
      }
    }
  });
  enableBackHotkey(prompt, canBack);
  return cancelIfNeeded((await prompt.prompt()) as unknown as boolean | symbol) as PromptResult<boolean>;
}

async function promptSelect<T>(options: {
  message: string;
  options: Array<SetupSelectOption<T>>;
  initialValue?: T;
  canBack?: boolean;
  frame?: PromptFrame;
}): Promise<PromptResult<T>> {
  const canBack = options.canBack ?? false;
  const prompt = new SelectPrompt({
    options: options.options,
    initialValue: options.initialValue,
    render() {
      const header = promptHeader(this.state, options.message, options.frame);
      switch (this.state) {
        case 'submit':
          if (isStepBack(this.value)) {
            return `${header}${gray('│')}  ${dim(activeT('setup.backSubmitted'))}`;
          }
          return `${header}${gray('│')}  ${optionLabel(this.options[this.cursor], 'selected')}`;
        case 'cancel':
          return `${header}${gray('│')}  ${optionLabel(this.options[this.cursor], 'cancelled')}\n${gray('│')}`;
        default:
          return `${header}${cyan('│')}  ${this.options
            .map((option, index) => optionLabel(option, index === this.cursor ? 'active' : 'inactive'))
            .join(`\n${cyan('│')}  `)}\n${promptFooter(canBack)}`;
      }
    }
  });
  enableBackHotkey(prompt, canBack);
  return cancelIfNeeded((await prompt.prompt()) as unknown as T | symbol) as PromptResult<T>;
}

async function promptReview(draft: SetupDraft): Promise<ReviewAction> {
  const result = await promptSelect<ReviewAction>({
    message: activeT('setup.review.prompt'),
    options: [
      { value: 'apply', label: activeT('setup.review.apply') },
      { value: 'back', label: activeT('setup.review.back') },
      { value: 'cancel', label: activeT('setup.review.cancel') }
    ],
    initialValue: 'apply',
    canBack: true,
    frame: {
      description: reviewLines(draft)
    }
  });

  return isStepBack(result) ? 'back' : result;
}

async function promptPort(options: {
  message: string;
  initialValue: string;
  allowOccupiedValue?: string;
  canBack: boolean;
  frame?: PromptFrame;
}): Promise<PromptResult<string>> {
  while (true) {
    const value = await promptText(options.message, options.initialValue, validatePort, options.canBack, options.frame);
    if (isStepBack(value)) {
      return STEP_BACK;
    }

    if (value === options.allowOccupiedValue) {
      return value;
    }

    const available = await isPortAvailable(Number(value));
    if (available) {
      return value;
    }

    p.log.warn(activeT('setup.port.inUse', { port: value }));
  }
}

function logDomainCheckResult(result: DomainResolutionCheck): void {
  p.log.info(
    [
      activeT('setup.domainCheck.localAddresses', { domain: result.domain }),
      ...result.localAddresses.map((address) => `  - ${address}`),
      activeT('setup.domainCheck.externalIpv6', { value: result.hasExternalIpv6 ? 'yes' : 'no' })
    ].join('\n')
  );

  for (const host of result.checkedHosts) {
    const lines = [
      activeT('setup.domainCheck.resolvedTo', { host: host.host }),
      ...(host.resolved.length > 0
        ? host.resolved.map((record) => `  - ${record.address}`)
        : [`  - ${activeT('setup.domainCheck.noRecords')}`])
    ];
    p.log.info(lines.join('\n'));

    for (const warning of host.warnings) {
      p.log.warn(warning);
    }

    for (const error of host.errors) {
      p.log.error(error);
    }
  }
}

async function maybeCheckDockerDomain(domain: string, canBack: boolean): Promise<StepResult> {
  if (domain === DEFAULT_ENV.HOST_DOMAIN) {
    return 'next';
  }

  const shouldCheck = await promptConfirm({
    message: activeT('setup.domainCheck.prompt'),
    active: activeT('common.yes'),
    inactive: activeT('common.no'),
    initialValue: true,
    canBack,
    frame: {
      description: [
        activeT('setup.domainCheck.description1', { domain }),
        activeT('setup.domainCheck.description2', { domain }),
        activeT('setup.domainCheck.description3')
      ]
    }
  });
  if (isStepBack(shouldCheck)) {
    return 'back';
  }

  if (!shouldCheck) {
    p.log.warn(activeT('setup.domainCheck.skipped'));
    return 'next';
  }

  const spinner = p.spinner();
  spinner.start(activeT('setup.domainCheck.spinner'));
  const result = await checkDomainResolvesToThisMachine(domain);
  spinner.stop(activeT('setup.domainCheck.spinnerDone', { status: result.status }));
  logDomainCheckResult(result);

  if (result.status === 'pass') {
    p.log.success(activeT('setup.domainCheck.success'));
    return 'next';
  }

  const continueAnyway = await promptConfirm({
    message:
      result.status === 'warn'
        ? activeT('setup.domainCheck.warnContinue')
        : activeT('setup.domainCheck.failContinue'),
    active: activeT('common.yes'),
    inactive: activeT('common.no'),
    initialValue: result.status === 'warn',
    canBack
  });
  if (isStepBack(continueAnyway)) {
    return 'back';
  }

  if (!continueAnyway) {
    p.cancel(activeT('setup.domainCheck.cancelled'));
    process.exit(1);
  }

  return 'next';
}

async function createDefaultCertificates(projectDir: string, domain: string): Promise<void> {
  const certsDir = path.join(projectDir, 'certs');
  pathHelpers.ensureDir(certsDir);

  const installResult = await installRootCa(projectDir);
  await ensureWildcardCertificate(projectDir, domain);
  await ensureWildcardCertificate(projectDir, 'traefik.me');
  for (const warning of installResult.aliasResult.warnings) {
    p.log.warn(warning);
  }
}

/**
 * Setup writes the DNS settings; it never writes the Docker daemon
 * configuration. What it does do is run the read-only preflight straight away,
 * so a user who asked for DNS on a machine that cannot have it finds out now
 * rather than at the end of `dns enable`.
 *
 * Spec 11.2: cancelling or failing preflight leaves no daemon configuration,
 * service or state change behind — which is trivially true of a path that never
 * writes any of the three.
 */
function reportDnsPreflight(config: RunestoneEnv): void {
  const spinner = p.spinner();
  spinner.start(activeT('setup.dns.preflight.spinner'));

  let checks;
  try {
    checks = preflight(config);
  } catch (error) {
    spinner.stop(activeT('setup.dns.preflight.unavailable'));
    p.log.warn(error instanceof Error ? error.message : String(error));
    return;
  }

  spinner.stop(activeT('setup.dns.preflight.done'));
  printPreflight(checks);
  p.log.info(checks.ok ? activeT('setup.dns.nextStep') : activeT('setup.dns.preflight.failed'));
}

export async function runSetup(options: SetupOptions = {}): Promise<RunestoneEnv> {
  p.intro(loadRunestoneLogo());

  const initialProjectDir = pathHelpers.resolveProjectDir(options.project);
  const initialEnvPath = setupEnvPath(initialProjectDir, options.envPath);
  const initialExistingConfig = fs.existsSync(initialEnvPath) ? envLoader.load(initialEnvPath, initialProjectDir) : undefined;
  const draft: SetupDraft = {
    projectDir: initialProjectDir,
    envPath: initialEnvPath,
    existingConfig: initialExistingConfig,
    selectedLocale: initialSetupLocale(toolState.readLocale())
  };
  setActiveLocale(draft.selectedLocale);

  // Read once: the daemon path and the host's resolvers do not change while
  // setup is running, and asking again on every back-and-forth through the
  // questions would leave the descriptions flickering.
  let cachedDnsFacts: DnsSetupFacts | undefined;
  const dnsFacts = (): DnsSetupFacts => {
    cachedDnsFacts ??= dnsSetupFacts(draft.existingConfig ?? envLoader.load(draft.envPath, draft.projectDir));
    return cachedDnsFacts;
  };

  let announcedEnvPath: string | undefined;
  const announceExistingSettings = () => {
    if (draft.existingConfig?.ENV_FILE_EXISTS && announcedEnvPath !== draft.envPath) {
      p.log.info(activeT('setup.existingSettings', { envPath: draft.envPath }));
      announcedEnvPath = draft.envPath;
    }
  };

  const steps: SetupStep[] = [
    async () => {
      const report = checkEnvironment();
      logPromptDescription(activeT('setup.environment.prompt'), environmentCheckDescription(report));
      if (!report.passed) {
        p.cancel(activeT('setup.environment.cancelled'));
        process.exit(1);
      }
      return 'next';
    },
    async (canBack) => {
      const selectedLocale = await promptSelect<Locale>({
        message: activeT('setup.language.prompt'),
        options: languageChoices(),
        initialValue: draft.selectedLocale,
        canBack,
        frame: { description: activeT('setup.language.description') }
      });
      if (isStepBack(selectedLocale)) {
        return 'back';
      }

      draft.selectedLocale = selectedLocale;
      setActiveLocale(draft.selectedLocale);
      return 'next';
    }
  ];

  if (!options.project && !options.envPath && !initialExistingConfig?.ENV_FILE_EXISTS) {
    steps.push(async (canBack) => {
      const selectedPath = await promptText(
        activeT('setup.runestonePath.title'),
        draft.projectDir,
        (value) => (!value.trim() ? activeT('setup.runestonePath.required') : undefined),
        canBack,
        { description: activeT('setup.runestonePath.description') }
      );
      if (isStepBack(selectedPath)) {
        return 'back';
      }

      const nextProjectDir = path.resolve(expandHome(selectedPath));
      if (nextProjectDir !== draft.projectDir) {
        resetConfiguredValues(draft);
        announcedEnvPath = undefined;
      }

      draft.projectDir = nextProjectDir;
      draft.envPath = setupEnvPath(draft.projectDir, options.envPath);
      draft.existingConfig = fs.existsSync(draft.envPath) ? envLoader.load(draft.envPath, draft.projectDir) : undefined;
      return 'next';
    });
  }

  steps.push(
    async (canBack) => {
      announceExistingSettings();
      while (true) {
        const dockerDomain = await promptText(
          activeT('setup.dockerDomain.title'),
          draft.dockerDomain ?? draft.existingConfig?.HOST_DOMAIN ?? DEFAULT_ENV.HOST_DOMAIN,
          (value) => (!value.trim() ? activeT('setup.dockerDomain.required') : undefined),
          canBack,
          { description: activeT('setup.dockerDomain.description') }
        );
        if (isStepBack(dockerDomain)) {
          return 'back';
        }

        draft.dockerDomain = dockerDomain;
        const domainCheckResult = await maybeCheckDockerDomain(draft.dockerDomain, true);
        if (domainCheckResult === 'back') {
          continue;
        }

        return 'next';
      }
    },
    async (canBack) => {
      const projectPrefix = await promptText(
        activeT('setup.projectPrefix.title'),
        draft.projectPrefix ?? draft.existingConfig?.PREFIX ?? DEFAULT_ENV.PREFIX,
        (value) => (!value.trim() ? activeT('setup.projectPrefix.required') : undefined),
        canBack,
        { description: activeT('setup.projectPrefix.description') }
      );
      if (isStepBack(projectPrefix)) {
        return 'back';
      }

      draft.projectPrefix = projectPrefix;
      return 'next';
    },
    async (canBack) => {
      const webEntrypointName = await promptText(
        childPrompt(activeT('setup.httpName.prompt')),
        draft.webEntrypointName ?? draft.existingConfig?.WEB_ENTRYPOINT_NAME ?? DEFAULT_ENV.WEB_ENTRYPOINT_NAME,
        (value) => (!value.trim() ? activeT('setup.httpName.required') : undefined),
        canBack,
        {
          description: [
            activeT('setup.httpGroup.title'),
            activeT('setup.httpGroup.description1')
          ]
        }
      );
      if (isStepBack(webEntrypointName)) {
        return 'back';
      }

      draft.webEntrypointName = webEntrypointName;
      return 'next';
    },
    async (canBack) => {
      const webEntrypointPort = await promptPort({
        initialValue: draft.webEntrypointPort ?? draft.existingConfig?.WEB_ENTRYPOINT_PORT ?? DEFAULT_ENV.WEB_ENTRYPOINT_PORT,
        allowOccupiedValue: draft.existingConfig?.WEB_ENTRYPOINT_PORT,
        message: childPrompt(activeT('setup.httpPort.prompt')),
        canBack,
        frame: {
          description: [
            activeT('setup.httpGroup.title'),
            activeT('setup.httpGroup.description2')
          ]
        }
      });
      if (isStepBack(webEntrypointPort)) {
        return 'back';
      }

      draft.webEntrypointPort = webEntrypointPort;
      return 'next';
    },
    async (canBack) => {
      const webSecureEntrypointName = await promptText(
        childPrompt(activeT('setup.httpsName.prompt')),
        draft.webSecureEntrypointName ?? draft.existingConfig?.WEB_SECURE_ENTRYPOINT_NAME ?? DEFAULT_ENV.WEB_SECURE_ENTRYPOINT_NAME,
        (value) => (!value.trim() ? activeT('setup.httpsName.required') : undefined),
        canBack,
        {
          description: [
            activeT('setup.httpsGroup.title'),
            activeT('setup.httpsGroup.description1')
          ]
        }
      );
      if (isStepBack(webSecureEntrypointName)) {
        return 'back';
      }

      draft.webSecureEntrypointName = webSecureEntrypointName;
      return 'next';
    },
    async (canBack) => {
      const webSecureEntrypointPort = await promptPort({
        initialValue:
          draft.webSecureEntrypointPort ??
          draft.existingConfig?.WEB_SECURE_ENTRYPOINT_PORT ??
          DEFAULT_ENV.WEB_SECURE_ENTRYPOINT_PORT,
        allowOccupiedValue: draft.existingConfig?.WEB_SECURE_ENTRYPOINT_PORT,
        message: childPrompt(activeT('setup.httpsPort.prompt')),
        canBack,
        frame: {
          description: [
            activeT('setup.httpsGroup.title'),
            activeT('setup.httpsGroup.description2')
          ]
        }
      });
      if (isStepBack(webSecureEntrypointPort)) {
        return 'back';
      }

      draft.webSecureEntrypointPort = webSecureEntrypointPort;
      return 'next';
    },
    async (canBack) => {
      const smtpPort = await promptPort({
        initialValue: draft.smtpPort ?? draft.existingConfig?.SMTP_PORT ?? DEFAULT_ENV.SMTP_PORT,
        allowOccupiedValue: draft.existingConfig?.SMTP_PORT,
        message: childPrompt(activeT('setup.mailpit.prompt')),
        canBack,
        frame: { description: activeT('setup.mailpit.description') }
      });
      if (isStepBack(smtpPort)) {
        return 'back';
      }

      draft.smtpPort = smtpPort;
      return 'next';
    },
    async (canBack) => {
      const installMkcert = await promptConfirm({
        message: activeT('setup.localCa.prompt'),
        active: activeT('common.yes'),
        inactive: activeT('common.no'),
        initialValue:
          draft.installMkcert ??
          (draft.existingConfig ? draft.existingConfig.MKCERT_INSTALLED === 'true' : true),
        canBack,
        frame: {
          description: [
            activeT('setup.localCa.description'),
            activeT('setup.localCa.descriptionSystem'),
            activeT('setup.localCa.descriptionNss')
          ]
        }
      });
      if (isStepBack(installMkcert)) {
        return 'back';
      }

      draft.installMkcert = installMkcert;
      return 'next';
    },
    // Spec 11.2, question 1. Its description carries disclosure items 1, 2, 3, 4
    // and 7 with the daemon path this machine would actually use — the point of
    // 11.3 being that the user consents to concrete actions, not to a warning.
    async (canBack) => {
      const facts = dnsFacts();
      const enableDns = await promptConfirm({
        message: activeT('setup.dns.prompt'),
        initialValue: draft.enableDns ?? false,
        canBack,
        frame: {
          description: [
            activeT('setup.dns.description'),
            activeT('setup.dns.disclose.1', { path: facts.daemonPath }),
            activeT('setup.dns.disclose.2'),
            activeT('setup.dns.disclose.3'),
            activeT('setup.dns.disclose.4'),
            activeT('setup.dns.disclose.7'),
            activeT('setup.dns.appliesLater')
          ]
        }
      });
      if (isStepBack(enableDns)) {
        return 'back';
      }

      draft.enableDns = enableDns;
      return 'next';
    },
    // Question 2. The computed list is shown with the origin of every value, so
    // "keep" is a decision about something visible rather than about a default.
    async (canBack, direction) => {
      if (!draft.enableDns) {
        return direction;
      }

      const facts = dnsFacts();
      const computed = draft.dnsUpstream ?? facts.upstreams.upstreams.join(',');
      const description = [
        activeT('setup.dns.upstream.description'),
        activeT('setup.dns.upstream.computed', { values: computed }),
        ...facts.upstreams.origins.map((entry) =>
          activeT(`setup.dns.upstream.origin.${entry.origin}`, { value: entry.value })
        ),
        activeT('setup.dns.upstream.pool')
      ];

      const action = await promptSelect<DnsUpstreamAction>({
        message: activeT('setup.dns.upstream.prompt'),
        options: [
          { value: 'keep', label: activeT('setup.dns.upstream.keep') },
          { value: 'replace', label: activeT('setup.dns.upstream.replace') },
          { value: 'append', label: activeT('setup.dns.upstream.append') }
        ],
        initialValue: 'keep',
        canBack,
        frame: { description }
      });
      if (isStepBack(action)) {
        return 'back';
      }

      if (action === 'keep') {
        draft.dnsUpstream = computed;
        return 'next';
      }

      const entered = await promptText(
        activeT(`setup.dns.upstream.${action}.prompt`),
        action === 'append' ? '' : computed,
        validateUpstreamList,
        canBack,
        { description }
      );
      if (isStepBack(entered)) {
        return 'back';
      }

      draft.dnsUpstream =
        action === 'append'
          ? [...parseUpstreamList(computed), ...parseUpstreamList(entered)].join(',')
          : parseUpstreamList(entered).join(',');
      return 'next';
    },
    // Question 3. Spec 9.7 requires **both** directions: describing only the
    // benefit hides the cost, describing only the cost hides the benefit, and
    // either one alone is a verdict dressed up as advice.
    async (canBack, direction) => {
      if (!draft.enableDns) {
        return direction;
      }

      const dnsFallback = await promptConfirm({
        message: activeT('setup.dns.fallback.prompt'),
        initialValue: draft.dnsFallback ?? false,
        canBack,
        frame: {
          description: [
            activeT('setup.dns.fallback.description', { value: dnsFallbackValue(draft) }),
            activeT('setup.dns.fallback.benefit'),
            activeT('setup.dns.fallback.cost'),
            activeT('setup.dns.fallback.adviceShared'),
            activeT('setup.dns.fallback.adviceSolo'),
            activeT('setup.dns.fallback.adviceUnsure')
          ]
        }
      });
      if (isStepBack(dnsFallback)) {
        return 'back';
      }

      draft.dnsFallback = dnsFallback;
      return 'next';
    },
    // Question 4. Both modes carry a risk, and the description states both:
    // leaving it off can silently stop DNS taking effect, turning it on means
    // Runestone rewrites the daemon configuration on every `up`.
    async (canBack, direction) => {
      if (!draft.enableDns) {
        return direction;
      }

      const dnsAutoReorder = await promptConfirm({
        message: activeT('setup.dns.autoReorder.prompt'),
        initialValue: draft.dnsAutoReorder ?? false,
        canBack,
        frame: {
          description: [
            activeT('setup.dns.autoReorder.description'),
            activeT('setup.dns.autoReorder.riskOff'),
            activeT('setup.dns.autoReorder.riskOn')
          ]
        }
      });
      if (isStepBack(dnsAutoReorder)) {
        return 'back';
      }

      draft.dnsAutoReorder = dnsAutoReorder;
      return 'next';
    }
  );

  let stepIndex = 0;
  let direction: StepResult = 'next';
  while (true) {
    while (stepIndex < steps.length) {
      const stepResult = await steps[stepIndex](stepIndex > 0, direction);
      direction = stepResult;
      stepIndex += stepResult === 'back' ? -1 : 1;
    }

    const reviewAction = await promptReview(draft);
    if (reviewAction === 'apply') {
      break;
    }
    if (reviewAction === 'cancel') {
      p.cancel(activeT('setup.cancelled'));
      process.exit(0);
    }

    direction = 'back';
    stepIndex = Math.max(steps.length - 1, 0);
  }

  const configToWrite = setupConfigInput(draft);

  const spinner = p.spinner();
  spinner.start(activeT('setup.writingFiles'));
  envLoader.write(draft.envPath, configToWrite);
  const config = envLoader.load(draft.envPath, draft.projectDir);
  ensureProjectFiles(config, { overwriteCompose: true });
  toolState.writeSetupState({ runestonePath: draft.projectDir, locale: draft.selectedLocale });
  spinner.stop(activeT('setup.configurationWritten', { envPath: draft.envPath }));

  if (draft.installMkcert) {
    const caSpinner = p.spinner();
    caSpinner.start(activeT('setup.localCa.spinner'));
    await createDefaultCertificates(config.PROJECT_DIR, config.HOST_DOMAIN);
    caSpinner.stop(activeT('setup.localCa.done'));
  }

  if (settingsChanged(draft.existingConfig, configToWrite)) {
    const restart = cancelIfNeeded(
      await p.confirm({
        message: activeT('setup.restart.prompt'),
        active: activeT('common.yes'),
        inactive: activeT('common.no'),
        initialValue: true
      })
    );

    if (restart) {
      const running = composeService.ps(config.COMPOSE_FILE_PATH).some((container) => container.State === 'running');
      if (running) {
        const restartSpinner = p.spinner();
        restartSpinner.start(activeT('setup.restart.spinner'));
        composeService.restart(config.COMPOSE_FILE_PATH, [COMPOSE_SERVICES.runestone]);
        restartSpinner.stop(activeT('setup.restart.done'));
      } else {
        p.log.warn(activeT('setup.restart.notRunning'));
      }
    }
  }

  if (draft.enableDns) {
    reportDnsPreflight(config);
  }

  p.log.success(activeT('setup.result.path', { path: config.PROJECT_DIR }));
  p.log.success(activeT('setup.result.compose', { path: config.COMPOSE_FILE_PATH }));
  p.log.success(activeT('setup.result.domain', { domain: config.HOST_DOMAIN }));
  p.outro(activeT('setup.outro'));
  return envLoader.load(draft.envPath, draft.projectDir);
}

export function createSetupCommand(): Command {
  return createCommand('setup')
    .description(translate('commands.setup.description'))
    .action(async () => {
      try {
        await runSetup();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        p.cancel(activeT('setup.failed', { message }));
        process.exit(1);
      }
    });
}
