import { Command } from 'commander';
import * as p from '@clack/prompts';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DEFAULT_ENV, EnvInput, RunestoneEnv, envLoader } from '../utils/env-loader';
import { ensureProjectFiles } from '../utils/project-files';
import { composeService } from '../services/docker-compose';
import { ensureRootCaAliases, ensureWildcardCertificate } from '../services/cert-manager';
import { checkDomainResolvesToThisMachine, DomainResolutionCheck } from '../services/domain-checker';
import { isPortAvailable } from '../services/port-checker';
import { pathHelpers } from '../utils/path-helpers';
import { createCommand } from '../utils/command';
import { loadRunestoneLogo } from '../utils/logo';
import { createTranslator, initialSetupLocale, languageChoices, Locale, resolveLocale, t as translate } from '../i18n';

export interface SetupOptions {
  envPath?: string;
  project?: string;
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

function explainSetting(title: string, description: string | string[]): void {
  const descriptions = Array.isArray(description) ? description : [description];
  p.log.info(`${title}\n${descriptions.map((line) => `  - ${line}`).join('\n')}`);
}

function childPrompt(message: string): string {
  return `── ${message}`;
}

function settingsChanged(existing: RunestoneEnv | undefined, next: EnvInput): boolean {
  if (!existing?.ENV_FILE_EXISTS) {
    return false;
  }

  return (Object.keys(next) as Array<keyof EnvInput>).some((key) => String(existing[key]) !== String(next[key]));
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

async function promptText(message: string, initialValue: string, validate?: (value: string) => string | void): Promise<string> {
  const result = cancelIfNeeded(
    await p.text({
      message,
      initialValue,
      validate
    })
  );

  return result.trim();
}

async function promptPort(options: {
  message: string;
  initialValue: string;
  allowOccupiedValue?: string;
}): Promise<string> {
  while (true) {
    const value = await promptText(options.message, options.initialValue, validatePort);
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

async function maybeCheckDockerDomain(domain: string): Promise<void> {
  if (domain === DEFAULT_ENV.HOST_DOMAIN) {
    return;
  }

  explainSetting('Docker domain check', [
    activeT('setup.domainCheck.description1', { domain }),
    activeT('setup.domainCheck.description2', { domain }),
    activeT('setup.domainCheck.description3')
  ]);

  const shouldCheck = cancelIfNeeded(
    await p.confirm({
      message: activeT('setup.domainCheck.prompt'),
      active: activeT('common.yes'),
      inactive: activeT('common.no'),
      initialValue: true
    })
  );

  if (!shouldCheck) {
    p.log.warn(activeT('setup.domainCheck.skipped'));
    return;
  }

  const spinner = p.spinner();
  spinner.start(activeT('setup.domainCheck.spinner'));
  const result = await checkDomainResolvesToThisMachine(domain);
  spinner.stop(activeT('setup.domainCheck.spinnerDone', { status: result.status }));
  logDomainCheckResult(result);

  if (result.status === 'pass') {
    p.log.success(activeT('setup.domainCheck.success'));
    return;
  }

  const continueAnyway = cancelIfNeeded(
    await p.confirm({
      message:
        result.status === 'warn'
          ? activeT('setup.domainCheck.warnContinue')
          : activeT('setup.domainCheck.failContinue'),
      active: activeT('common.yes'),
      inactive: activeT('common.no'),
      initialValue: result.status === 'warn'
    })
  );

  if (!continueAnyway) {
    p.cancel(activeT('setup.domainCheck.cancelled'));
    process.exit(1);
  }
}

async function createDefaultCertificates(projectDir: string, domain: string): Promise<void> {
  const certsDir = path.join(projectDir, 'certs');
  pathHelpers.ensureDir(certsDir);

  await ensureWildcardCertificate(projectDir, domain, { installLocalCa: true });
  await ensureWildcardCertificate(projectDir, 'traefik.me', { installLocalCa: true });
  const aliasResult = ensureRootCaAliases(certsDir);
  for (const warning of aliasResult.warnings) {
    p.log.warn(warning);
  }
}

export async function runSetup(options: SetupOptions = {}): Promise<RunestoneEnv> {
  p.intro(loadRunestoneLogo());

  let projectDir = pathHelpers.resolveProjectDir(options.project);
  let envPath = setupEnvPath(projectDir, options.envPath);
  let existingConfig = fs.existsSync(envPath) ? envLoader.load(envPath, projectDir) : undefined;
  let selectedLocale = initialSetupLocale(existingConfig?.ENV_FILE_EXISTS ? existingConfig.RUNESTONE_LANG : undefined);
  setActiveLocale(selectedLocale);

  explainSetting(activeT('setup.language.title'), activeT('setup.language.description'));
  selectedLocale = cancelIfNeeded(
    (await p.select({
      message: activeT('setup.language.prompt'),
      options: languageChoices(),
      initialValue: selectedLocale
    })) as Locale | symbol
  );
  setActiveLocale(selectedLocale);

  if (!options.project && !options.envPath && !existingConfig?.ENV_FILE_EXISTS) {
    explainSetting(
      activeT('setup.runestonePath.title'),
      activeT('setup.runestonePath.description')
    );
    const selectedPath = await promptText(activeT('setup.runestonePath.title'), projectDir, (value) => {
      if (!value.trim()) {
        return activeT('setup.runestonePath.required');
      }

      return undefined;
    });
    projectDir = path.resolve(expandHome(selectedPath));
    envPath = setupEnvPath(projectDir, options.envPath);
    existingConfig = fs.existsSync(envPath) ? envLoader.load(envPath, projectDir) : undefined;
  }

  if (existingConfig?.ENV_FILE_EXISTS) {
    p.log.info(activeT('setup.existingSettings', { envPath }));
  }

  explainSetting(
    activeT('setup.dockerDomain.title'),
    activeT('setup.dockerDomain.description')
  );
  const dockerDomain = await promptText(activeT('setup.dockerDomain.title'), existingConfig?.HOST_DOMAIN ?? DEFAULT_ENV.HOST_DOMAIN, (value) => {
    if (!value.trim()) {
      return activeT('setup.dockerDomain.required');
    }

    return undefined;
  });
  await maybeCheckDockerDomain(dockerDomain);

  explainSetting(
    activeT('setup.projectPrefix.title'),
    activeT('setup.projectPrefix.description')
  );
  const projectPrefix = await promptText(activeT('setup.projectPrefix.title'), existingConfig?.PREFIX ?? DEFAULT_ENV.PREFIX, (value) => {
    if (!value.trim()) {
      return activeT('setup.projectPrefix.required');
    }

    return undefined;
  });

  explainSetting(activeT('setup.httpGroup.title'), [
    activeT('setup.httpGroup.description1'),
    activeT('setup.httpGroup.description2')
  ]);
  const webEntrypointName = await promptText(
    childPrompt(activeT('setup.httpName.prompt')),
    existingConfig?.WEB_ENTRYPOINT_NAME ?? DEFAULT_ENV.WEB_ENTRYPOINT_NAME,
    (value) => (!value.trim() ? activeT('setup.httpName.required') : undefined)
  );
  const webEntrypointPort = await promptPort({
    initialValue: existingConfig?.WEB_ENTRYPOINT_PORT ?? DEFAULT_ENV.WEB_ENTRYPOINT_PORT,
    allowOccupiedValue: existingConfig?.WEB_ENTRYPOINT_PORT,
    message: childPrompt(activeT('setup.httpPort.prompt'))
  });

  explainSetting(activeT('setup.httpsGroup.title'), [
    activeT('setup.httpsGroup.description1'),
    activeT('setup.httpsGroup.description2')
  ]);
  const webSecureEntrypointName = await promptText(
    childPrompt(activeT('setup.httpsName.prompt')),
    existingConfig?.WEB_SECURE_ENTRYPOINT_NAME ?? DEFAULT_ENV.WEB_SECURE_ENTRYPOINT_NAME,
    (value) => (!value.trim() ? activeT('setup.httpsName.required') : undefined)
  );
  const webSecureEntrypointPort = await promptPort({
    initialValue: existingConfig?.WEB_SECURE_ENTRYPOINT_PORT ?? DEFAULT_ENV.WEB_SECURE_ENTRYPOINT_PORT,
    allowOccupiedValue: existingConfig?.WEB_SECURE_ENTRYPOINT_PORT,
    message: childPrompt(activeT('setup.httpsPort.prompt'))
  });

  explainSetting(
    activeT('setup.mailpit.title'),
    activeT('setup.mailpit.description')
  );
  const smtpPort = await promptPort({
    initialValue: existingConfig?.SMTP_PORT ?? DEFAULT_ENV.SMTP_PORT,
    allowOccupiedValue: existingConfig?.SMTP_PORT,
    message: childPrompt(activeT('setup.mailpit.prompt'))
  });

  const configToWrite: EnvInput = {
    HOST_DOMAIN: dockerDomain,
    PREFIX: projectPrefix,
    HTTPS_PORT: webSecureEntrypointPort,
    HTTP_PORT: webEntrypointPort,
    SMTP_PORT: smtpPort,
    WEB_ENTRYPOINT_PORT: webEntrypointPort,
    WEB_SECURE_ENTRYPOINT_PORT: webSecureEntrypointPort,
    RUNESTONE_IMAGE: 'cymondez/runstone',
    RUNESTONE_TAG: '5.2',
    MKCERT_INSTALLED: existingConfig?.MKCERT_INSTALLED ?? DEFAULT_ENV.MKCERT_INSTALLED,
    RUNESTONE_LANG: selectedLocale,
    WEB_ENTRYPOINT_NAME: webEntrypointName,
    WEB_SECURE_ENTRYPOINT_NAME: webSecureEntrypointName
  };

  const spinner = p.spinner();
  spinner.start(activeT('setup.writingFiles'));
  envLoader.write(envPath, configToWrite);
  const config = envLoader.load(envPath, projectDir);
  ensureProjectFiles(config, { overwriteCompose: true });
  spinner.stop(activeT('setup.configurationWritten', { envPath }));

  explainSetting(
    activeT('setup.localCa.title'),
    activeT('setup.localCa.description')
  );
  const installMkcert = cancelIfNeeded(
    await p.confirm({
      message: activeT('setup.localCa.prompt'),
      active: activeT('common.yes'),
      inactive: activeT('common.no'),
      initialValue: existingConfig ? existingConfig.MKCERT_INSTALLED === 'true' : true
    })
  );
  configToWrite.MKCERT_INSTALLED = String(Boolean(installMkcert));
  envLoader.write(envPath, { MKCERT_INSTALLED: configToWrite.MKCERT_INSTALLED });

  if (installMkcert) {
    const caSpinner = p.spinner();
    caSpinner.start(activeT('setup.localCa.spinner'));
    await createDefaultCertificates(config.PROJECT_DIR, config.HOST_DOMAIN);
    caSpinner.stop(activeT('setup.localCa.done'));
  }

  if (settingsChanged(existingConfig, configToWrite)) {
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
        composeService.restart(config.COMPOSE_FILE_PATH);
        restartSpinner.stop(activeT('setup.restart.done'));
      } else {
        p.log.warn(activeT('setup.restart.notRunning'));
      }
    }
  }

  p.log.success(activeT('setup.result.path', { path: config.PROJECT_DIR }));
  p.log.success(activeT('setup.result.compose', { path: config.COMPOSE_FILE_PATH }));
  p.log.success(activeT('setup.result.domain', { domain: config.HOST_DOMAIN }));
  p.outro(activeT('setup.outro'));
  return envLoader.load(envPath, projectDir);
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
