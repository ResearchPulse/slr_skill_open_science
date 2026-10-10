import {
  appendFileSync,
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

const MAX_REASONING = 16_000;
const MAX_DATA_BYTES = 12 * 1024;
const SAFE_TASK_ID = /^[A-Za-z0-9._-]{1,160}$/;

function ensureDirectory(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  try { chmodSync(path, 0o700); } catch { /* Windows ACLs are managed by the host. */ }
}

function workspaceBoundary(root) {
  let current = dirname(resolve(root));
  while (current !== dirname(current)) {
    if (basename(current) === 'profiles') return dirname(current);
    current = dirname(current);
  }
  return dirname(resolve(root));
}

function assertNoSymlinkComponents(target, boundary) {
  const resolvedTarget = resolve(target);
  const resolvedBoundary = resolve(boundary);
  let current = resolvedTarget;
  while (current === resolvedBoundary || current.startsWith(`${resolvedBoundary}${sep}`)) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error('workspace path contains a symlink or junction');
    }
    if (current === resolvedBoundary) return;
    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

function assertPhysicalInside(root, target) {
  const physicalRoot = realpathSync(root);
  const physicalTarget = realpathSync(target);
  const physicalRelative = relative(physicalRoot, physicalTarget);
  if (physicalRelative.startsWith('..') || physicalRelative.includes(`..${sep}`) || physicalTarget === physicalRoot) {
    throw new Error('workspace path escapes the profile-owned root');
  }
}

function assertInside(root, target) {
  assertNoSymlinkComponents(target, workspaceBoundary(root));
  const relativePath = relative(resolve(root), resolve(target));
  if (relativePath.startsWith('..') || relativePath.includes('../') || resolve(target) === resolve(root)) {
    throw new Error('workspace path escapes the profile-owned root');
  }
  return resolve(target);
}

function taskFileName(taskId) {
  const raw = String(taskId || '').trim();
  if (!SAFE_TASK_ID.test(raw)) {
    throw new Error('task id contains unsupported path characters');
  }
  return raw;
}

function workspacePaths(profile) {
  const root = resolve(profile.workspaceRoot);
  const paths = {
    root,
    fulltext: assertInside(root, join(root, 'fulltext')),
    drafts: assertInside(root, join(root, 'drafts')),
    submitted: assertInside(root, join(root, 'submitted')),
    audit: assertInside(root, join(root, 'audit.jsonl')),
  };
  return paths;
}

export function initializeWorkspace(profile) {
  const paths = workspacePaths(profile);
  const boundary = workspaceBoundary(paths.root);
  assertNoSymlinkComponents(paths.root, boundary);
  ensureDirectory(paths.root);
  ensureDirectory(paths.fulltext);
  ensureDirectory(paths.drafts);
  ensureDirectory(paths.submitted);
  if (!existsSync(paths.audit)) writeFileSync(paths.audit, '', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  assertNoSymlinkComponents(paths.audit, boundary);
  assertPhysicalInside(paths.root, paths.fulltext);
  assertPhysicalInside(paths.root, paths.drafts);
  assertPhysicalInside(paths.root, paths.submitted);
  assertPhysicalInside(paths.root, paths.audit);
  return paths;
}

function cleanText(value, max = 500) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function auditRecord(profile, event) {
  return {
    timestamp: new Date().toISOString(),
    profile: cleanText(profile.name, 64),
    projectId: cleanText(profile.projectId, 160) || null,
    event: cleanText(event.event, 64),
    taskId: cleanText(event.taskId, 160) || null,
    status: cleanText(event.status, 64) || null,
    digest: cleanText(event.digest, 64) || null,
    errorCode: cleanText(event.errorCode, 100) || null,
  };
}

export function appendAudit(profile, event) {
  const paths = initializeWorkspace(profile);
  const line = `${JSON.stringify(auditRecord(profile, event))}\n`;
  const fd = openSync(paths.audit, 'a', 0o600);
  try {
    appendFileSync(fd, line, { encoding: 'utf8' });
  } finally {
    closeSync(fd);
  }
}

function atomicWrite(path, content) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  try {
    try {
      renameSync(temporary, path);
    } catch (error) {
      if (error?.code !== 'EEXIST' && error?.code !== 'EPERM') throw error;
      unlinkSync(path);
      renameSync(temporary, path);
    }
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function fileDigest(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

export function saveDraft(profile, taskId, draft) {
  const paths = initializeWorkspace(profile);
  const safeTaskId = taskFileName(taskId);
  const reasoning = String(draft.reasoning || '').trim();
  if (!reasoning || reasoning.length > MAX_REASONING) throw new Error('draft reasoning must be 1-16000 characters');
  const data = draft.data === undefined ? undefined : draft.data;
  const serializedData = data === undefined ? '' : JSON.stringify(data);
  if (serializedData && Buffer.byteLength(serializedData, 'utf8') > MAX_DATA_BYTES) throw new Error('draft data is too large');
  const payload = {
    version: 1,
    status: 'DRAFT',
    profile: profile.name,
    projectId: profile.projectId || null,
    taskId: safeTaskId,
    decision: String(draft.decision || '').trim(),
    reasoning,
    ...(data === undefined ? {} : { data }),
    digest: fileDigest(JSON.stringify({ taskId: safeTaskId, decision: draft.decision, reasoning, data })),
    updatedAt: new Date().toISOString(),
  };
  const path = assertInside(paths.drafts, join(paths.drafts, `${safeTaskId}.json`));
  atomicWrite(path, `${JSON.stringify(payload, null, 2)}\n`);
  appendAudit(profile, { event: 'draft_created', taskId: safeTaskId, digest: payload.digest, status: payload.status });
  return { path, digest: payload.digest };
}

export function listDrafts(profile) {
  const paths = initializeWorkspace(profile);
  return readdirSync(paths.drafts, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
    .map(entry => entry.name.slice(0, -5))
    .sort();
}

export function readDraft(profile, taskId) {
  const paths = initializeWorkspace(profile);
  const safeTaskId = taskFileName(taskId);
  const path = assertInside(paths.drafts, join(paths.drafts, `${safeTaskId}.json`));
  if (!existsSync(path)) throw new Error(`draft not found: ${safeTaskId}`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function writeSubmittedReceipt(profile, taskId, receipt) {
  const paths = initializeWorkspace(profile);
  const safeTaskId = taskFileName(taskId);
  const payload = {
    version: 1,
    status: 'SUBMITTED',
    profile: profile.name,
    projectId: profile.projectId || null,
    taskId: safeTaskId,
    decision: cleanText(receipt.decision, 100),
    digest: cleanText(receipt.digest, 64),
    submittedAt: new Date().toISOString(),
    backendStatus: cleanText(receipt.backendStatus, 64) || 'COMPLETED',
  };
  const path = assertInside(paths.submitted, join(paths.submitted, `${safeTaskId}.json`));
  atomicWrite(path, `${JSON.stringify(payload, null, 2)}\n`);
  appendAudit(profile, { event: 'submitted', taskId: safeTaskId, digest: payload.digest, status: payload.status });
  return { path, payload };
}

export function listAudit(profile, limit = 50) {
  const paths = initializeWorkspace(profile);
  if (!existsSync(paths.audit)) return [];
  return readFileSync(paths.audit, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-Math.max(1, Math.min(200, Number(limit) || 50)))
    .map(line => JSON.parse(line));
}
