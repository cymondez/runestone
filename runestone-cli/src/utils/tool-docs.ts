import * as fs from 'fs';
import * as path from 'path';
import { RunestoneEnv } from './env-loader';

const AI_CONTEXT_TEMPLATE = path.resolve(__dirname, '..', '..', 'tool-docs', 'ai-prompt-context.tmp.md');

function replaceAll(content: string, replacements: Record<string, string>): string {
  return Object.entries(replacements).reduce(
    (next, [key, value]) => next.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), value),
    content
  );
}

export function renderAiPromptContext(config: RunestoneEnv): string {
  const template = fs.readFileSync(AI_CONTEXT_TEMPLATE, 'utf8');
  return replaceAll(template, {
    RUNESTONE_NETWORK_NAME: config.NETWORK_NAME,
    RUNESTONE_HOST_DOMAIN: config.HOST_DOMAIN,
    RUNESTONE_HTTPS_ENTRYPOINT_NAME: config.WEB_SECURE_ENTRYPOINT_NAME,
    RUNESTONE_HTTP_ENTRYPOINT_NAME: config.WEB_ENTRYPOINT_NAME
  });
}
