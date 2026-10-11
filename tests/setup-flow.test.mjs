import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createProfile, saveProfileToken } from '../cli/profile-store.js';
import { prepareProfile, testProfileConnection } from '../cli/setup.js';
import { registerConnector, writeConnectorConfig } from '../cli/slr.js';

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
    assert.equal('env' in config, false);
    assert.equal('envCredentialIds' in config, false);
    assert.equal('requiredCredentialEnvironment' in config, false);
    assert.equal('note' in config, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('connector registration enables the connector after adding it', () => {
  const calls = [];
  const profile = {
    name: 'default',
    apiBaseUrl: 'https://slr.example.test/api',
    connectorName: 'slr-default',
  };
  const report = {
    openScienceCli: { available: true, executable: 'open-science' },
  };
  const run = (executable, args, input) => {
    calls.push({ executable, args, input });
    return args[1] === 'add'
      ? { status: 0, error: undefined, stdout: JSON.stringify({ id: 'connector-123' }) }
      : { status: 0, error: undefined, stdout: '' };
  };

  assert.deepEqual(registerConnector(profile, report, run), {
    registered: true,
    enabled: true,
    connector: 'connector-123',
    updated: false,
  });
  assert.deepEqual(calls.map(call => call.args), [
    ['connector', 'list', '--json'],
    ['connector', 'add', '--json'],
    ['connector', 'enable', 'connector-123'],
  ]);
  assert.match(calls[1].input, /"name":"slr-default"/);
});

test('connector registration updates an existing connector instead of adding a duplicate', () => {
  const calls = [];
  const profile = {
    name: 'default',
    apiBaseUrl: 'https://slr.example.test/api',
    connectorName: 'slr-default',
  };
  const report = {
    openScienceCli: { available: true, executable: 'open-science' },
  };
  const run = (executable, args, input) => {
    calls.push({ executable, args, input });
    if (args[1] === 'list') {
      return { status: 0, error: undefined, stdout: JSON.stringify({ connectors: [{ id: 'connector-existing', name: 'slr-default' }] }) };
    }
    return { status: 0, error: undefined, stdout: '' };
  };

  assert.deepEqual(registerConnector(profile, report, run), {
    registered: true,
    enabled: true,
    connector: 'connector-existing',
    updated: true,
  });
  assert.deepEqual(calls.map(call => call.args), [
    ['connector', 'list', '--json'],
    ['connector', 'update', 'connector-existing', '--json'],
    ['connector', 'enable', 'connector-existing'],
  ]);
});

test('connector registration recognizes an existing SLR connector by command signature', () => {
  const calls = [];
  const profile = {
    name: 'default',
    apiBaseUrl: 'https://slr.example.test/api',
    connectorName: 'slr-default',
  };
  const report = {
    openScienceCli: { available: true, executable: 'open-science' },
  };
  const run = (executable, args, input) => {
    calls.push({ executable, args, input });
    if (args[1] === 'list') {
      return {
        status: 0,
        error: undefined,
        stdout: JSON.stringify({ connectors: [{ id: 'legacy-slr', name: 'gpt', command: 'npx', args: ['github:ResearchPulse/slr_skill_open_science', '--mcp'] }] }),
      };
    }
    return { status: 0, error: undefined, stdout: '' };
  };

  assert.deepEqual(registerConnector(profile, report, run), {
    registered: true,
    enabled: true,
    connector: 'legacy-slr',
    updated: true,
  });
  assert.deepEqual(calls.map(call => call.args), [
    ['connector', 'list', '--json'],
    ['connector', 'update', 'legacy-slr', '--json'],
    ['connector', 'enable', 'legacy-slr'],
  ]);
});

test('connector registration falls back to updating by stable name when add is rejected', () => {
  const calls = [];
  const profile = {
    name: 'default',
    apiBaseUrl: 'https://slr.example.test/api',
    connectorName: 'slr-default',
  };
  const report = {
    openScienceCli: { available: true, executable: 'open-science' },
  };
  const run = (executable, args, input) => {
    calls.push({ executable, args, input });
    if (args[1] === 'list') return { status: 0, error: undefined, stdout: JSON.stringify({ connectors: [] }) };
    if (args[1] === 'add') return { status: 1, error: undefined, stdout: '' };
    return { status: 0, error: undefined, stdout: '' };
  };

  assert.deepEqual(registerConnector(profile, report, run), {
    registered: true,
    enabled: true,
    connector: 'slr-default',
    updated: true,
  });
  assert.deepEqual(calls.map(call => call.args), [
    ['connector', 'list', '--json'],
    ['connector', 'add', '--json'],
    ['connector', 'update', 'slr-default', '--json'],
    ['connector', 'enable', 'slr-default'],
  ]);
});
