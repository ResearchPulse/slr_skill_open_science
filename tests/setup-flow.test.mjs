import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createProfile, getActiveProfile, getProfile, saveProfileToken, updateProfile } from '../cli/profile-store.js';
import {
  beginTokenConfiguration,
  commitTokenConfiguration,
  prepareProfile,
  testProfileConnection,
} from '../cli/setup.js';
import { ensureOpenScienceDaemon, registerConnector, writeConnectorConfig } from '../cli/slr.js';

const daemonAlreadyReady = () => ({ ready: true, started: false });

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

  assert.deepEqual(registerConnector(profile, report, run, daemonAlreadyReady), {
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

  assert.deepEqual(registerConnector(profile, report, run, daemonAlreadyReady), {
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

  assert.deepEqual(registerConnector(profile, report, run, daemonAlreadyReady), {
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

  assert.deepEqual(registerConnector(profile, report, run, daemonAlreadyReady), {
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

test('connector registration recognizes nested connector configuration output', () => {
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
        stdout: JSON.stringify({ items: [{ id: 'nested-slr', config: { name: 'gpt', command: 'npx', args: ['github:ResearchPulse/slr_skill_open_science', '--mcp'] } }] }),
      };
    }
    return { status: 0, error: undefined, stdout: '' };
  };

  assert.deepEqual(registerConnector(profile, report, run, daemonAlreadyReady), {
    registered: true,
    enabled: true,
    connector: 'nested-slr',
    updated: true,
  });
  assert.deepEqual(calls.map(call => call.args), [
    ['connector', 'list', '--json'],
    ['connector', 'update', 'nested-slr', '--json'],
    ['connector', 'enable', 'nested-slr'],
  ]);
});

test('connector registration preserves a structured Open-Science error code', () => {
  const profile = {
    name: 'default',
    apiBaseUrl: 'https://slr.example.test/api',
    connectorName: 'slr-default',
  };
  const report = {
    openScienceCli: { available: true, executable: 'open-science' },
  };
  const run = (executable, args) => {
    if (args[1] === 'list') return { status: 0, error: undefined, stdout: JSON.stringify({ connectors: [] }) };
    return { status: 1, error: undefined, stdout: '', stderr: JSON.stringify({ error: { code: 'invalid_configuration' } }) };
  };

  assert.deepEqual(registerConnector(profile, report, run, daemonAlreadyReady), {
    registered: false,
    reason: 'open-science-connector-add-failed:invalid_configuration',
    exitCode: 1,
  });
});

test('daemon readiness reuses an already running Open-Science daemon', () => {
  const calls = [];
  const run = (executable, args) => {
    calls.push({ executable, args });
    return { status: 0, error: undefined, stdout: JSON.stringify({ running: true }) };
  };

  assert.deepEqual(ensureOpenScienceDaemon('open-science', run, { pollAttempts: 1, pollDelayMs: 0 }), {
    ready: true,
    started: false,
  });
  assert.deepEqual(calls.map(call => call.args), [['status', '--json']]);
});

test('daemon readiness starts a stopped daemon and waits for running state', () => {
  const calls = [];
  let statusCalls = 0;
  const run = (executable, args) => {
    calls.push({ executable, args });
    if (args[0] === 'status') {
      statusCalls += 1;
      return { status: 0, error: undefined, stdout: JSON.stringify({ running: statusCalls > 1 }) };
    }
    return { status: 0, error: undefined, stdout: '' };
  };

  assert.deepEqual(ensureOpenScienceDaemon('open-science', run, { pollAttempts: 2, pollDelayMs: 0 }), {
    ready: true,
    started: true,
  });
  assert.deepEqual(calls.map(call => call.args), [
    ['status', '--json'],
    ['start', '--no-open'],
    ['status', '--json'],
  ]);
});

test('daemon readiness returns a bounded failure when start fails', () => {
  const calls = [];
  const run = (executable, args) => {
    calls.push({ executable, args });
    if (args[0] === 'status') return { status: 0, error: undefined, stdout: JSON.stringify({ running: false }) };
    return { status: 1, error: undefined, stdout: '', stderr: 'daemon unavailable' };
  };

  assert.deepEqual(ensureOpenScienceDaemon('open-science', run, { pollAttempts: 2, pollDelayMs: 0 }), {
    ready: false,
    started: false,
    reason: 'open-science-daemon-start-failed',
  });
  assert.deepEqual(calls.map(call => call.args), [
    ['status', '--json'],
    ['start', '--no-open'],
  ]);
});

test('missing Open-Science CLI keeps connector registration as a manual fallback', () => {
  let readinessChecked = false;
  const result = registerConnector(
    { name: 'default', apiBaseUrl: 'https://slr.example.test/api', connectorName: 'slr-default' },
    { openScienceCli: { available: false } },
    () => ({ status: 0, error: undefined, stdout: '' }),
    () => { readinessChecked = true; return { ready: true }; },
  );

  assert.deepEqual(result, { registered: false, reason: 'open-science-cli-not-detected' });
  assert.equal(readinessChecked, false);
});

test('config wizard validates before commit and offers an exact-token profile switch', async () => {
  const root = mkdtempSync(join(tmpdir(), 'slr-config-wizard-test-'));
  const environment = { SLR_CONFIG_DIR: root };
  const server = createServer((request, response) => {
    assert.equal(request.headers.authorization, 'Bearer slrp_existing_secret');
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({
      success: true,
      data: { project: { id: 'project-1', name: 'Demo project' }, items: [], hasMore: false },
    }));
  });
  try {
    const port = await listen(server);
    const baseUrl = `http://127.0.0.1:${port}/api`;
    const existing = createProfile({ name: 'existing', apiBaseUrl: baseUrl }, environment);
    saveProfileToken(existing.name, 'slrp_existing_secret', environment);
    updateProfile(existing.name, { projectId: 'project-1', projectName: 'Demo project' }, environment);

    const started = await beginTokenConfiguration({
      name: 'new-profile',
      apiBaseUrl: baseUrl,
      token: 'slrp_existing_secret',
      environment,
    });
    assert.equal(started.ok, true);
    assert.equal(started.match.type, 'exact');
    assert.equal(started.match.profile.name, 'existing');
    assert.equal(JSON.stringify(started).includes('slrp_existing_secret'), false);
    assert.throws(() => getProfile('new-profile', environment), /profile not found/);

    const committed = commitTokenConfiguration(started.operationId, 'switch', environment);
    assert.equal(committed.profile.name, 'existing');
    assert.equal(getActiveProfile(environment).name, 'existing');
    assert.equal(getProfile('existing', environment).hasLocalToken, true);
  } finally {
    server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('config wizard matches a project and updates the selected profile only after commit', async () => {
  const root = mkdtempSync(join(tmpdir(), 'slr-config-project-test-'));
  const environment = { SLR_CONFIG_DIR: root };
  const server = createServer((request, response) => {
    assert.equal(request.headers.authorization, 'Bearer slrp_rotated_secret');
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({
      success: true,
      data: { project: { id: 'project-2', name: 'Rotated project' }, items: [], hasMore: false },
    }));
  });
  try {
    const port = await listen(server);
    const baseUrl = `http://127.0.0.1:${port}/api`;
    const existing = createProfile({ name: 'project-two', apiBaseUrl: baseUrl, projectId: 'project-2', projectName: 'Rotated project' }, environment);
    saveProfileToken(existing.name, 'slrp_old_secret', environment);
    const duplicate = createProfile({ name: 'project-two-alt', apiBaseUrl: baseUrl, projectId: 'project-2', projectName: 'Rotated project' }, environment);
    saveProfileToken(duplicate.name, 'slrp_other_secret', environment);

    const started = await beginTokenConfiguration({
      name: 'rotated-profile',
      apiBaseUrl: baseUrl,
      token: 'slrp_rotated_secret',
      environment,
    });
    assert.equal(started.match.type, 'project');
    assert.equal(started.match.requiresProfileChoice, true);
    assert.deepEqual(started.match.profiles.map(profile => profile.name), ['project-two', 'project-two-alt']);
    assert.equal(getProfile('project-two', environment).projectName, 'Rotated project');

    assert.throws(() => commitTokenConfiguration(started.operationId, 'update', environment), /multiple profiles/);
    const committed = commitTokenConfiguration(started.operationId, 'update', environment, 'project-two');
    assert.equal(committed.profile.name, 'project-two');
    assert.equal(getActiveProfile(environment).name, 'project-two');
    assert.throws(() => getProfile('rotated-profile', environment), /profile not found/);
  } finally {
    server.close();
    rmSync(root, { recursive: true, force: true });
  }
});
