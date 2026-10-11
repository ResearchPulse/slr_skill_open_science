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
    'upload the PDF',
    'confirm',
    'cancel',
    'do not add tools',
  ]) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(skill, new RegExp(escaped, 'i'));
  }
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
  const noTaskSetup = commands.slice(commands.indexOf('If `Assigned tasks` is `none`'));
  assert.match(noTaskSetup, /Assign a paper in the SLR web application/);
  assert.doesNotMatch(noTaskSetup, /review next/);

  const draftGuidance = skill.slice(skill.indexOf('`/slr review <taskId>`:'));
  assert.match(draftGuidance, /show `confirm` and `cancel` as the only next actions/);
  assert.ok(draftGuidance.indexOf('confirm') < draftGuidance.indexOf('Never suggest or call a submit path'));
});
