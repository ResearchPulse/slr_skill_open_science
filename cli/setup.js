import { createInterface } from 'node:readline';
import {
  createProfile,
  getActiveProfile,
  getProfile,
  loadProfileToken,
  saveProfileToken,
  updateProfile,
} from './profile-store.js';

const REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_API_BASE_URL = 'https://slr-api.hyperdatalab.org/api';

function hasInteractiveTerminal() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function promptText(label, current = '') {
  if (!hasInteractiveTerminal()) return Promise.resolve(undefined);
  const suffix = current ? ` [${current}]` : '';
  const input = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve, reject) => {
    input.question(`${label}${suffix}: `, answer => {
      input.close();
      resolve(answer.trim() || current || undefined);
    });
    input.on('SIGINT', () => {
      input.close();
      reject(new Error('setup cancelled'));
    });
  });
}

function promptHidden(label, hasCurrent) {
  if (!hasInteractiveTerminal()) return Promise.resolve(undefined);
  const input = process.stdin;
  const output = process.stdout;
  return new Promise((resolve, reject) => {
    let value = '';
    const previousRawMode = input.isRaw;
    const onData = chunk => {
      const text = String(chunk);
      for (const character of text) {
        if (character === '\u0003') {
          cleanup();
          reject(new Error('setup cancelled'));
          return;
        }
        if (character === '\r' || character === '\n') {
          cleanup();
          output.write('\n');
          resolve(value.trim() || undefined);
          return;
        }
        if (character === '\u007f' || character === '\b') {
          if (value) {
            value = value.slice(0, -1);
            output.write('\b \b');
          }
          continue;
        }
        if (character >= ' ') {
          value += character;
          output.write('*');
        }
      }
    };
    const cleanup = () => {
      input.off('data', onData);
      try { input.setRawMode(Boolean(previousRawMode)); } catch { /* non-TTY fallback */ }
      input.pause();
    };
    output.write(`${label}${hasCurrent ? ' (Enter to keep current)' : ''}: `);
    input.resume();
    try { input.setRawMode(true); } catch { cleanup(); reject(new Error('hidden token input requires a TTY')); return; }
    input.on('data', onData);
  });
}

function existingProfile(name, environment) {
  if (!name) return getActiveProfile(environment);
  try { return getProfile(name, environment); } catch (error) {
    if (/profile not found/i.test(error instanceof Error ? error.message : '')) return null;
    throw error;
  }
}

export async function prepareProfile({ name, apiBaseUrl, interactive = hasInteractiveTerminal(), environment = globalThis.process['env'] } = {}) {
  const profileName = name || getActiveProfile(environment)?.name || 'default';
  let profile = existingProfile(profileName, environment);
  const url = apiBaseUrl || profile?.apiBaseUrl || DEFAULT_API_BASE_URL;
  if (!url) return { profile: null, token: null, skipped: true, reason: 'API URL was not provided' };

  profile = profile
    ? updateProfile(profile.name, { apiBaseUrl: url }, environment)
    : createProfile({ name: profileName, apiBaseUrl: url }, environment);

  const currentToken = loadProfileToken(profile.name, environment);
  let token = currentToken;
  if (interactive) {
    const entered = await promptHidden('Agent token', Boolean(currentToken));
    token = entered || currentToken;
  }
  if (token && token !== currentToken) {
    profile = saveProfileToken(profile.name, token, environment);
  } else {
    profile = getProfile(profile.name, environment);
  }
  return { profile, token, skipped: false };
}

export async function testProfileConnection(profile, token) {
  if (!token) return { connected: false, code: 'TOKEN_MISSING', message: 'No local token is configured for this profile.' };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${profile.apiBaseUrl}/agent/v1/tasks?limit=1`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      return {
        connected: false,
        status: response.status,
        code: `HTTP_${response.status}`,
        message: `SLR API request failed with HTTP ${response.status}.`,
      };
    }
    let body;
    try {
      body = await response.json();
    } catch {
      return { connected: false, status: 502, code: 'INVALID_JSON', message: 'SLR API returned invalid JSON.' };
    }
    if (!body || body.success !== true || !body.data) {
      return { connected: false, status: 502, code: 'INVALID_RESPONSE', message: 'SLR API returned an invalid success envelope.' };
    }
    const project = body.data.project || {};
    const items = Array.isArray(body.data.items) ? body.data.items : [];
    return {
      connected: true,
      status: response.status,
      projectId: typeof project.id === 'string' ? project.id : null,
      projectName: typeof project.name === 'string' ? project.name : null,
      assignedTasks: items.length,
      hasMore: body.data.hasMore === true,
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { connected: false, status: 504, code: 'REQUEST_TIMEOUT', message: 'SLR API request timed out.' };
    }
    return { connected: false, status: 502, code: 'API_UNREACHABLE', message: 'Unable to connect to the SLR API.' };
  } finally {
    clearTimeout(timeout);
  }
}
