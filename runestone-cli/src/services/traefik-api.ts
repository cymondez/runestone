import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';

export interface TraefikNamedResource {
  name: string;
  rule?: string;
}

export interface TraefikSnapshot {
  routers: TraefikNamedResource[];
  services: TraefikNamedResource[];
}

function readJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;
    const request = client.get(
      parsed,
      {
        timeout: 5000,
        rejectUnauthorized: false
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => {
          if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`Traefik API returned HTTP ${response.statusCode ?? 'unknown'}`));
            return;
          }

          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error('Traefik API returned invalid JSON'));
          }
        });
      }
    );

    request.on('timeout', () => {
      request.destroy(new Error('Traefik API request timed out'));
    });
    request.on('error', reject);
  });
}

function normalizeResources(value: unknown): TraefikNamedResource[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => {
    const record = item as Record<string, unknown>;
    return {
      name: String(record.name ?? record.Name ?? ''),
      rule: typeof record.rule === 'string' ? record.rule : typeof record.Rule === 'string' ? record.Rule : undefined
    };
  }).filter((item) => item.name);
}

export async function readTraefikSnapshot(baseUrl: string): Promise<TraefikSnapshot> {
  const normalized = baseUrl.replace(/\/+$/, '');
  const [routers, services] = await Promise.all([
    readJson(`${normalized}/api/http/routers`),
    readJson(`${normalized}/api/http/services`)
  ]);

  return {
    routers: normalizeResources(routers),
    services: normalizeResources(services)
  };
}
