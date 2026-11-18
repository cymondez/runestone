/**
 * Shared resources the user declares: backing services on this machine that
 * projects should use rather than start their own, such as one Postgres every
 * project creates its own database in.
 *
 * Runestone already knows what it runs itself (Traefik, Mailpit) and lists that
 * from `.env`. It cannot know what else the user runs, which is why agents
 * added their own databases and caches. This is where the user says so.
 *
 * Validation is here, in one place, so the command's prompts and its flags
 * accept exactly the same values.
 */

import { t } from '../i18n';
import { RunestoneResourceRecord, toolState } from '../utils/tool-state';
import { validateServiceName } from './service-manager';

const HOST_LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const NOTES_MAX = 200;

export function validateResourceName(name: string): string {
  return validateServiceName(name, t('resource.label.name'));
}

export function validateResourceKind(kind: string): string {
  return validateServiceName(kind, t('resource.label.kind'));
}

/**
 * `host:port`, nothing else. No scheme and no path, because the same address
 * serves every client library; no `user@`, because a credential in this record
 * would be printed to every agent that reads the context.
 */
export function validateResourceAddress(address: string, label: string): string {
  const value = address.trim();
  if (!value) {
    throw new Error(t('service.validation.required', { label }));
  }
  if (value.includes('@')) {
    throw new Error(t('resource.validation.noCredentials', { label }));
  }

  const match = /^(\[[0-9a-fA-F:.]+\]|[^:/\s]+):(\d{1,5})$/.exec(value);
  const port = match ? Number(match[2]) : 0;
  const host = match ? match[1].toLowerCase() : '';
  const hostValid = host.startsWith('[') || host.split('.').every((labelPart) => HOST_LABEL.test(labelPart));
  if (!match || port < 1 || port > 65535 || !hostValid) {
    throw new Error(t('resource.validation.address', { label }));
  }

  return `${host}:${port}`;
}

export function validateResourceNotes(notes: string | undefined | null): string | null {
  const value = (notes ?? '').trim();
  if (!value) {
    return null;
  }
  if (/[\r\n]/.test(value) || value.length > NOTES_MAX) {
    throw new Error(t('resource.validation.notes', { max: String(NOTES_MAX) }));
  }

  return value;
}

export interface ResourceInput {
  name: string;
  kind: string;
  hostAccess: string;
  containerAccess: string;
  notes?: string | null;
}

export function prepareResource(input: ResourceInput): RunestoneResourceRecord {
  return {
    name: validateResourceName(input.name),
    kind: validateResourceKind(input.kind),
    hostAccess: validateResourceAddress(input.hostAccess, t('resource.label.host')),
    containerAccess: validateResourceAddress(input.containerAccess, t('resource.label.container')),
    notes: validateResourceNotes(input.notes)
  };
}

export function listResources(): RunestoneResourceRecord[] {
  return toolState.readResources().sort((left, right) => left.name.localeCompare(right.name));
}

export function resourceExists(name: string): boolean {
  return toolState.readResources().some((resource) => resource.name === name);
}

export function addResource(resource: RunestoneResourceRecord): void {
  if (resourceExists(resource.name)) {
    throw new Error(t('resource.error.exists', { name: resource.name }));
  }
  toolState.writeResources([...toolState.readResources(), resource]);
}

export function updateResource(resource: RunestoneResourceRecord): void {
  const resources = toolState.readResources();
  if (!resources.some((item) => item.name === resource.name)) {
    throw new Error(t('resource.error.notFound', { name: resource.name }));
  }
  toolState.writeResources(resources.map((item) => (item.name === resource.name ? resource : item)));
}

export function removeResource(name: string): void {
  const resources = toolState.readResources();
  if (!resources.some((item) => item.name === name)) {
    throw new Error(t('resource.error.notFound', { name }));
  }
  toolState.writeResources(resources.filter((item) => item.name !== name));
}
