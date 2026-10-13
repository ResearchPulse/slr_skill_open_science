import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const scripts = join(root, 'scripts');
const configuredPython = process.env['PYTHON'];
const configuredPython3 = process.env['PYTHON3'];
const configuredPythonPath = process.env['PYTHONPATH'];
const candidates = [
  configuredPython,
  configuredPython3,
  ...(process.platform === 'win32' ? ['py', 'python', 'python3'] : ['python3', 'python']),
].filter(Boolean);

function probe(candidate) {
  const prefix = process.platform === 'win32' && candidate === 'py' ? ['-3'] : [];
  const result = spawnSync(candidate, [...prefix, '-c', 'import sys; print(sys.executable)'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 2000,
    windowsHide: true,
  });
  return result.status === 0 && result.stdout.trim()
    ? { command: candidate, prefix }
    : null;
}

const python = candidates.map(probe).find(Boolean);
const skipReason = python
  ? false
  : `Python interpreter unavailable; checked ${[...new Set(candidates)].join(', ')}`;

function runPython(args, { input, env = {}, timeout = 5000 } = {}) {
  return spawnSync(python.command, [...python.prefix, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      PYTHONDONTWRITEBYTECODE: '1',
      PYTHONPATH: [scripts, configuredPythonPath].filter(Boolean).join(delimiter),
      ...env,
    },
    input,
    timeout,
    windowsHide: true,
  });
}

function failureOutput(result) {
  return [result.error?.message, result.stdout, result.stderr].filter(Boolean).join('\n');
}

test('Python runtime imports and validates pure helpers without I/O', { skip: skipReason }, () => {
  const result = runPython(['-c', [
    'import ast',
    'from pathlib import Path',
    'import tempfile',
    'import slr',
    'import slr_config_mcp',
    'import slr_mcp',
    'import slr_config_mcp',
    'assert ast.parse(Path("scripts/slr.py").read_text(encoding="utf-8"))',
    'assert ast.parse(Path("scripts/slr_config_mcp.py").read_text(encoding="utf-8"))',
    'assert ast.parse(Path("scripts/slr_mcp.py").read_text(encoding="utf-8"))',
    'assert slr.canonical_json({"b": 2, "a": [True, None]}) == "{\\"a\\":[true,null],\\"b\\":2}"',
    'assert len(slr_mcp.TOOLS) == 11',
    'assert len(slr_config_mcp.TOOLS) == 5',
    'assert slr.normalize_api_base_url("https://slr-api.hyperdatalab.org/api") == "https://slr-api.hyperdatalab.org/api"',
    'try:',
    '    slr.normalize_api_base_url("http://remote.example.test/api")',
    'except slr.ApiError:',
    '    pass',
    'else:',
    '    raise AssertionError("remote HTTP URLs must be rejected")',
    'body = slr.build_review_body(" INCLUDE ", " rationale ", {"field": "value"})',
    'config = slr.McpConfig("https://slr-api.hyperdatalab.org/api", "test-agent-token")',
    'assert len(slr.confirmation_digest(config, "task-1", body)) == 64',
    'with tempfile.TemporaryDirectory() as temp_root:',
    '    store_root = Path(temp_root)',
    '    (store_root / "tokens").mkdir()',
    '    (store_root / "tokens" / "legacy").write_text("legacy-secret", encoding="utf-8")',
    '    (store_root / "profiles.json").write_text("{\\"version\\":1,\\"activeProfile\\":null,\\"profiles\\":{\\"legacy\\":{}}}", encoding="utf-8")',
    '    slr.read_store({"SLR_CONFIG_DIR": temp_root})',
    '    assert not (store_root / "tokens" / "legacy").exists()',
    'print("python-runtime-ok")',
  ].join('\n')]);

  assert.equal(result.status, 0, failureOutput(result));
  assert.match(result.stdout, /python-runtime-ok/);
});

test('Python MCP runtime serves read-only discovery over stdio', { skip: skipReason }, () => {
  const input = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
  ].map(JSON.stringify).join('\n') + '\n';
  for (const [script, serverName, toolName] of [
    ['scripts/slr_mcp.py', 'slr-agent-mcp-server', 'connection_test'],
    ['scripts/slr_config_mcp.py', 'slr-config-mcp-server', 'slr_config_profiles'],
  ]) {
    const result = runPython([script], {
      input,
      env: {
        SLR_API_BASE_URL: 'https://slr-api.hyperdatalab.org/api',
        SLR_AGENT_TOKEN: 'test-agent-token',
        SLR_PROFILE_ID: 'test-profile',
        SLR_PROJECT_ID: 'test-project',
      },
    });

    assert.equal(result.status, 0, `${script}\n${failureOutput(result)}`);
    const responses = result.stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line));
    assert.equal(responses.length, 2);
    assert.equal(responses[0].result.serverInfo.name, serverName);
    const tools = responses[1].result.tools;
    assert.ok(tools.some((tool) => tool.name === toolName));
  }
});

test('Python config MCP runtime serves protected configuration tools over stdio', { skip: skipReason }, () => {
  const input = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
  ].map(JSON.stringify).join('\n') + '\n';
  const result = runPython(['scripts/slr_config_mcp.py'], {
    input,
    env: { SLR_AGENT_TOKEN: '' },
  });

  assert.equal(result.status, 0, failureOutput(result));
  const responses = result.stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line));
  assert.equal(responses.length, 2);
  assert.equal(responses[0].result.serverInfo.name, 'slr-config-mcp-server');
  assert.deepEqual(responses[1].result.tools.map((tool) => tool.name), [
    'slr_config_profiles',
    'slr_config_validate',
    'slr_config_token',
    'slr_config_commit',
    'slr_config_cancel',
  ]);
});
