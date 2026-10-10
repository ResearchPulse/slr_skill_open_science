import { createHash } from 'node:crypto';
import type { McpConfig } from './config.js';
import type { SubmitReviewInput } from './types.js';

export interface ConfirmationPayload {
  profileId: string;
  projectId: string;
  taskId: string;
  decision: string;
  reasoning: string;
  data?: Record<string, unknown>;
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(item => canonicalize(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(',')}}`;
}

export function buildConfirmationPayload(config: McpConfig, taskId: string, input: SubmitReviewInput): ConfirmationPayload {
  return {
    profileId: config.profileId,
    projectId: config.projectId,
    taskId,
    decision: input.decision,
    reasoning: input.reasoning,
    ...(input.data === undefined ? {} : { data: input.data }),
  };
}

export function confirmationDigest(payload: ConfirmationPayload): string {
  return createHash('sha256').update(canonicalize(payload), 'utf8').digest('hex');
}
