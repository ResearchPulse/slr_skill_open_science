import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { installSkill } from '../cli/skill-store.js';
import {
  createProfile,
  getActiveProfile,
  getConfigRoot,
  listProfiles,
  loadProfileToken,
  removeProfile,
  saveProfileToken,
} from '../cli/profile-store.js';
import {
  initializeWorkspace,
  listAudit,
  listDrafts,
  saveDraft,
  writeSubmittedReceipt,
} from '../cli/workspace.js';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));

function withStore(run) {
  const root = mkdtempSync(join(tmpdir(), 'slr-profile-test-'));
  const environment = { SLR_CONFIG_DIR: root };
  try {
    return run(environment, root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('profiles keep metadata and workspaces isolated without storing tokens', () => withStore((environment, root) => {
  const first = createProfile({
    name: 'project-one',
    apiBaseUrl: 'https://slr-api.hyperdatalab.org/api',
    projectId: 'p1',
    projectName: 'One',
    credentialId: 'cred-1',
    token: 'must-not-be-stored',
  }, environment);
  const second = createProfile({
    name: 'project-two',
    apiBaseUrl: 'https://slr-api.hyperdatalab.org/api',
    projectId: 'p2',
    projectName: 'Two',
    credentialId: 'cred-2',
  }, environment);

  assert.notEqual(first.workspaceRoot, second.workspaceRoot);
  assert.equal(getActiveProfile(environment).name, 'project-one');
  assert.equal(listProfiles(environment).length, 2);
  const store = readFileSync(join(getConfigRoot(environment), 'profiles.json'), 'utf8');
  assert.equal(store.includes('must-not-be-stored'), false);
  assert.equal(root.includes('project-one'), false);
}));

test('profile tokens are never stored locally', () => withStore((environment) => {
  const profile = createProfile({ name: 'local-token', apiBaseUrl: 'https://slr-api.hyperdatalab.org/api' }, environment);
  assert.throws(() => saveProfileToken(profile.name, 'slrp_local_secret', environment), /local token storage is disabled/);

  const metadata = readFileSync(join(getConfigRoot(environment), 'profiles.json'), 'utf8');
  assert.equal(metadata.includes('slrp_local_secret'), false);
  assert.equal(loadProfileToken(profile.name, environment), null);
  assert.equal(listProfiles(environment)[0].hasLocalToken, false);

  removeProfile(profile.name, environment);
  assert.throws(() => loadProfileToken(profile.name, environment), /profile not found/);
}));

test('reading profiles removes legacy plaintext token files', () => withStore((environment, root) => {
  createProfile({ name: 'legacy-cleanup', apiBaseUrl: 'https://slr-api.hyperdatalab.org/api' }, environment);
  const legacyDirectory = join(root, 'tokens');
  mkdirSync(legacyDirectory, { recursive: true });
  const legacyPath = join(legacyDirectory, 'legacy-cleanup');
  writeFileSync(legacyPath, 'slrp_legacy_secret\n', 'utf8');
  assert.equal(existsSync(legacyPath), true);
  assert.equal(listProfiles(environment)[0].hasLocalToken, false);
  assert.equal(existsSync(legacyPath), false);
}));

test('workspace writes drafts, receipts, and bounded audit records', () => withStore((environment) => {
  const profile = createProfile({ name: 'safe', apiBaseUrl: 'https://slr-api.hyperdatalab.org/api', projectId: 'p1' }, environment);
  const paths = initializeWorkspace(profile);
  const draft = saveDraft(profile, 'task-1', {
    decision: 'INCLUDE',
    reasoning: 'The paper matches the stated criteria.',
    data: { confidence: 0.9 },
  });
  writeSubmittedReceipt(profile, 'task-1', { decision: 'INCLUDE', digest: draft.digest, backendStatus: 'COMPLETED' });

  assert.deepEqual(listDrafts(profile), ['task-1']);
  assert.equal(listAudit(profile).map(event => event.event).join(','), 'draft_created,submitted');
  const auditText = readFileSync(paths.audit, 'utf8');
  assert.equal(auditText.includes('Bearer'), false);
}));

test('workspace rejects traversal-like task ids and unsafe URLs', () => withStore((environment) => {
  assert.throws(() => createProfile({ name: '../unsafe', apiBaseUrl: 'https://slr.example.test/api' }, environment));
  assert.throws(() => createProfile({ name: 'unsafe', apiBaseUrl: 'https://user:pass@slr.example.test/api' }, environment));
  assert.throws(() => createProfile({ name: 'unsafe', apiBaseUrl: 'http://remote.example.test/api' }, environment));
  assert.throws(() => createProfile({ name: 'unsafe', apiBaseUrl: 'https://remote.example.test/api' }, environment), /host is not allowed/);
}));

test('recreating a profile name receives a fresh workspace', () => withStore((environment) => {
  const first = createProfile({ name: 'reusable', apiBaseUrl: 'https://slr-api.hyperdatalab.org/api' }, environment);
  initializeWorkspace(first);
  saveDraft(first, 'old-task', { decision: 'EXCLUDE', reasoning: 'Old project draft.' });
  removeProfile('reusable', environment);
  const second = createProfile({ name: 'reusable', apiBaseUrl: 'https://slr-api.hyperdatalab.org/api' }, environment);
  assert.notEqual(first.workspaceRoot, second.workspaceRoot);
  assert.deepEqual(listDrafts(second), []);
}));

test('workspace rejects a symlinked profile path when the platform permits symlink creation', () => withStore((environment, root) => {
  const profile = createProfile({ name: 'linked', apiBaseUrl: 'https://slr-api.hyperdatalab.org/api' }, environment);
  const outside = join(root, 'outside');
  const link = join(root, 'profiles', 'linked');
  mkdirSync(outside, { recursive: true });
  mkdirSync(join(root, 'profiles'), { recursive: true });
  try {
    symlinkSync(outside, link, 'junction');
  } catch (error) {
    if (['EPERM', 'EACCES', 'UNKNOWN'].includes(error?.code)) return;
    throw error;
  }
  const redirected = { ...profile, workspaceRoot: join(link, 'paper-review') };
  assert.throws(() => initializeWorkspace(redirected), /symlink|junction|escapes/i);
  assert.equal(existsSync(join(outside, 'paper-review')), false);
}));

test('skill installation is managed and refuses to overwrite an unmanaged target', () => withStore((_environment, root) => {
  const target = join(root, 'skills', 'slr');
  assert.equal(installSkill(packageRoot, target).status, 'installed');
  assert.equal(existsSync(join(target, 'SKILL.md')), true);
  assert.equal(installSkill(packageRoot, target).status, 'updated');

  const unmanaged = join(root, 'skills', 'unmanaged');
  mkdirSync(unmanaged, { recursive: true });
  writeFileSync(join(unmanaged, 'SKILL.md'), 'custom\n');
  assert.throws(() => installSkill(packageRoot, unmanaged), /not managed/);
}));
