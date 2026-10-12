import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const skill = readFileSync(join(root, 'skill', 'slr', 'SKILL.md'), 'utf8');
const commands = readFileSync(join(root, 'skill', 'slr', 'references', 'commands.md'), 'utf8');
const errors = readFileSync(join(root, 'skill', 'slr', 'references', 'error-handling.md'), 'utf8');

test('skill guidance covers safe next actions for each review state', () => {
  for (const phrase of [
    'Suggested next actions',
    '/slr tasks',
    '/slr review next',
    '/slr task <taskId>',
    '/slr review <taskId>',
    '/slr list',
    '/slr drafts',
    '/slr edit <taskId> <instruction>',
    '/slr submit [ids]',
    '/slr auto [N]',
    '/slr mcp',
    'connection_test',
    'upload the PDF',
    'confirm',
    'cancel',
    'do not add tools',
  ]) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(skill, new RegExp(escaped, 'i'));
  }
});

test('skill guidance keeps the Claude command aliases on the same safety boundary', () => {
  for (const phrase of [
    '/slr list',
    '/slr review [N|ids]',
    '/slr drafts',
    '/slr edit <taskId> <instruction>',
    '/slr submit [ids]',
    '/slr auto [N]',
    '/slr mcp',
    '/slr diag',
    'digest-bound',
    'no terminal or direct-API fallback',
  ]) {
    assert.match(`${skill}\n${commands}`, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  }
});

test('skill guidance exposes the explicit token configuration path', () => {
  assert.match(skill, /\/slr config token <TOKEN>/);
  assert.match(skill, /slr_config_token/);
  assert.match(commands, /\/slr config token <TOKEN>/);
  assert.match(commands, /without a second confirmation/);
  assert.match(skill, /never repeat, display, summarize, log, persist in profile metadata/i);
});

test('command references keep pending and unavailable full text fail-closed', () => {
  const pendingStart = commands.indexOf('Full text is still processing');
  const pendingEnd = commands.indexOf('For `404`', pendingStart);
  const pending = commands.slice(pendingStart, pendingEnd);
  assert.match(pending, /Suggested next actions/);
  assert.match(pending, /Retry \/slr fulltext <taskId> after the delay/);
  assert.match(pending, /retry \/slr task <taskId> after the delay/i);

  const unavailableStart = commands.indexOf('For a `409` full-text-unavailable result');
  const unavailable = commands.slice(unavailableStart);
  assert.match(commands, /For `404`, explain that the task or assigned paper is unavailable/);
  assert.match(commands, /do not suggest uploading a PDF for a missing task/);
  assert.match(unavailable, /Upload the paper PDF/);
  assert.match(commands, /Do not suggest `\/slr review`/);
  assert.match(errors, /suggest uploading the PDF/);
  assert.match(errors, /retrying the task\/full-text command/);
});

test('setup and review guidance keep state-dependent actions ordered', () => {
  const setupStart = commands.indexOf('`/slr setup` must first');
  const setupEnd = commands.indexOf('When it succeeds', setupStart);
  const setup = commands.slice(setupStart, setupEnd);
  assert.match(setup, /connection_test/);
  assert.doesNotMatch(setup, /list_assigned_tasks/);

  const noTaskSetup = commands.slice(commands.indexOf('If `Assigned tasks` is `none`'));
  assert.match(noTaskSetup, /Assign a paper in the SLR web application/);
  assert.doesNotMatch(noTaskSetup, /review next/);

  const draftGuidance = skill.slice(skill.indexOf('`/slr review <taskId>`:'));
  assert.match(draftGuidance, /ask for one `confirm` or `cancel`/);
  assert.match(draftGuidance, /do not ask for a second confirmation/);
  assert.match(draftGuidance, /After a successful submission/);
  assert.ok(draftGuidance.indexOf('confirm') < draftGuidance.indexOf('do not ask for a second confirmation'));
});

test('review confirmation keeps the digest handshake internal and exposes next actions', () => {
  assert.match(skill, /USER_CONFIRMATION/);
  assert.match(skill, /DIGEST_HANDSHAKE_AND_SUBMIT/);
  assert.match(skill, /Never call `submit_review_result` before an explicit user confirmation/);
  assert.match(skill, /Reply `confirm` once/);
  assert.match(skill, /digest step is handled automatically/);
  assert.match(commands, /After a successful submission/);
  assert.doesNotMatch(skill, /ask for the final confirmation/);
});

test('task responses require visible state-specific next actions', () => {
  const taskListStart = commands.indexOf('## Task list response');
  const fullTextStart = commands.indexOf('## Full-text response', taskListStart);
  const taskList = commands.slice(taskListStart, fullTextStart);
  assert.match(taskList, /Suggested next actions/);
  assert.match(taskList, /\/slr task <taskId>/);
  assert.match(taskList, /\/slr review <taskId>/);
  assert.match(taskList, /upload the PDF/i);

  const taskDetailStart = commands.indexOf('## Task detail response');
  const taskDetailEnd = commands.indexOf('## Full-text response', taskDetailStart);
  const taskDetail = commands.slice(taskDetailStart, taskDetailEnd);
  assert.match(taskDetail, /Suggested next actions/);
  assert.match(taskDetail, /Full text available/);
  assert.match(taskDetail, /Full text unavailable/);
});
