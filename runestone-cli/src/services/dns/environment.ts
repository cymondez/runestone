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
  /** `docker info` OSType — anything but `linux` means Windows container mode. */
  osType: () => CommandOutcome;
  /** The active context's name and endpoint. */
  context: () => CommandOutcome;
  /** Runs a short shell script in a throwaway container. */
  runInContainer: (image: string, script: string, options?: { addHostGateway?: boolean }) => CommandOutcome;
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
  osType: () => run('docker', ['info', '--format', '{{.OSType}}'], 30_000),
  context: () => run('docker', ['context', 'inspect', '--format', '{{.Name}}|{{.Endpoints.docker.Host}}'], 30_000),
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
