import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createProfile, saveProfileToken } from '../cli/profile-store.js';
import { prepareProfile, testProfileConnection } from '../cli/setup.js';
import { writeConnectorConfig } from '../cli/slr.js';

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

test('new non-interactive profiles use the production API default', async () => {
  const root = mkdtempSync(join(tmpdir(), 'slr-default-url-test-'));
  try {
    const setup = await prepareProfile({ name: 'default-url', interactive: false, environment: { SLR_CONFIG_DIR: root } });
    assert.equal(setup.profile.apiBaseUrl, 'https://slr-api.hyperdatalab.org/api');
    assert.equal(setup.token, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('profile setup loads a local token and tests the read-only task endpoint', async () => {
  const root = mkdtempSync(join(tmpdir(), 'slr-setup-test-'));
  const environment = { SLR_CONFIG_DIR: root };
  const server = createServer((request, response) => {
    assert.equal(request.url, '/api/agent/v1/tasks?limit=1');
    assert.equal(request.headers.authorization, 'Bearer slrp_test_secret');
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({
      success: true,
      data: { project: { id: 'project-1', name: 'Demo project' }, items: [], hasMore: false },
    }));
  });
  try {
    const port = await listen(server);
    const baseUrl = `http://127.0.0.1:${port}/api`;
    const created = createProfile({ name: 'demo', apiBaseUrl: baseUrl }, environment);
    saveProfileToken(created.name, 'slrp_test_secret', environment);

    const setup = await prepareProfile({ name: 'demo', interactive: false, environment });
    assert.equal(setup.profile.name, 'demo');
    assert.equal(setup.token, 'slrp_test_secret');
    const connection = await testProfileConnection(setup.profile, setup.token);
    assert.deepEqual(connection, {
      connected: true,
      status: 200,
      projectId: 'project-1',
      projectName: 'Demo project',
      assignedTasks: 0,
      hasMore: false,
    });
  } finally {
    server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('setup connection failures never include the token in the result', async () => {
  const connection = await testProfileConnection({ apiBaseUrl: 'http://127.0.0.1:1/api' }, 'slrp_private_secret');
  assert.equal(connection.connected, false);
  assert.equal(JSON.stringify(connection).includes('slrp_private_secret'), false);
});

test('manual connector config is profile-aware and secret-free', () => {
  const root = mkdtempSync(join(tmpdir(), 'slr-config-test-'));
  const environment = { SLR_CONFIG_DIR: root };
  try {
    const profile = createProfile({ name: 'manual', apiBaseUrl: 'http://127.0.0.1:3000/api' }, environment);
    saveProfileToken(profile.name, 'slrp_manual_secret', environment);
    const path = writeConnectorConfig(profile, environment);
    const config = JSON.parse(readFileSync(path, 'utf8'));
    assert.deepEqual(config.args, ['--yes', 'github:ResearchPulse/slr_skill_open_science', '--mcp', '--profile', 'manual']);
    assert.equal(JSON.stringify(config).includes('slrp_manual_secret'), false);
    assert.equal('requiredCredentialEnvironment' in config, false);
    assert.equal('note' in config, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
