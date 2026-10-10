#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);

function fail(message) {
  console.error(`slr: ${message}`);
  process.exitCode = 1;
}

function runMcp(mcpArgs) {
  const entrypoint = resolve(packageRoot, 'mcp', 'slr-agent-mcp', 'out', 'index.js');
  if (!existsSync(entrypoint)) {
    fail('MCP build is missing. Run npm run compile:mcp from the package root first.');
    return;
  }

  const child = spawn(process.execPath, [entrypoint, ...mcpArgs], {
    cwd: packageRoot,
    env: process.env,
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

async function runCli(cliArgs) {
  const cliPath = pathToFileURL(resolve(packageRoot, 'cli', 'slr.js')).href;
  const cli = await import(cliPath);
  await cli.main(cliArgs, { packageRoot });
}

if (args[0] === '--mcp' || args[0] === 'mcp') {
  runMcp(args.slice(1));
} else {
  runCli(args).catch(error => {
    fail(error instanceof Error ? error.message : 'unexpected installer error');
  });
}
