import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createProfile, getActiveProfile, getProfile, saveProfileToken, tokenFingerprint, updateProfile } from '../cli/profile-store.js';
import {
  beginTokenConfiguration,
  commitTokenConfiguration,
  prepareProfile,
  testProfileConnection,
} from '../cli/setup.js';
import {
  ensureOpenScienceCredential,
  ensureOpenScienceDaemon,
  registerConfigConnector,
  registerConnector,
} from '../cli/slr.js';

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

test('profile setup never loads a local token', async () => {
  const root = mkdtempSync(join(tmpdir(), 'slr-setup-test-'));
  const environment = { SLR_CONFIG_DIR: root };
  try {
    const baseUrl = 'http://127.0.0.1:3000/api';
    const created = createProfile({ name: 'demo', apiBaseUrl: baseUrl }, environment);
    assert.throws(() => saveProfileToken(created.name, 'slrp_test_secret', environment), /local token storage is disabled/);

    const setup = await prepareProfile({ name: 'demo', interactive: false, environment });
    assert.equal(setup.profile.name, 'demo');
    assert.equal(setup.token, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('setup connection failures never include the token in the result', async () => {
  const connection = await testProfileConnection({ apiBaseUrl: 'http://127.0.0.1:1/api' }, 'slrp_private_secret');
  assert.equal(connection.connected, false);
  assert.equal(JSON.stringify(connection).includes('slrp_private_secret'), false);
});

test('connector registration enables the connector after adding it', () => {
  const calls = [];
  const profile = {
    name: 'default',
    apiBaseUrl: 'https://slr-api.hyperdatalab.org/api',
    connectorName: 'slr-default',
    credentialId: 'credential-slr',
  };
  const report = {
    openScienceCli: { available: true, executable: 'open-science' },
  };
  const run = (executable, args, input) => {
    calls.push({ executable, args, input });
    if (args[1] === 'list') return { status: 0, error: undefined, stdout: JSON.stringify({ connectors: [] }) };
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
  const connector = JSON.parse(calls[1].input);
  assert.notEqual(connector.command, process.execPath);
  assert.match(connector.command, /python/i);
  assert.match(connector.args[0], /[\\/]scripts[\\/]slr_mcp\.py$/);
  assert.deepEqual(connector.args.slice(1), ['--profile', 'default']);
});

test('Open-Science credential binding creates a stable SLR token credential', () => {
  const calls = [];
  const report = {
    openScienceCli: { available: true, executable: 'open-science' },
  };
  const run = (executable, args, input) => {
    calls.push({ executable, args, input });
    if (args[0] === 'credential' && args[1] === 'list') {
      return { status: 0, error: undefined, stdout: JSON.stringify({ credentials: [] }) };
    }
    if (args[0] === 'credential' && args[1] === 'add') {
      return {
        status: 0,
        error: undefined,
        stdout: JSON.stringify({ createdCredential: { id: 'credential-slr' } }),
      };
    }
    return { status: 0, error: undefined, stdout: '' };
  };

  assert.deepEqual(ensureOpenScienceCredential('slrp_test_secret', report, run, daemonAlreadyReady), {
    configured: true,
    credentialId: 'credential-slr',
    displayName: 'SLR_AGENT_TOKEN',
    created: true,
    updated: false,
  });
  assert.deepEqual(calls.map(call => call.args), [
    ['credential', 'list', '--json'],
    ['credential', 'add', '--json'],
  ]);
  assert.deepEqual(JSON.parse(calls[1].input), {
    displayName: 'SLR_AGENT_TOKEN',
    kind: 'token',
    secret: 'slrp_test_secret',
  });
});

test('Open-Science credential binding updates an existing SLR credential without returning its secret', () => {
  const calls = [];
  const report = {
    openScienceCli: { available: true, executable: 'open-science' },
  };
  const run = (executable, args, input) => {
    calls.push({ executable, args, input });
    if (args[0] === 'credential' && args[1] === 'list') {
      return {
        status: 0,
        error: undefined,
        stdout: JSON.stringify({ credentials: [{ id: 'credential-existing', displayName: 'SLR_AGENT_TOKEN', kind: 'token' }] }),
      };
    }
    return { status: 0, error: undefined, stdout: '' };
  };

  const result = ensureOpenScienceCredential('slrp_rotated_secret', report, run, daemonAlreadyReady);
  assert.deepEqual(result, {
    configured: true,
    credentialId: 'credential-existing',
    displayName: 'SLR_AGENT_TOKEN',
    created: false,
    updated: true,
  });
  assert.deepEqual(calls.map(call => call.args), [
    ['credential', 'list', '--json'],
    ['credential', 'update', 'credential-existing', '--json'],
  ]);
  assert.equal(JSON.stringify(result).includes('slrp_rotated_secret'), false);
  assert.deepEqual(JSON.parse(calls[1].input), {
    displayName: 'SLR_AGENT_TOKEN',
    secret: 'slrp_rotated_secret',
  });
});

test('Open-Science credential binding never repurposes an unrelated token credential', () => {
  const calls = [];
  const report = { openScienceCli: { available: true, executable: 'open-science' } };
  const run = (executable, args, input) => {
    calls.push({ executable, args, input });
    if (args[0] === 'credential' && args[1] === 'list') {
      return {
        status: 0,
        error: undefined,
        stdout: JSON.stringify({ credentials: [{ id: 'credential-unrelated', displayName: 'Other service', kind: 'token' }] }),
      };
    }
    return { status: 0, error: undefined, stdout: JSON.stringify({ id: 'credential-slr' }) };
  };

  const result = ensureOpenScienceCredential('slrp_new_secret', report, run, daemonAlreadyReady);
  assert.equal(result.credentialId, 'credential-slr');
  assert.deepEqual(calls.map(call => call.args), [
    ['credential', 'list', '--json'],
    ['credential', 'add', '--json'],
  ]);
});

test('connector registration updates an existing connector instead of adding a duplicate', () => {
  const calls = [];
  const profile = {
    name: 'default',
    apiBaseUrl: 'https://slr-api.hyperdatalab.org/api',
    connectorName: 'slr-default',
    credentialId: 'credential-slr',
  };
  const report = {
    openScienceCli: { available: true, executable: 'open-science' },
  };
  const run = (executable, args, input) => {
    calls.push({ executable, args, input });
    if (args[1] === 'list') {
      return { status: 0, error: undefined, stdout: JSON.stringify({ connectors: [{ id: 'connector-existing', name: 'slr-default', command: 'npx', args: ['github:ResearchPulse/slr_skill_open_science', '--mcp', '--profile', 'default'] }] }) };
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

test('connector registration does not trust a foreign connector with the same name', () => {
  const calls = [];
  const profile = {
    name: 'default',
    apiBaseUrl: 'https://slr-api.hyperdatalab.org/api',
    connectorName: 'slr-default',
    credentialId: 'credential-slr',
  };
  const report = { openScienceCli: { available: true, executable: 'open-science' } };
  const run = (executable, args, input) => {
    calls.push({ executable, args, input });
    if (args[1] === 'list') {
      return { status: 0, error: undefined, stdout: JSON.stringify({ connectors: [{ id: 'foreign', name: 'slr-default', command: 'other', args: [] }] }) };
    }
    if (args[1] === 'add') return { status: 0, error: undefined, stdout: JSON.stringify({ id: 'new-slr' }) };
    return { status: 0, error: undefined, stdout: '' };
  };

  assert.deepEqual(registerConnector(profile, report, run, daemonAlreadyReady), {
    registered: true,
    enabled: true,
    connector: 'new-slr',
    updated: false,
  });
  assert.equal(calls.some(call => call.args.includes('foreign')), false);
});

test('connector registration recognizes an existing SLR connector by command signature', () => {
  const calls = [];
  const profile = {
    name: 'default',
    apiBaseUrl: 'https://slr-api.hyperdatalab.org/api',
    connectorName: 'slr-default',
    credentialId: 'credential-slr',
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
        stdout: JSON.stringify({ connectors: [{ id: 'legacy-slr', name: 'gpt', command: 'npx', args: ['github:ResearchPulse/slr_skill_open_science', '--mcp', '--profile', 'default'] }] }),
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

test('connector registration fails closed when add is rejected', () => {
  const calls = [];
  const profile = {
    name: 'default',
    apiBaseUrl: 'https://slr-api.hyperdatalab.org/api',
    connectorName: 'slr-default',
    credentialId: 'credential-slr',
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
    registered: false,
    reason: 'open-science-connector-add-failed',
    exitCode: 1,
  });
  assert.deepEqual(calls.map(call => call.args), [
    ['connector', 'list', '--json'],
    ['connector', 'add', '--json'],
  ]);
});

test('connector registration fails closed when connector listing is unavailable or invalid', () => {
  const profile = {
    name: 'default',
    apiBaseUrl: 'https://slr-api.hyperdatalab.org/api',
    connectorName: 'slr-default',
    credentialId: 'credential-slr',
  };
  const report = { openScienceCli: { available: true, executable: 'open-science' } };
  assert.deepEqual(registerConnector(profile, report, (_executable, args) => (
    args[1] === 'list'
      ? { status: 1, error: undefined, stdout: '', stderr: JSON.stringify({ error: { code: 'daemon_unavailable' } }) }
      : { status: 0, error: undefined, stdout: '' }
  ), daemonAlreadyReady), {
    registered: false,
    reason: 'open-science-connector-list-failed:daemon_unavailable',
    exitCode: 1,
  });
  assert.deepEqual(registerConnector(profile, report, (_executable, args) => (
    args[1] === 'list'
      ? { status: 0, error: undefined, stdout: 'not-json' }
      : { status: 0, error: undefined, stdout: '' }
  ), daemonAlreadyReady), {
    registered: false,
    reason: 'open-science-connector-list-failed:invalid_json',
  });
});

test('config connector requires the host credential binding', () => {
  const result = registerConfigConnector(null, { openScienceCli: { available: true, executable: 'open-science' } }, () => {
    throw new Error('connector command must not run without a credential');
  }, () => ({ ready: true }));
  assert.deepEqual(result, { registered: false, reason: 'credential-binding-missing' });
});

test('config connector uses the stable direct-python runtime', () => {
  const calls = [];
  const report = { openScienceCli: { available: true, executable: 'open-science' } };
  const run = (executable, args, input) => {
    calls.push({ executable, args, input });
    if (args[1] === 'list') return { status: 0, error: undefined, stdout: JSON.stringify({ connectors: [] }) };
    return args[1] === 'add'
      ? { status: 0, error: undefined, stdout: JSON.stringify({ id: 'config-connector' }) }
      : { status: 0, error: undefined, stdout: '' };
  };

  assert.deepEqual(registerConfigConnector('credential-slr', report, run, daemonAlreadyReady), {
    registered: true,
    enabled: true,
    connector: 'config-connector',
    updated: false,
  });
  const connector = JSON.parse(calls.find(call => call.args[1] === 'add').input);
  assert.notEqual(connector.command, process.execPath);
  assert.match(connector.command, /python/i);
  assert.match(connector.args[0], /[\\/]scripts[\\/]slr_config_mcp\.py$/);
  assert.deepEqual(connector.args.slice(1), []);
});

test('connector registration recognizes nested connector configuration output', () => {
  const calls = [];
  const profile = {
    name: 'default',
    apiBaseUrl: 'https://slr-api.hyperdatalab.org/api',
    connectorName: 'slr-default',
    credentialId: 'credential-slr',
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
        stdout: JSON.stringify({ items: [{ id: 'nested-slr', config: { name: 'gpt', command: 'npx', args: ['github:ResearchPulse/slr_skill_open_science', '--mcp', '--profile', 'default'] } }] }),
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
    apiBaseUrl: 'https://slr-api.hyperdatalab.org/api',
    connectorName: 'slr-default',
    credentialId: 'credential-slr',
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

test('missing Open-Science CLI fails closed without a manual connector path', () => {
  let readinessChecked = false;
  const result = registerConnector(
    { name: 'default', apiBaseUrl: 'https://slr-api.hyperdatalab.org/api', connectorName: 'slr-default', credentialId: 'credential-slr' },
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
    const existing = createProfile({ name: 'existing', apiBaseUrl: baseUrl, credentialId: 'credential-existing' }, environment);
    updateProfile(existing.name, {
      projectId: 'project-1',
      projectName: 'Demo project',
      credentialFingerprint: tokenFingerprint('slrp_existing_secret'),
    }, environment);

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

    const committed = commitTokenConfiguration(started.operationId, 'switch', environment, undefined, 'credential-existing', tokenFingerprint('slrp_existing_secret'));
    assert.equal(committed.profile.name, 'existing');
    assert.equal(getActiveProfile(environment).name, 'existing');
    assert.equal(getProfile('existing', environment).hasLocalToken, false);
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
    const existing = createProfile({ name: 'project-two', apiBaseUrl: baseUrl, projectId: 'project-2', projectName: 'Rotated project', credentialId: 'credential-two' }, environment);
    const duplicate = createProfile({ name: 'project-two-alt', apiBaseUrl: baseUrl, projectId: 'project-2', projectName: 'Rotated project', credentialId: 'credential-two-alt' }, environment);

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

    assert.throws(() => commitTokenConfiguration(started.operationId, 'update', environment, undefined, undefined, tokenFingerprint('slrp_rotated_secret')), /multiple profiles/);
    const committed = commitTokenConfiguration(started.operationId, 'update', environment, 'project-two', 'credential-two', tokenFingerprint('slrp_rotated_secret'));
    assert.equal(committed.profile.name, 'project-two');
    assert.equal(getActiveProfile(environment).name, 'project-two');
    assert.throws(() => getProfile('rotated-profile', environment), /profile not found/);
  } finally {
    server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('config wizard rejects a credential change between validation and commit', async () => {
  const root = mkdtempSync(join(tmpdir(), 'slr-config-credential-binding-test-'));
  const environment = { SLR_CONFIG_DIR: root };
  const server = createServer((_request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ success: true, data: { project: { id: 'project-3', name: 'Binding project' }, items: [] } }));
  });
  try {
    const port = await listen(server);
    const started = await beginTokenConfiguration({
      name: 'binding-profile',
      apiBaseUrl: `http://127.0.0.1:${port}/api`,
      token: 'slrp_original_secret',
      environment,
    });
    assert.throws(() => commitTokenConfiguration(
      started.operationId,
      'save',
      environment,
      undefined,
      'credential-new',
      tokenFingerprint('slrp_changed_secret'),
    ), /credential changed/);
    assert.throws(() => getProfile('binding-profile', environment), /profile not found/);
  } finally {
    server.close();
    rmSync(root, { recursive: true, force: true });
  }
});
