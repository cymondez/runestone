import { spawnCommand } from '../../utils/spawn';

/**
 * The Docker-side facts `dns enable` has to establish before it touches
 * anything (spec 10.1 step 1), and the real query it makes afterwards to prove
 * the service answers (step 3).
 *
 * Every probe here runs a throwaway container or reads Docker metadata; none of
 * them changes anything. They are injectable so the flow around them can be
 * tested without Docker at all.
 */

export interface CommandOutcome {
  ok: boolean;
  stdout: string;
  message?: string;
}

export interface DockerProbes {
  /**
   * `docker info`, as `<OSType>|<OperatingSystem>`. The first tells Windows
   * container mode apart from Linux; the second says **which daemon this is**,
   * which is the only reliable way to know whether its configuration file is the
   * Docker Desktop one or a native engine's.
   */
  osType: () => CommandOutcome;
  /** The active context's name and endpoint. */
  context: () => CommandOutcome;
  /** Runs a short shell script in a throwaway container. */
  runInContainer: (image: string, script: string, options?: { addHostGateway?: boolean }) => CommandOutcome;
  /**
   * Docker Desktop's own version, as `Docker Desktop 4.88.1 (237512)`.
   *
   * Deliberately not `docker desktop version`, which reports the CLI plugin's
   * version (`v0.4.3`) and says nothing about the application around it.
   */
  platformName: () => CommandOutcome;
}

function run(command: string, args: string[], timeout = 60_000): CommandOutcome {
  const result = spawnCommand(command, args, { encoding: 'utf8', timeout });
  if (result.error) {
    return { ok: false, stdout: '', message: result.error.message };
  }

  const stdout = (result.stdout ?? '').trim();
  if (result.status !== 0) {
    return { ok: false, stdout, message: result.stderr?.trim() || stdout || `exit ${String(result.status)}` };
  }

  return { ok: true, stdout };
}

export const defaultDockerProbes: DockerProbes = {
  osType: () => run('docker', ['info', '--format', '{{.OSType}}|{{.OperatingSystem}}'], 30_000),
  context: () => run('docker', ['context', 'inspect', '--format', '{{.Name}}|{{.Endpoints.docker.Host}}'], 30_000),
  platformName: () => run('docker', ['version', '--format', '{{.Server.Platform.Name}}'], 30_000),
  runInContainer: (image, script, options) =>
    run(
      'docker',
      [
        'run',
        '--rm',
        '--entrypoint',
        'sh',
        // `host.docker.internal` exists by default on Docker Desktop but not on a
        // native engine, where the gateway alias has to be asked for.
        ...(options?.addHostGateway === false ? [] : ['--add-host', 'host.docker.internal:host-gateway']),
        image,
        '-c',
        script
      ],
      120_000
    )
};

/**
 * The first Docker Desktop release whose restart leaves containers recoverable.
 *
 * Before it, `docker desktop restart` stopped the running containers, and
 * `unless-stopped` means "restart unless it was stopped" — so those stayed down
 * for good. From this version on that is fixed, which is what makes an automatic
 * restart safe to attempt at all.
 */
export const DESKTOP_SAFE_RESTART_VERSION = '4.86.0';

export interface DockerDesktopVersion {
  raw: string;
  /** Dotted version, e.g. `4.88.1`. Absent when the string could not be parsed. */
  version?: string;
}

export function readDesktopVersion(probes: Partial<DockerProbes> = {}): DockerDesktopVersion | undefined {
  const outcome = { ...defaultDockerProbes, ...probes }.platformName();
  if (!outcome.ok || outcome.stdout.trim() === '') {
    return undefined;
  }

  const raw = outcome.stdout.trim();
  const match = /(\d+(?:\.\d+)+)/.exec(raw);
  return { raw, version: match?.[1] };
}

function compareVersions(left: string, right: string): number {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);

  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }

  return 0;
}

/**
 * Whether this Docker Desktop can be restarted without stranding the machine's
 * containers. **Unknown counts as unsafe**: a version that could not be read is
 * not evidence of a version that is new enough, and the cost of being wrong is
 * someone's containers staying down.
 */
export function desktopRestartIsSafe(
  version: DockerDesktopVersion | undefined,
  minimum = DESKTOP_SAFE_RESTART_VERSION
): boolean {
  return version?.version !== undefined && compareVersions(version.version, minimum) >= 0;
}

export interface DaemonInfo {
  osType: string;
  operatingSystem: string;
  /** Docker Desktop keeps its configuration in the user's home, not /etc. */
  isDockerDesktop: boolean;
}

export function readDaemonInfo(probes: Partial<DockerProbes> = {}): DaemonInfo | undefined {
  const outcome = { ...defaultDockerProbes, ...probes }.osType();
  if (!outcome.ok) {
    return undefined;
  }

  const [osType = '', operatingSystem = ''] = outcome.stdout.split('|');
  return {
    osType: osType.trim(),
    operatingSystem: operatingSystem.trim(),
    isDockerDesktop: operatingSystem.trim().toLowerCase().includes('docker desktop')
  };
}

/** A context whose endpoint is not a local socket is a machine we must not touch. */
export function isRemoteEndpoint(endpoint: string): boolean {
  const host = endpoint.trim().toLowerCase();
  if (host === '') {
    return false;
  }

  return !host.startsWith('unix://') && !host.startsWith('npipe://');
}

export interface DockerContextInfo {
  name: string;
  endpoint: string;
  remote: boolean;
}

export function readDockerContext(probes: Partial<DockerProbes> = {}): DockerContextInfo | undefined {
  const outcome = { ...defaultDockerProbes, ...probes }.context();
  if (!outcome.ok) {
    return undefined;
  }

  const [name, endpoint = ''] = outcome.stdout.split('|');
  return { name: name.trim(), endpoint: endpoint.trim(), remote: isRemoteEndpoint(endpoint) };
}

const IPV4 = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

export interface TargetIpResult {
  ip?: string;
  error?: string;
}

/**
 * Spec 10.1: the Target IP is whatever `host.docker.internal` resolves to **from
 * inside the Docker environment**, not from the host. Asking the host would give
 * a different answer on Docker Desktop, where that address exists only inside the
 * Docker VM.
 */
export function resolveTargetIp(image: string, probes: Partial<DockerProbes> = {}): TargetIpResult {
  const deps = { ...defaultDockerProbes, ...probes };
  const outcome = deps.runInContainer(image, 'getent ahostsv4 host.docker.internal | head -1 | cut -d" " -f1');

  if (!outcome.ok) {
    return { error: outcome.message ?? 'could not run a container to resolve host.docker.internal' };
  }

  const candidate = outcome.stdout.split(/\r?\n/).map((row) => row.trim()).filter((row) => IPV4.test(row))[0];

  return candidate ? { ip: candidate } : { error: `no IPv4 address in: ${outcome.stdout || '(no output)'}` };
}

/**
 * Spec 10.1 step 6: a newly created container's resolv.conf must list the Target
 * IP **first**. Anything else means the daemon setting did not take, or that
 * something else is being consulted before us.
 */
export function readContainerNameservers(image: string, probes: Partial<DockerProbes> = {}): string[] {
  const deps = { ...defaultDockerProbes, ...probes };
  const outcome = deps.runInContainer(image, 'cat /etc/resolv.conf', { addHostGateway: false });

  if (!outcome.ok) {
    return [];
  }

  return outcome.stdout
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter((row) => row.startsWith('nameserver'))
    .map((row) => row.replace(/^nameserver\s+/, '').trim())
    .filter((row) => row !== '');
}

export interface ResolutionCheck {
  ok: boolean;
  answers: string[];
  error?: string;
}

/**
 * Spec 10.1 step 3: **verify for real.** A container that started is not a
 * container that answers, and the whole feature exists to stop a wrong answer
 * from looking like a right one — so the check is an actual query for an actual
 * managed domain, requiring the Target IP in the reply.
 */
export function verifyDomainResolution(
  image: string,
  domain: string,
  serverIp: string,
  probes: Partial<DockerProbes> = {}
): ResolutionCheck {
  const deps = { ...defaultDockerProbes, ...probes };
  const outcome = deps.runInContainer(image, `dig +short +time=3 +tries=2 @${serverIp} ${domain} A`);

  if (!outcome.ok) {
    return { ok: false, answers: [], error: outcome.message ?? 'the query could not be run' };
  }

  const answers = outcome.stdout
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter((row) => IPV4.test(row));

  return answers.includes(serverIp)
    ? { ok: true, answers }
    : { ok: false, answers, error: `expected ${serverIp}, got ${answers.join(', ') || '(no answer)'}` };
}
