export interface McpConfig {
  apiBaseUrl: string;
  agentToken: string;
  timeoutMs: number;
  profileId: string;
  projectId: string;
  projectName: string;
  allowedHosts: string[];
  maxJsonResponseBytes: number;
  maxMarkdownResponseBytes: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_JSON_RESPONSE_BYTES = 1 * 1024 * 1024;
const DEFAULT_MARKDOWN_RESPONSE_BYTES = 8 * 1024 * 1024;
const APPROVED_API_HOSTS = ['slr-api.hyperdatalab.org', 'localhost', '127.0.0.1', '[::1]', '::1'];

function requiredValue(name: string, value: string | undefined): string {
  const normalized = value?.trim() || '';
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function normalizeApiBaseUrl(raw: string, allowedHosts: string[] = []): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('SLR_API_BASE_URL must be a valid http(s) URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('SLR_API_BASE_URL must use http or https');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('SLR_API_BASE_URL must not contain credentials, query parameters, or fragments');
  }
  if (!allowedHosts.includes(parsed.hostname.toLowerCase())) {
    throw new Error('SLR_API_BASE_URL host is not in the approved SLR API allowlist');
  }

  const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
  if (parsed.protocol === 'http:' && !loopbackHosts.has(parsed.hostname.toLowerCase())) {
    throw new Error('SLR_API_BASE_URL must use HTTPS unless it targets local loopback development');
  }

  return parsed.toString().replace(/\/+$/, '');
}

function parseTimeout(raw: string | undefined): number {
  if (!raw?.trim()) return DEFAULT_TIMEOUT_MS;
  const timeout = Number(raw);
  if (!Number.isInteger(timeout) || timeout < 1_000 || timeout > 120_000) {
    throw new Error('SLR_REQUEST_TIMEOUT_MS must be an integer from 1000 to 120000');
  }
  return timeout;
}

function parseResponseLimit(name: string, raw: string | undefined, fallback: number, max: number): number {
  if (!raw?.trim()) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 16 * 1024 || value > max) {
    throw new Error(`${name} must be an integer between 16384 and ${max}`);
  }
  return value;
}

function parseAllowedHosts(raw: string | undefined): string[] {
  const requested = (raw || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
  const unsupported = requested.filter(host => !APPROVED_API_HOSTS.includes(host));
  if (unsupported.length > 0) {
    throw new Error(`SLR_API_ALLOWED_HOSTS contains an unapproved host: ${unsupported[0]}`);
  }
  return requested.length > 0 ? requested : [...APPROVED_API_HOSTS];
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): McpConfig {
  const allowedHosts = parseAllowedHosts(environment.SLR_API_ALLOWED_HOSTS);
  return {
    apiBaseUrl: normalizeApiBaseUrl(requiredValue('SLR_API_BASE_URL', environment.SLR_API_BASE_URL), allowedHosts),
    agentToken: requiredValue('SLR_AGENT_TOKEN', environment.SLR_AGENT_TOKEN),
    timeoutMs: parseTimeout(environment.SLR_REQUEST_TIMEOUT_MS),
    profileId: environment.SLR_PROFILE_ID?.trim() || 'active-profile',
    projectId: environment.SLR_PROJECT_ID?.trim() || 'unknown-project',
    projectName: environment.SLR_PROJECT_NAME?.trim() || 'SLR project',
    allowedHosts,
    maxJsonResponseBytes: parseResponseLimit('SLR_MAX_JSON_RESPONSE_BYTES', environment.SLR_MAX_JSON_RESPONSE_BYTES, DEFAULT_JSON_RESPONSE_BYTES, 16 * 1024 * 1024),
    maxMarkdownResponseBytes: parseResponseLimit('SLR_MAX_MARKDOWN_RESPONSE_BYTES', environment.SLR_MAX_MARKDOWN_RESPONSE_BYTES, DEFAULT_MARKDOWN_RESPONSE_BYTES, 32 * 1024 * 1024),
  };
}
