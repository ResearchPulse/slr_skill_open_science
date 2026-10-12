import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { getConfigRoot } from './profile-store.js';

const RUNTIME_PACKAGE_NAME = 'slr-skill-open-science';
const NPM_TIMEOUT_MS = 180_000;

function npmExecutable() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function packageFiles(root) {
  const files = [];
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  visit(root);
  return files.sort();
}

function packageFingerprint(packageRoot) {
  const root = resolve(packageRoot);
  const hash = createHash('sha256');
  for (const path of packageFiles(root)) {
    hash.update(relative(root, path).replaceAll('\\', '/'));
    hash.update('\0');
    hash.update(readFileSync(path));
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, 32);
}

function npmEnvironment() {
  const environment = { ...globalThis['process']['env'] };
  delete environment.SLR_AGENT_TOKEN;
  delete environment.SLR_PROJECT_TOKEN;
  return environment;
}

function runNpm(args, cwd) {
  const windowsBatch = process.platform === 'win32';
  const command = windowsBatch ? (globalThis['process']['env'].ComSpec || 'cmd.exe') : npmExecutable();
  const commandArgs = windowsBatch
    ? ['/d', '/s', '/c', [npmExecutable(), ...args].map(value => {
      const text = String(value);
      return /[\s"&|<>^()]/.test(text) ? `"${text.replace(/(["^])/g, '^$1')}"` : text;
    }).join(' ')]
    : args;
  return spawnSync(command, commandArgs, {
    cwd,
    env: npmEnvironment(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: NPM_TIMEOUT_MS,
    windowsHide: true,
  });
}

function runtimePackageRoot(runtimeRoot) {
  return join(runtimeRoot, 'node_modules', RUNTIME_PACKAGE_NAME);
}

/**
 * Materialize a stable, dependency-complete runtime outside npm's transient
 * _npx directory. Open-Science keeps the MCP process alive, so invoking npx
 * for every connector start can make npm rename a locked package on Windows.
 */
export function ensureRuntime(packageRoot, environment = globalThis['process']['env']) {
  const sourceRoot = resolve(packageRoot);
  if (!existsSync(join(sourceRoot, 'package.json'))) {
    throw new Error('package runtime source is missing package.json');
  }

  const fingerprint = packageFingerprint(sourceRoot);
  const runtimeBase = join(getConfigRoot(environment), 'runtimes');
  const runtimeRoot = join(runtimeBase, fingerprint);
  const installedRoot = runtimePackageRoot(runtimeRoot);
  const entrypoint = join(installedRoot, 'bin', 'install.js');
  if (existsSync(entrypoint)) {
    return { packageRoot: installedRoot, fingerprint, reused: true };
  }

  mkdirSync(runtimeBase, { recursive: true, mode: 0o700 });
  const stagingRoot = join(runtimeBase, `.staging-${randomUUID()}`);
  mkdirSync(stagingRoot, { recursive: true, mode: 0o700 });
  try {
    const packed = runNpm([
      'pack', sourceRoot,
      '--pack-destination', stagingRoot,
      '--ignore-scripts',
    ], sourceRoot);
    if (packed.error || packed.status !== 0) throw new Error('package pack failed');
    const archive = readdirSync(stagingRoot).find(name => name.endsWith('.tgz'));
    if (!archive) throw new Error('package pack produced no archive');

    const installed = runNpm([
      'install',
      '--prefix', stagingRoot,
      '--no-save',
      '--package-lock=false',
      '--omit=dev',
      '--ignore-scripts',
      join(stagingRoot, archive),
    ], stagingRoot);
    if (installed.error || installed.status !== 0) throw new Error('runtime dependency install failed');

    rmSync(join(stagingRoot, archive), { force: true });
    if (!existsSync(entrypoint)) {
      renameSync(stagingRoot, runtimeRoot);
    } else {
      rmSync(stagingRoot, { recursive: true, force: true });
    }
    if (!existsSync(entrypoint)) throw new Error('runtime entrypoint is missing after install');
    return { packageRoot: installedRoot, fingerprint, reused: false };
  } catch (error) {
    if (existsSync(stagingRoot)) rmSync(stagingRoot, { recursive: true, force: true });
    throw new Error(error instanceof Error ? error.message : 'unable to prepare MCP runtime');
  }
}
