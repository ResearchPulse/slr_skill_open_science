export interface McpConfig {
  apiBaseUrl: string;
  agentToken: string;
  timeoutMs: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

function requiredValue(name: string, value: string | undefined): string {
  const normalized = value?.trim() || '';
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function normalizeApiBaseUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('SLR_API_BASE_URL must be a valid http(s) URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('SLR_API_BASE_URL must use http or https');
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

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): McpConfig {
  return {
    apiBaseUrl: normalizeApiBaseUrl(requiredValue('SLR_API_BASE_URL', environment.SLR_API_BASE_URL)),
    agentToken: requiredValue('SLR_AGENT_TOKEN', environment.SLR_AGENT_TOKEN),
    timeoutMs: parseTimeout(environment.SLR_REQUEST_TIMEOUT_MS),
  };
}
