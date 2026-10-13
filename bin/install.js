#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { getActiveProfile, getProfile } from '../cli/profile-store.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);

function fail(message) {
  console.error(`slr: ${message}`);
  process.exitCode = 1;
}

function flagValue(values, flag) {
  const index = values.indexOf(flag);
  return index >= 0 ? values[index + 1] : undefined;
}

function resolveMcpEnvironment(mcpArgs) {
  const environment = { ...globalThis.process['env'] };
  const profileName = flagValue(mcpArgs, '--profile') || environment.SLR_PROFILE_ID?.trim();
  let profile = null;
  try {
    profile = profileName ? getProfile(profileName, environment) : getActiveProfile(environment);
  } catch (error) {
    fail(error instanceof Error ? error.message : 'unable to load the selected SLR profile');
    return null;
  }

  if (profile) {
    environment.SLR_API_BASE_URL = profile.apiBaseUrl;
    environment.SLR_PROFILE_ID = profile.name;
    if (profile.projectId) environment.SLR_PROJECT_ID = profile.projectId;
    if (profile.projectName) environment.SLR_PROJECT_NAME = profile.projectName;
  }
  if (!environment.SLR_API_BASE_URL || !environment.SLR_AGENT_TOKEN) {
    fail('MCP needs an active profile and the host credential binding SLR_AGENT_TOKEN');
    return null;
  }
  return environment;
}

function findPython() {
  const probe = 'import sys;print(sys.version_info[0],sys.version_info[1]);print(sys.executable)';
  const candidates = process.platform === 'win32'
    ? [['py', '-3'], ['python'], ['python3']]
    : [['python3'], ['python']];
  for (const [command, ...prefix] of candidates) {
    const result = spawnSync(command, [...prefix, '-c', probe], {
      encoding: 'utf8',
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 3_000,
      windowsHide: true,
    });
    if (result.error || result.status !== 0 || !result.stdout) continue;
    const [versionLine, executable] = result.stdout.trim().split(/\r?\n/);
    const [major, minor] = String(versionLine || '').split(' ').map(Number);
    if (major === 3 && minor >= 8 && executable) return executable.trim();
  }
  return null;
}

function runMcp(mcpArgs) {
  const entrypoint = resolve(packageRoot, 'scripts', 'slr_mcp.py');
  if (!existsSync(entrypoint)) {
    fail('Python MCP runtime is missing from the package. Reinstall the package.');
    return;
  }

  const environment = resolveMcpEnvironment(mcpArgs);
  if (!environment) return;
  const python = findPython();
  if (!python) {
    fail('Python 3.8+ is required for the SLR MCP runtime.');
    return;
  }

  const child = spawn(python, [entrypoint, ...mcpArgs], {
    cwd: packageRoot,
    env: environment,
    shell: false,
    stdio: 'inherit',
  });

  child.once('error', error => fail(`unable to start MCP server: ${error.message}`));
  child.once('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exitCode = code ?? 1;
  });
}

function runConfigMcp(mcpArgs) {
  const entrypoint = resolve(packageRoot, 'scripts', 'slr_config_mcp.py');
  if (!existsSync(entrypoint)) {
    fail('Python config MCP runtime is missing from the package. Reinstall the package.');
    return;
  }

  const python = findPython();
  if (!python) {
    fail('Python 3.8+ is required for the SLR config MCP runtime.');
    return;
  }

  const child = spawn(python, [entrypoint, ...mcpArgs], {
    cwd: packageRoot,
    env: { ...globalThis.process['env'] },
    shell: false,
    stdio: 'inherit',
  });

  child.once('error', error => fail(`unable to start config MCP server: ${error.message}`));
  child.once('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exitCode = code ?? 1;
  });
}

async function runCli(cliArgs) {
  const cliPath = pathToFileURL(resolve(packageRoot, 'cli', 'slr.js')).href;
  const cli = await import(cliPath);
  await cli.main(cliArgs, { packageRoot });
}

if (args[0] === '--mcp') {
  runMcp(args.slice(1));
} else if (args[0] === '--config-mcp') {
  runConfigMcp(args.slice(1));
} else {
  runCli(args).catch(error => {
    fail(error instanceof Error ? error.message : 'unexpected installer error');
  });
}
