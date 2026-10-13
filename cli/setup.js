import { randomUUID } from 'node:crypto';
import {
  createProfile,
  commitProfileConfiguration,
  findProfilesByToken,
  findProfilesByProjectId,
  getActiveProfile,
  getProfile,
  normalizeApiBaseUrl,
  normalizeProfileName,
  tokenFingerprint,
  updateProfile,
} from './profile-store.js';

const REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_API_BASE_URL = 'https://slr-api.hyperdatalab.org/api';
const pendingConfigurations = new Map();

function existingProfile(name, environment) {
  if (!name) return getActiveProfile(environment);
  try { return getProfile(name, environment); } catch (error) {
    if (/profile not found/i.test(error instanceof Error ? error.message : '')) return null;
    throw error;
  }
}

export async function prepareProfile({ name, apiBaseUrl, environment = globalThis.process['env'] } = {}) {
  const profileName = name || getActiveProfile(environment)?.name || 'default';
  let profile = existingProfile(profileName, environment);
  const url = apiBaseUrl || profile?.apiBaseUrl || DEFAULT_API_BASE_URL;
  if (!url) return { profile: null, token: null, skipped: true, reason: 'API URL was not provided' };

  profile = profile
    ? updateProfile(profile.name, { apiBaseUrl: url }, environment)
    : createProfile({ name: profileName, apiBaseUrl: url, activate: false }, environment);

  return { profile, token: null, skipped: false };
}

export async function testProfileConnection(profile, token) {
  if (!token) return { connected: false, code: 'TOKEN_MISSING', message: 'No host credential token was supplied for this profile.' };
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
const pendingExpiryTimers = new Map();

function discardPendingConfig(operationId) {
  pendingConfigurations.delete(operationId);
  const timer = pendingExpiryTimers.get(operationId);
  if (timer) clearTimeout(timer);
  pendingExpiryTimers.delete(operationId);
}

function pruneExpiredPendingConfigs(environment) {
  void environment;
  for (const [operationId, pending] of pendingConfigurations.entries()) {
    if (!pending?.metadata?.expiresAt || Date.parse(pending.metadata.expiresAt) <= Date.now()) {
      discardPendingConfig(operationId);
    }
  }
}

function operationIdFromInput(value) {
  const operationId = String(value || '').trim();
  if (!/^[a-f0-9-]{16,80}$/i.test(operationId)) throw new Error('invalid configuration operation id');
  return operationId;
}

function removePendingConfig(operationIdInput, environment) {
  void environment;
  discardPendingConfig(operationIdFromInput(operationIdInput));
}

function readPendingConfig(operationIdInput, environment) {
  void environment;
  const operationId = operationIdFromInput(operationIdInput);
  const pending = pendingConfigurations.get(operationId);
  if (!pending) throw new Error('configuration operation not found or already completed');
  const { metadata, token } = pending;
  if (!metadata?.expiresAt || Date.parse(metadata.expiresAt) <= Date.now()) {
    discardPendingConfig(operationId);
    throw new Error('configuration operation expired; start /slr config again');
  }
  if (!token) throw new Error('configuration operation has no token');
  return { operationId, metadata, token };
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
  pendingConfigurations.set(operationId, {
    token: candidateToken,
    metadata: {
      operationId,
      profileName: candidateName,
      apiBaseUrl: candidateUrl,
      expiresAt,
      connection,
      match,
      tokenFingerprint: tokenFingerprint(candidateToken),
    },
  });
  const expiryTimer = setTimeout(() => discardPendingConfig(operationId), Math.max(1, Date.parse(expiresAt) - Date.now() + 1));
  expiryTimer.unref?.();
  pendingExpiryTimers.set(operationId, expiryTimer);
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

export function assertTokenConfigurationCredential(
  operationId,
  currentTokenFingerprint,
  environment = globalThis.process['env'],
) {
  const pending = readPendingConfig(operationId, environment);
  if (!currentTokenFingerprint || currentTokenFingerprint !== pending.metadata.tokenFingerprint) {
    throw new Error('the bound SLR credential changed after validation; validate again before committing');
  }
  return { ok: true, operationId: operationIdFromInput(operationId) };
}

export function tokenConfigurationTargetProfileName(
  operationIdInput,
  selectedProfileName = undefined,
  environment = globalThis.process['env'],
) {
  const { metadata } = readPendingConfig(operationIdInput, environment);
  const candidates = Array.isArray(metadata.match?.profiles) ? metadata.match.profiles : [];
  if (candidates.length > 1 && !selectedProfileName) {
    throw new Error('configuration matches multiple profiles; choose one with --profile');
  }
  const targetName = selectedProfileName || candidates[0]?.name || metadata.profileName;
  if (candidates.length > 0 && !candidates.some(profile => profile.name === targetName)) {
    throw new Error('selected profile is not one of the matched profiles');
  }
  return targetName;
}

export function commitTokenConfiguration(
  operationId,
  action,
  environment = globalThis.process['env'],
  selectedProfileName = undefined,
  credentialId = undefined,
  currentTokenFingerprint = undefined,
) {
  const pending = readPendingConfig(operationId, environment);
  const { metadata, token } = pending;
  if (!currentTokenFingerprint || currentTokenFingerprint !== metadata.tokenFingerprint) {
    throw new Error('the bound SLR credential changed after validation; validate again before committing');
  }
  const requestedAction = String(action || '').trim().toLowerCase();
  const expectedAction = metadata.match?.type === 'exact'
    ? 'switch'
    : metadata.match?.type === 'project'
      ? 'update'
      : 'save';
  if (requestedAction !== expectedAction) {
    throw new Error(`configuration action must be ${expectedAction} for this operation`);
  }

  const targetName = tokenConfigurationTargetProfileName(operationId, selectedProfileName, environment);
  const candidates = Array.isArray(metadata.match?.profiles) ? metadata.match.profiles : [];
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
    credentialId,
    credentialFingerprint: tokenFingerprint(token),
  }, environment);
  return { ok: true, action: requestedAction, operationId, profile, connection: metadata.connection, match: metadata.match };
}

export function finalizeTokenConfiguration(operationId, environment = globalThis.process['env']) {
  removePendingConfig(operationId, environment);
  return { ok: true, finalized: operationIdFromInput(operationId) };
}
