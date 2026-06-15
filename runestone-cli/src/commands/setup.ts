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

export interface SetupOptions {
  envPath?: string;
  project?: string;
}

function cancelIfNeeded<T>(value: T | symbol): T {
  if (p.isCancel(value)) {
    p.cancel('Setup cancelled.');
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
    return 'Port must be a number';
  }

  const port = Number(trimmed);
  if (port < 1 || port > 65535) {
    return 'Port must be between 1 and 65535';
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

    p.log.warn(`Port ${value} is already in use. Choose an unused port before continuing.`);
  }
}

function logDomainCheckResult(result: DomainResolutionCheck): void {
  p.log.info(
    [
      `Local addresses considered for ${result.domain}:`,
      ...result.localAddresses.map((address) => `  - ${address}`),
      `External IPv6 detected: ${result.hasExternalIpv6 ? 'yes' : 'no'}`
    ].join('\n')
  );

  for (const host of result.checkedHosts) {
    const lines = [
      `${host} resolved to:`,
      ...(host.resolved.length > 0 ? host.resolved.map((record) => `  - ${record.address}`) : ['  - no records'])
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
    `Runestone uses hosts under *.${domain}, so the check only verifies wildcard DNS.`,
    `The wildcard check queries ${`runestone-wildcard-check.${domain}`} instead of the bare domain.`,
    'The check accepts 127.0.0.1, ::1, and IP addresses from local network interfaces.'
  ]);

  const shouldCheck = cancelIfNeeded(
    await p.confirm({
      message: 'Check whether this Docker domain resolves to this machine?',
      initialValue: true
    })
  );

  if (!shouldCheck) {
    p.log.warn('Docker domain resolution check skipped by user.');
    return;
  }

  const spinner = p.spinner();
  spinner.start('Checking Docker domain resolution');
  const result = await checkDomainResolvesToThisMachine(domain);
  spinner.stop(`Docker domain resolution check ${result.status}`);
  logDomainCheckResult(result);

  if (result.status === 'pass') {
    p.log.success('Docker domain resolves to this machine.');
    return;
  }

  const continueAnyway = cancelIfNeeded(
    await p.confirm({
      message:
        result.status === 'warn'
          ? 'Docker domain check has warnings. Ignore and continue?'
          : 'Docker domain check failed. Ignore and continue?',
      initialValue: result.status === 'warn'
    })
  );

  if (!continueAnyway) {
    p.cancel('Setup cancelled. Update DNS or hosts file, then run setup again.');
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
  p.intro('runestone setup');

  let projectDir = pathHelpers.resolveProjectDir(options.project);
  let envPath = setupEnvPath(projectDir, options.envPath);
  let existingConfig = fs.existsSync(envPath) ? envLoader.load(envPath, projectDir) : undefined;

  if (!options.project && !options.envPath && !existingConfig?.ENV_FILE_EXISTS) {
    explainSetting(
      'Runestone path',
      'Runestone stores its .env, compose.yml, certificates, and Traefik configuration here. The default is ~/.runestone.'
    );
    const selectedPath = await promptText('Runestone path', projectDir, (value) => {
      if (!value.trim()) {
        return 'Runestone path is required';
      }

      return undefined;
    });
    projectDir = path.resolve(expandHome(selectedPath));
    envPath = setupEnvPath(projectDir, options.envPath);
    existingConfig = fs.existsSync(envPath) ? envLoader.load(envPath, projectDir) : undefined;
  }

  if (existingConfig?.ENV_FILE_EXISTS) {
    p.log.info(`Existing settings found at ${envPath}. Current values will be used as defaults.`);
  }

  explainSetting(
    'Docker domain',
    'This base domain is used for generated service hostnames such as traefik.<domain> and mailpit.<domain>.'
  );
  const dockerDomain = await promptText('Docker domain', existingConfig?.HOST_DOMAIN ?? DEFAULT_ENV.HOST_DOMAIN, (value) => {
    if (!value.trim()) {
      return 'Domain is required';
    }

    return undefined;
  });
  await maybeCheckDockerDomain(dockerDomain);

  explainSetting(
    'Project prefix',
    'The prefix is used for Docker resource names such as the container, network, and SSH volume.'
  );
  const projectPrefix = await promptText('Project prefix', existingConfig?.PREFIX ?? DEFAULT_ENV.PREFIX, (value) => {
    if (!value.trim()) {
      return 'Prefix is required';
    }

    return undefined;
  });

  explainSetting('HTTP entrypoint & HTTP entrypoint port', [
    'HTTP entrypoint name is passed to the Runestone container.',
    'HTTP entrypoint port defaults to 80 and maps plain HTTP traffic plus Traefik web redirects from the host.'
  ]);
  const webEntrypointName = await promptText(
    childPrompt('HTTP entrypoint name'),
    existingConfig?.WEB_ENTRYPOINT_NAME ?? DEFAULT_ENV.WEB_ENTRYPOINT_NAME,
    (value) => (!value.trim() ? 'HTTP entrypoint name is required' : undefined)
  );
  const webEntrypointPort = await promptPort({
    initialValue: existingConfig?.WEB_ENTRYPOINT_PORT ?? DEFAULT_ENV.WEB_ENTRYPOINT_PORT,
    allowOccupiedValue: existingConfig?.WEB_ENTRYPOINT_PORT,
    message: childPrompt('HTTP entrypoint port')
  });

  explainSetting('HTTPS entrypoint & HTTPS entrypoint port', [
    'HTTPS entrypoint name is passed to the Runestone container.',
    'HTTPS entrypoint port defaults to 443 and is where browsers connect with the generated local certificates.'
  ]);
  const webSecureEntrypointName = await promptText(
    childPrompt('HTTPS entrypoint name'),
    existingConfig?.WEB_SECURE_ENTRYPOINT_NAME ?? DEFAULT_ENV.WEB_SECURE_ENTRYPOINT_NAME,
    (value) => (!value.trim() ? 'HTTPS entrypoint name is required' : undefined)
  );
  const webSecureEntrypointPort = await promptPort({
    initialValue: existingConfig?.WEB_SECURE_ENTRYPOINT_PORT ?? DEFAULT_ENV.WEB_SECURE_ENTRYPOINT_PORT,
    allowOccupiedValue: existingConfig?.WEB_SECURE_ENTRYPOINT_PORT,
    message: childPrompt('HTTPS entrypoint port')
  });

  explainSetting(
    'Mailpit SMTP port',
    'Defaults to 1025. Applications use this host port to send mail into Mailpit during local development.'
  );
  const smtpPort = await promptPort({
    initialValue: existingConfig?.SMTP_PORT ?? DEFAULT_ENV.SMTP_PORT,
    allowOccupiedValue: existingConfig?.SMTP_PORT,
    message: childPrompt('Mailpit SMTP port')
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
    WEB_ENTRYPOINT_NAME: webEntrypointName,
    WEB_SECURE_ENTRYPOINT_NAME: webSecureEntrypointName
  };

  const spinner = p.spinner();
  spinner.start('Writing runestone project files');
  envLoader.write(envPath, configToWrite);
  const config = envLoader.load(envPath, projectDir);
  ensureProjectFiles(config, { overwriteCompose: true });
  spinner.stop(`Configuration written to ${envPath}`);

  explainSetting(
    'Install local CA for SSL certificates',
    'This trusts the local mkcert CA and generates default wildcard certificates for the Runestone domain and traefik.me.'
  );
  const installMkcert = cancelIfNeeded(
    await p.confirm({
      message: 'Install local CA for SSL certificates?',
      initialValue: existingConfig ? existingConfig.MKCERT_INSTALLED === 'true' : true
    })
  );
  configToWrite.MKCERT_INSTALLED = String(Boolean(installMkcert));
  envLoader.write(envPath, { MKCERT_INSTALLED: configToWrite.MKCERT_INSTALLED });

  if (installMkcert) {
    const caSpinner = p.spinner();
    caSpinner.start('Installing local CA and generating default certificates');
    await createDefaultCertificates(config.PROJECT_DIR, config.HOST_DOMAIN);
    caSpinner.stop('Local CA installed and default certificates generated');
  }

  if (settingsChanged(existingConfig, configToWrite)) {
    const restart = cancelIfNeeded(
      await p.confirm({
        message: 'Runestone settings changed. Restart runestone now?',
        initialValue: true
      })
    );

    if (restart) {
      const running = composeService.ps(config.COMPOSE_FILE_PATH).some((container) => container.State === 'running');
      if (running) {
        const restartSpinner = p.spinner();
        restartSpinner.start('Restarting runestone');
        composeService.restart(config.COMPOSE_FILE_PATH);
        restartSpinner.stop('Runestone restarted');
      } else {
        p.log.warn('No running runestone container was found to restart.');
      }
    }
  }

  p.log.success(`Runestone path: ${config.PROJECT_DIR}`);
  p.log.success(`Compose file: ${config.COMPOSE_FILE_PATH}`);
  p.log.success(`Domain: ${config.HOST_DOMAIN}`);
  p.outro('Setup complete. Run `runestone up` to start the environment.');
  return envLoader.load(envPath, projectDir);
}

export function createSetupCommand(): Command {
  return new Command('setup')
    .description('Interactive first-time setup for runestone')
    .option('-e, --env <path>', 'Path to write .env file')
    .option('--project <path>', 'Runestone path for .env and compose.yml')
    .action(async (options: SetupOptions) => {
      try {
        await runSetup(options);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        p.cancel(`Setup failed: ${message}`);
        process.exit(1);
      }
    });
}
