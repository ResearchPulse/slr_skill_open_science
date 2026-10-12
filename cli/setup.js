import { createInterface } from 'node:readline';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
  createProfile,
  commitProfileConfiguration,
  findProfilesByToken,
  findProfilesByProjectId,
  getConfigRoot,
  getActiveProfile,
  getProfile,
  loadProfileToken,
  normalizeApiBaseUrl,
  normalizeProfileName,
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
    const redact = value => {
      const text = typeof value === 'string' ? value : null;
      if (!text) return null;
      return text.split(String(token)).join('[REDACTED]');
    };
    return {
      connected: true,
      status: response.status,
      projectId: redact(project.id),
      projectName: redact(project.name),
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

const CONFIG_OPERATION_TTL_MS = 10 * 60 * 1000;

function pendingConfigDirectory(environment) {
  return join(getConfigRoot(environment), 'pending-config');
}

function pruneExpiredPendingConfigs(environment) {
  const directory = pendingConfigDirectory(environment);
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory)) {
    if (!entry.endsWith('.json')) continue;
    const operationId = entry.slice(0, -'.json'.length);
    try {
      const metadata = JSON.parse(readFileSync(join(directory, entry), 'utf8'));
      if (!metadata?.expiresAt || Date.parse(metadata.expiresAt) <= Date.now()) {
        removePendingConfig(operationId, environment);
      }
    } catch {
      removePendingConfig(operationId, environment);
    }
  }
}

function operationIdFromInput(value) {
  const operationId = String(value || '').trim();
  if (!/^[a-f0-9-]{16,80}$/i.test(operationId)) throw new Error('invalid configuration operation id');
  return operationId;
}

function pendingPaths(operationIdInput, environment) {
  const operationId = operationIdFromInput(operationIdInput);
  const directory = pendingConfigDirectory(environment);
  return {
    directory,
    metadata: join(directory, `${operationId}.json`),
    secret: join(directory, `${operationId}.secret`),
  };
}

function writeProtectedFile(path, value) {
  mkdirSync(join(path, '..'), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, value, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  try { chmodSync(temporary, 0o600); } catch { /* Windows may not support POSIX modes. */ }
  try {
    renameSync(temporary, path);
    try { chmodSync(path, 0o600); } catch { /* Windows may not support POSIX modes. */ }
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function removePendingConfig(operationIdInput, environment) {
  const paths = pendingPaths(operationIdInput, environment);
  for (const path of [paths.metadata, paths.secret]) {
    if (existsSync(path)) unlinkSync(path);
  }
}

function readPendingConfig(operationIdInput, environment) {
  const paths = pendingPaths(operationIdInput, environment);
  if (!existsSync(paths.metadata) || !existsSync(paths.secret)) throw new Error('configuration operation not found or already completed');
  let metadata;
  try {
    metadata = JSON.parse(readFileSync(paths.metadata, 'utf8'));
  } catch {
    throw new Error('configuration operation metadata is invalid');
  }
  if (!metadata?.expiresAt || Date.parse(metadata.expiresAt) <= Date.now()) {
    removePendingConfig(operationIdInput, environment);
    throw new Error('configuration operation expired; start /slr config again');
  }
  const token = readFileSync(paths.secret, 'utf8').trim();
  if (!token) throw new Error('configuration operation has no token');
  return { metadata, token };
}

function publicMatch(type, profiles) {
  const matches = Array.isArray(profiles) ? profiles : profiles ? [profiles] : [];
  const safeProfiles = matches.map(profile => ({
    name: profile.name,
    projectId: profile.projectId || null,
    projectName: profile.projectName || null,
    active: profile.active === true,
  }));
  return {
    type: type || 'none',
    profile: safeProfiles[0] || null,
    profiles: safeProfiles,
    requiresProfileChoice: safeProfiles.length > 1,
  };
}

export async function beginTokenConfiguration({ name, apiBaseUrl, token, environment = globalThis.process['env'] } = {}) {
  pruneExpiredPendingConfigs(environment);
  const candidateName = normalizeProfileName(name || getActiveProfile(environment)?.name || 'default');
  const existing = (() => {
    try { return getProfile(candidateName, environment); } catch (error) {
      if (/profile not found/i.test(error instanceof Error ? error.message : '')) return null;
      throw error;
    }
  })();
  const candidateUrl = normalizeApiBaseUrl(apiBaseUrl || existing?.apiBaseUrl || DEFAULT_API_BASE_URL);
  const candidateToken = String(token || '').trim();
  if (!candidateToken) throw new Error('agent token must not be empty');

  const connection = await testProfileConnection({ apiBaseUrl: candidateUrl }, candidateToken);
  if (!connection.connected) return { ok: false, profile: existing, connection, match: publicMatch('none', []) };

  const exactMatches = findProfilesByToken(candidateToken, environment, candidateUrl);
  const projectMatches = connection.projectId
    ? findProfilesByProjectId(connection.projectId, environment, candidateUrl)
    : [];
  const match = exactMatches.length > 0
    ? publicMatch('exact', exactMatches)
    : projectMatches.length > 0
      ? publicMatch('project', projectMatches)
      : publicMatch('none', []);
  const operationId = randomUUID();
  const expiresAt = new Date(Date.now() + CONFIG_OPERATION_TTL_MS).toISOString();
  const paths = pendingPaths(operationId, environment);
  try {
    writeProtectedFile(paths.secret, `${candidateToken}\n`);
    writeProtectedFile(paths.metadata, `${JSON.stringify({
      operationId,
      profileName: candidateName,
      apiBaseUrl: candidateUrl,
      expiresAt,
      connection,
      match,
    }, null, 2)}\n`);
  } catch (error) {
    removePendingConfig(operationId, environment);
    throw error;
  }
  return {
    ok: true,
    operationId,
    expiresAt,
    profile: existing || { name: candidateName, apiBaseUrl: candidateUrl, projectId: null, projectName: null, active: false },
    connection,
    match,
    actions: match.type === 'exact' ? ['switch'] : match.type === 'project' ? ['update'] : ['save'],
  };
}

export function cancelTokenConfiguration(operationId, environment = globalThis.process['env']) {
  removePendingConfig(operationId, environment);
  return { ok: true, cancelled: operationIdFromInput(operationId) };
}

export function commitTokenConfiguration(operationId, action, environment = globalThis.process['env'], selectedProfileName = undefined) {
  const { metadata, token } = readPendingConfig(operationId, environment);
  const requestedAction = String(action || '').trim().toLowerCase();
  const expectedAction = metadata.match?.type === 'exact'
    ? 'switch'
    : metadata.match?.type === 'project'
      ? 'update'
      : 'save';
  if (requestedAction !== expectedAction) {
    throw new Error(`configuration action must be ${expectedAction} for this operation`);
  }

  const candidates = Array.isArray(metadata.match?.profiles) ? metadata.match.profiles : [];
  if (candidates.length > 1 && !selectedProfileName) {
    throw new Error('configuration matches multiple profiles; choose one with --profile');
  }
  const targetName = selectedProfileName || candidates[0]?.name || metadata.profileName;
  if (candidates.length > 0 && !candidates.some(profile => profile.name === targetName)) {
    throw new Error('selected profile is not one of the matched profiles');
  }
  const existingProfile = (() => {
    try { return getProfile(targetName, environment); } catch (error) {
      if (/profile not found/i.test(error instanceof Error ? error.message : '') && candidates.length === 0) return null;
      throw error;
    }
  })();
  const profile = commitProfileConfiguration(targetName, {
    apiBaseUrl: existingProfile?.apiBaseUrl || metadata.apiBaseUrl,
    projectId: metadata.connection.projectId,
    projectName: metadata.connection.projectName,
  }, token, environment);
  removePendingConfig(operationId, environment);
  return { ok: true, action: requestedAction, profile, connection: metadata.connection, match: metadata.match };
}
