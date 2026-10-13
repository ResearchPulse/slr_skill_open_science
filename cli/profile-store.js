import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';

const STORE_VERSION = 1;
const PROFILE_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function now() {
  return new Date().toISOString();
}

export function normalizeProfileName(value) {
  const name = String(value || '').trim().toLowerCase();
  if (!PROFILE_NAME.test(name)) {
    throw new Error('profile name must use 1-64 lowercase letters, numbers, hyphens, or underscores');
  }
  return name;
}

export function normalizeApiBaseUrl(raw) {
  let parsed;
  try {
    parsed = new URL(String(raw || '').trim());
  } catch {
    throw new Error('api base URL must be a valid http(s) URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('api base URL must use http or https');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('api base URL must not contain credentials, query parameters, or fragments');
  }
  const hostname = parsed.hostname.toLowerCase();
  const loopback = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
  const productionHosts = new Set(['slr-agent.hyperdatalab.org', 'slr-api.hyperdatalab.org']);
  if (parsed.protocol === 'http:' && !loopback.has(hostname)) {
    throw new Error('api base URL must use HTTPS unless it targets local loopback development');
  }
  if (!loopback.has(hostname) && !productionHosts.has(hostname)) {
    throw new Error(`api base URL host is not allowed: ${parsed.hostname}`);
  }
  return parsed.toString().replace(/\/+$/, '');
}

export function getConfigRoot(environment = process.env) {
  return resolve(environment.SLR_CONFIG_DIR?.trim() || join(homedir(), '.slr'));
}

function storePath(configRoot) {
  return join(configRoot, 'profiles.json');
}

function ensureConfigRoot(configRoot) {
  mkdirSync(configRoot, { recursive: true, mode: 0o700 });
  try { chmodSync(configRoot, 0o700); } catch { /* Windows may not support POSIX modes. */ }
}

function removeLegacyTokenFiles(configRoot, store) {
  for (const name of Object.keys(store.profiles || {})) {
    const legacyPath = join(configRoot, 'tokens', name);
    if (existsSync(legacyPath)) unlinkSync(legacyPath);
  }
}

function assertNoSecrets(value, parentKey = '') {
  if (!value || typeof value !== 'object') return;
  const allowedMetadata = new Set(['tokenSource', 'hasCredentialBinding', 'hasLocalToken', 'credentialFingerprint']);
  for (const [key, child] of Object.entries(value)) {
    if (key === 'credentialFingerprint' && child !== null && child !== undefined
      && !/^[0-9a-f]{64}$/i.test(String(child))) {
      throw new Error('profile store contains an invalid credential fingerprint');
    }
    const isProfileName = parentKey === 'profiles';
    if (!isProfileName && !allowedMetadata.has(key) && /token|secret|password|authorization|api.?key/i.test(key)) {
      throw new Error('profile store contains a forbidden secret field; remove it and rotate the token if necessary');
    }
    assertNoSecrets(child, isProfileName ? 'profile-record' : key);
  }
}

function emptyStore() {
  return { version: STORE_VERSION, activeProfile: null, profiles: {} };
}

export function readStore(configRoot = getConfigRoot()) {
  const path = storePath(configRoot);
  if (!existsSync(path)) return emptyStore();
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error('profile store is invalid JSON; repair or remove it before continuing');
  }
  assertNoSecrets(parsed);
  if (!parsed || parsed.version !== STORE_VERSION || !parsed.profiles || typeof parsed.profiles !== 'object') {
    throw new Error(`unsupported profile store version; expected ${STORE_VERSION}`);
  }
  removeLegacyTokenFiles(configRoot, parsed);
  return parsed;
}

function writeStore(configRoot, store) {
  ensureConfigRoot(configRoot);
  const target = storePath(configRoot);
  const temporary = `${target}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(store, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  try { chmodSync(temporary, 0o600); } catch { /* Windows may not support POSIX modes. */ }
  try {
    let lastError;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        renameSync(temporary, target);
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        if (attempt < 7) {
          const wait = new Int32Array(new SharedArrayBuffer(4));
          Atomics.wait(wait, 0, 0, 250);
        }
      }
    }
    if (lastError) throw lastError;
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function profileWorkspace(configRoot, name, workspaceId) {
  return join(configRoot, 'profiles', name, workspaceId, 'paper-review');
}

function publicProfile(profile) {
  return {
    name: profile.name,
    apiBaseUrl: profile.apiBaseUrl,
    projectId: profile.projectId || null,
    projectName: profile.projectName || null,
    credentialId: profile.credentialId || null,
    connectorId: profile.connectorId || null,
    connectorName: profile.connectorName || null,
    tokenSource: profile.tokenSource,
    hasLocalToken: false,
    hasCredentialBinding: Boolean(profile.credentialId),
    workspaceRoot: profile.workspaceRoot,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

function normalizeCredentialFingerprint(value) {
  const fingerprint = String(value || '').trim();
  if (!fingerprint) return null;
  if (!/^[0-9a-f]{64}$/i.test(fingerprint)) {
    throw new Error('credential fingerprint must be a SHA-256 hex digest');
  }
  return fingerprint.toLowerCase();
}

export function createProfile(input, environment = process.env) {
  const configRoot = getConfigRoot(environment);
  const name = normalizeProfileName(input.name);
  const store = readStore(configRoot);
  if (store.profiles[name]) throw new Error(`profile already exists: ${name}`);
  const timestamp = now();
  const workspaceId = randomUUID();
  const profile = {
    name,
    apiBaseUrl: normalizeApiBaseUrl(input.apiBaseUrl),
    projectId: String(input.projectId || '').trim() || null,
    projectName: String(input.projectName || '').trim() || null,
    credentialId: String(input.credentialId || '').trim() || null,
    connectorId: String(input.connectorId || '').trim() || null,
    connectorName: String(input.connectorName || `slr-${name}`).trim(),
    tokenSource: input.credentialId ? 'open-science-credential' : 'unconfigured',
    hasLocalToken: false,
    credentialFingerprint: normalizeCredentialFingerprint(input.credentialFingerprint),
    workspaceId,
    workspaceRoot: profileWorkspace(configRoot, name, workspaceId),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  store.profiles[name] = profile;
  if (input.activate !== false && !store.activeProfile) store.activeProfile = name;
  writeStore(configRoot, store);
  return publicProfile(profile);
}

export function updateProfile(nameInput, changes, environment = process.env) {
  const configRoot = getConfigRoot(environment);
  const name = normalizeProfileName(nameInput);
  const store = readStore(configRoot);
  const profile = store.profiles[name];
  if (!profile) throw new Error(`profile not found: ${name}`);
  if (changes.apiBaseUrl !== undefined) profile.apiBaseUrl = normalizeApiBaseUrl(changes.apiBaseUrl);
  for (const key of ['projectId', 'projectName', 'credentialId', 'connectorId', 'connectorName']) {
    if (changes[key] !== undefined) profile[key] = String(changes[key] || '').trim() || null;
  }
  if (changes.credentialId !== undefined) {
    profile.tokenSource = profile.credentialId ? 'open-science-credential' : 'unconfigured';
  }
  if (changes.credentialFingerprint !== undefined) {
    profile.credentialFingerprint = normalizeCredentialFingerprint(changes.credentialFingerprint);
  }
  profile.updatedAt = now();
  writeStore(configRoot, store);
  return publicProfile(profile);
}

export function saveProfileToken(nameInput, tokenInput, environment = process.env) {
  const name = normalizeProfileName(nameInput);
  void tokenInput;
  void environment;
  throw new Error(`local token storage is disabled for profile ${name}; bind SLR_AGENT_TOKEN through the host credential`);
}

export function commitProfileConfiguration(nameInput, changes, environment = process.env) {
  const configRoot = getConfigRoot(environment);
  const name = normalizeProfileName(nameInput);
  const store = readStore(configRoot);
  const originalStore = JSON.parse(JSON.stringify(store));
  const timestamp = now();
  const workspaceId = randomUUID();
  const profile = store.profiles[name] || {
    name,
    apiBaseUrl: normalizeApiBaseUrl(changes.apiBaseUrl),
    projectId: null,
    projectName: null,
    credentialId: String(changes.credentialId || '').trim() || null,
    connectorId: null,
    connectorName: `slr-${name}`,
    tokenSource: changes.credentialId ? 'open-science-credential' : 'unconfigured',
    hasLocalToken: false,
    credentialFingerprint: normalizeCredentialFingerprint(changes.credentialFingerprint),
    workspaceId,
    workspaceRoot: profileWorkspace(configRoot, name, workspaceId),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  try {
    if (changes.apiBaseUrl !== undefined) profile.apiBaseUrl = normalizeApiBaseUrl(changes.apiBaseUrl);
    if (changes.projectId !== undefined) profile.projectId = String(changes.projectId || '').trim() || null;
    if (changes.projectName !== undefined) profile.projectName = String(changes.projectName || '').trim() || null;
    if (changes.credentialId !== undefined) {
      profile.credentialId = String(changes.credentialId || '').trim() || null;
      profile.tokenSource = profile.credentialId ? 'open-science-credential' : 'unconfigured';
    }
    if (changes.credentialFingerprint !== undefined) {
      profile.credentialFingerprint = normalizeCredentialFingerprint(changes.credentialFingerprint);
    }
    profile.hasLocalToken = false;
    profile.updatedAt = timestamp;
    store.profiles[name] = profile;
    writeStore(configRoot, store);
    return publicProfile(profile);
  } catch (error) {
    try {
      writeStore(configRoot, originalStore);
    } catch { /* Preserve the original failure; the next invocation can repair the store. */ }
    throw error;
  }
}

export function loadProfileToken(nameInput, environment = process.env) {
  const name = normalizeProfileName(nameInput);
  getProfile(name, environment);
  return null;
}

export function tokenFingerprint(value) {
  return createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function tokenMatchesFingerprint(token, fingerprint) {
  const left = Buffer.from(tokenFingerprint(token), 'hex');
  const right = Buffer.from(String(fingerprint || ''), 'hex');
  return right.length === left.length && timingSafeEqual(left, right);
}

export function findProfileByToken(tokenInput, environment = process.env) {
  return findProfilesByToken(tokenInput, environment)[0] || null;
}

export function findProfilesByToken(tokenInput, environment = process.env, apiBaseUrlInput = undefined) {
  const token = String(tokenInput || '').trim();
  if (!token) return [];
  const configRoot = getConfigRoot(environment);
  const store = readStore(configRoot);
  const apiBaseUrl = apiBaseUrlInput ? normalizeApiBaseUrl(apiBaseUrlInput) : null;
  return Object.values(store.profiles).filter(profile => {
    if (apiBaseUrl && profile.apiBaseUrl !== apiBaseUrl) return false;
    return Boolean(profile.credentialFingerprint && tokenMatchesFingerprint(token, profile.credentialFingerprint));
  }).map(profile => ({ ...publicProfile(profile), active: store.activeProfile === profile.name }));
}

export function findProfilesByProjectId(projectIdInput, environment = process.env, apiBaseUrlInput = undefined) {
  const projectId = String(projectIdInput || '').trim();
  if (!projectId) return [];
  const apiBaseUrl = apiBaseUrlInput ? normalizeApiBaseUrl(apiBaseUrlInput) : null;
  return listProfiles(environment).filter(profile => profile.projectId === projectId
    && (!apiBaseUrl || profile.apiBaseUrl === apiBaseUrl));
}

export function listProfiles(environment = process.env) {
  const store = readStore(getConfigRoot(environment));
  return Object.values(store.profiles).map(profile => ({
    ...publicProfile(profile),
    hasLocalToken: false,
    active: store.activeProfile === profile.name,
  }));
}

export function getProfile(nameInput, environment = process.env) {
  const configRoot = getConfigRoot(environment);
  const store = readStore(configRoot);
  const name = normalizeProfileName(nameInput);
  const profile = store.profiles[name];
  if (!profile) throw new Error(`profile not found: ${name}`);
  return { ...publicProfile(profile), hasLocalToken: false };
}

export function getActiveProfile(environment = process.env) {
  const configRoot = getConfigRoot(environment);
  const store = readStore(configRoot);
  if (!store.activeProfile) return null;
  const profile = store.profiles[store.activeProfile];
  if (!profile) throw new Error('active profile is missing from the profile store');
  return { ...publicProfile(profile), hasLocalToken: false };
}

export function useProfile(nameInput, environment = process.env) {
  const configRoot = getConfigRoot(environment);
  const name = normalizeProfileName(nameInput);
  const store = readStore(configRoot);
  if (!store.profiles[name]) throw new Error(`profile not found: ${name}`);
  store.activeProfile = name;
  writeStore(configRoot, store);
  return getProfile(name, environment);
}

export function removeProfile(nameInput, environment = process.env) {
  const configRoot = getConfigRoot(environment);
  const name = normalizeProfileName(nameInput);
  const store = readStore(configRoot);
  if (!store.profiles[name]) throw new Error(`profile not found: ${name}`);
  delete store.profiles[name];
  const legacyTokenPath = join(configRoot, 'tokens', name);
  if (existsSync(legacyTokenPath)) unlinkSync(legacyTokenPath);
  if (store.activeProfile === name) store.activeProfile = Object.keys(store.profiles)[0] || null;
  writeStore(configRoot, store);
  return { removed: name, activeProfile: store.activeProfile };
}

export function configRootFor(environment = process.env) {
  return getConfigRoot(environment);
}

export function profileFromInput(nameInput, environment = process.env) {
  return getProfile(nameInput || getActiveProfile(environment)?.name, environment);
}

export function profileStorePath(environment = process.env) {
  return storePath(getConfigRoot(environment));
}

export function captureProfileStore(environment = process.env) {
  return JSON.parse(JSON.stringify(readStore(getConfigRoot(environment))));
}

export function restoreProfileStore(snapshot, environment = process.env) {
  if (!snapshot || snapshot.version !== STORE_VERSION || !snapshot.profiles || typeof snapshot.profiles !== 'object') {
    throw new Error('invalid profile store snapshot');
  }
  assertNoSecrets(snapshot);
  writeStore(getConfigRoot(environment), JSON.parse(JSON.stringify(snapshot)));
  return getActiveProfile(environment);
}

export function profileDirectory(profile) {
  return resolve(dirname(profile.workspaceRoot));
}
