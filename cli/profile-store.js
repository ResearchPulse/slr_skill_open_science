import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

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
  const loopback = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
  if (parsed.protocol === 'http:' && !loopback.has(parsed.hostname.toLowerCase())) {
    throw new Error('api base URL must use HTTPS unless it targets local loopback development');
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
}

function assertNoSecrets(value) {
  if (!value || typeof value !== 'object') return;
  const allowedMetadata = new Set(['tokenSource', 'hasCredentialBinding']);
  for (const [key, child] of Object.entries(value)) {
    if (!allowedMetadata.has(key) && /token|secret|password|authorization|api.?key/i.test(key)) {
      throw new Error('profile store contains a forbidden secret field; remove it and rotate the token if necessary');
    }
    assertNoSecrets(child);
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
  return parsed;
}

function writeStore(configRoot, store) {
  ensureConfigRoot(configRoot);
  const target = storePath(configRoot);
  const temporary = `${target}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(store, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  try {
    renameSync(temporary, target);
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
    hasCredentialBinding: Boolean(profile.credentialId),
    workspaceRoot: profile.workspaceRoot,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
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
    tokenSource: 'open-science-credential',
    workspaceId,
    workspaceRoot: profileWorkspace(configRoot, name, workspaceId),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  store.profiles[name] = profile;
  if (!store.activeProfile) store.activeProfile = name;
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
  profile.updatedAt = now();
  writeStore(configRoot, store);
  return publicProfile(profile);
}

export function listProfiles(environment = process.env) {
  const store = readStore(getConfigRoot(environment));
  return Object.values(store.profiles).map(profile => ({
    ...publicProfile(profile),
    active: store.activeProfile === profile.name,
  }));
}

export function getProfile(nameInput, environment = process.env) {
  const configRoot = getConfigRoot(environment);
  const store = readStore(configRoot);
  const name = normalizeProfileName(nameInput);
  const profile = store.profiles[name];
  if (!profile) throw new Error(`profile not found: ${name}`);
  return publicProfile(profile);
}

export function getActiveProfile(environment = process.env) {
  const configRoot = getConfigRoot(environment);
  const store = readStore(configRoot);
  if (!store.activeProfile) return null;
  const profile = store.profiles[store.activeProfile];
  if (!profile) throw new Error('active profile is missing from the profile store');
  return publicProfile(profile);
}

export function useProfile(nameInput, environment = process.env) {
  const configRoot = getConfigRoot(environment);
  const name = normalizeProfileName(nameInput);
  const store = readStore(configRoot);
  if (!store.profiles[name]) throw new Error(`profile not found: ${name}`);
  store.activeProfile = name;
  writeStore(configRoot, store);
  return publicProfile(store.profiles[name]);
}

export function removeProfile(nameInput, environment = process.env) {
  const configRoot = getConfigRoot(environment);
  const name = normalizeProfileName(nameInput);
  const store = readStore(configRoot);
  if (!store.profiles[name]) throw new Error(`profile not found: ${name}`);
  delete store.profiles[name];
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

export function profileDirectory(profile) {
  return resolve(dirname(profile.workspaceRoot));
}
