import { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const npmCli = process['env']['npm_execpath'] || join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  if (result.error) {
    throw new Error(`${command} ${args.join(' ')} failed to start: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || 'no command output').trim();
    throw new Error(`${command} ${args.join(' ')} failed: ${detail}`);
  }

  return result.stdout;
}

function runExpectedFailure(command, args, cwd, forbiddenText) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  if (result.status === 0) {
    throw new Error(`${command} ${args.join(' ')} unexpectedly succeeded`);
  }
  if (output.includes(forbiddenText)) {
    throw new Error(`forbidden text appeared in command output: ${forbiddenText}`);
  }
  return output;
}

function runMcpStartupProbe(entrypoint, cwd) {
  const result = spawnSync(process.execPath, [entrypoint, '--mcp'], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      SLR_API_BASE_URL: 'http://127.0.0.1:1/api',
      SLR_AGENT_TOKEN: 'pack-smoke-token',
      SLR_REQUEST_TIMEOUT_MS: '1000',
    },
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 1_500,
    windowsHide: true,
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  if (output.includes('Cannot find module') || output.includes('ERR_MODULE_NOT_FOUND')) {
    throw new Error(`clean-installed MCP failed to resolve runtime dependencies: ${output}`);
  }
  if (!output.includes('SLR agent MCP server is running over stdio')) {
    throw new Error(`clean-installed MCP did not reach stdio startup: ${output}`);
  }
}

function runConfigMcpStartupProbe(entrypoint, cwd) {
  const configRoot = mkdtempSync(join(tmpdir(), 'slr-config-pack-smoke-'));
  const env = { ...process.env, SLR_CONFIG_DIR: configRoot };
  delete env.SLR_AGENT_TOKEN;
  const result = spawnSync(process.execPath, [entrypoint, '--config-mcp'], {
    cwd,
    encoding: 'utf8',
    env,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 1_500,
    windowsHide: true,
  });
  const output = String(result.stdout || '') + '\n' + String(result.stderr || '');
  rmSync(configRoot, { recursive: true, force: true });
  if (output.includes('Cannot find module') || output.includes('ERR_MODULE_NOT_FOUND')) {
    throw new Error('clean-installed config MCP failed to resolve runtime dependencies: ' + output);
  }
  if (!output.includes('SLR config MCP server is running over stdio')) {
    throw new Error('clean-installed config MCP did not reach stdio startup: ' + output);
  }
}

const tempRoot = mkdtempSync(join(tmpdir(), 'slr-open-science-pack-'));
const cacheRoot = process['env']['PACK_SMOKE_CACHE_PATH'] || join(tempRoot, 'npm-cache');
mkdirSync(cacheRoot, { recursive: true });

try {
  run(process.execPath, [npmCli,
    'pack',
    '--ignore-scripts',
    '--pack-destination', tempRoot,
    '--cache', cacheRoot,
  ], packageRoot);

  const tarballName = readdirSync(tempRoot).find(name => name.endsWith('.tgz'));
  if (!tarballName) throw new Error('npm pack did not produce a tarball');

  const tarballPath = join(tempRoot, tarballName);
  const installRoot = join(tempRoot, 'clean-install');
  run(process.execPath, [npmCli,
    'install',
    '--ignore-scripts',
    '--prefix', installRoot,
    '--cache', cacheRoot,
    tarballPath,
  ], packageRoot);

  const installedRoot = join(installRoot, 'node_modules', 'slr-skill-open-science');
  const installedBin = join(installedRoot, 'bin', 'install.js');
  const installedPythonRuntime = join(installedRoot, 'scripts', 'slr.py');
  const installedPythonServer = join(installedRoot, 'scripts', 'slr_mcp.py');
  const installedPythonConfigServer = join(installedRoot, 'scripts', 'slr_config_mcp.py');

  if (!existsSync(installedBin)
    || !existsSync(installedPythonRuntime) || !existsSync(installedPythonServer) || !existsSync(installedPythonConfigServer)) {
    throw new Error('clean install is missing the root bin or MCP runtime assets');
  }

  run(process.execPath, [installedBin, 'doctor', '--json'], packageRoot);
  runExpectedFailure(process.execPath, [installedBin, '--token', 'pack-smoke-secret'], packageRoot, 'pack-smoke-secret');
  runExpectedFailure(process.execPath, [installedBin, 'unknown-pack-smoke-secret'], packageRoot, 'unknown-pack-smoke-secret');
  runMcpStartupProbe(installedBin, packageRoot);
  runConfigMcpStartupProbe(installedBin, packageRoot);
  console.log(`pack smoke passed: ${tarballName}`);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
