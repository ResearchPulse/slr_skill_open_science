#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
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

function runMcp(mcpArgs) {
  const entrypoint = resolve(packageRoot, 'mcp', 'slr-agent-mcp', 'out', 'index.js');
  if (!existsSync(entrypoint)) {
    fail('MCP build is missing. Run npm run compile:mcp from the package root first.');
    return;
  }

  const environment = resolveMcpEnvironment(mcpArgs);
  if (!environment) return;

  const child = spawn(process.execPath, [entrypoint, ...mcpArgs], {
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
  const entrypoint = resolve(packageRoot, 'mcp', 'slr-config-mcp', 'out', 'index.js');
  if (!existsSync(entrypoint)) {
    fail('config MCP build is missing. Run npm run compile:config-mcp from the package root first.');
    return;
  }

  const child = spawn(process.execPath, [entrypoint, ...mcpArgs], {
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
