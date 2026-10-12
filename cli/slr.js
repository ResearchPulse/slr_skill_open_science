import { chmodSync, existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createProfile,
  getActiveProfile,
  getProfile,
  listProfiles,
  removeProfile,
  configRootFor,
  updateProfile,
  useProfile,
} from './profile-store.js';
import { installSkill } from './skill-store.js';
import {
  beginTokenConfiguration,
  cancelTokenConfiguration,
  commitTokenConfiguration,
  prepareProfile,
  testProfileConnection,
} from './setup.js';
import { initializeWorkspace, listAudit, listDrafts } from './workspace.js';

const DEFAULT_COMMAND = 'setup';
const DAEMON_POLL_ATTEMPTS = 8;
const DAEMON_POLL_DELAY_MS = 250;
const OPEN_SCIENCE_STATUS_TIMEOUT_MS = 2_000;
const OPEN_SCIENCE_START_TIMEOUT_MS = 8_000;
const CREDENTIAL_OPTION_PREFIXES = ['--token', '--agent-token', '--api-key', '--password', '--secret'];
const VALUE_FLAGS = new Set([
  '--profile', '--name', '--api-base-url', '--project-id', '--project-name',
  '--credential-id', '--connector-id', '--connector-name', '--skill-dir', '--limit',
  '--operation', '--action',
]);

function hasFlag(args, flag) {
  return args.includes(flag);
}

function flagValue(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function firstCommand(args, fallback = DEFAULT_COMMAND) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith('--')) {
      if (VALUE_FLAGS.has(arg)) index += 1;
      continue;
    }
    return arg;
  }
  return fallback;
}

function profileNameFrom(args) {
  return flagValue(args, '--profile') || flagValue(args, '--name');
}

function selectedProfile(args) {
  const name = profileNameFrom(args);
  return name ? getProfile(name) : getActiveProfile();
}

function printValue(value, asJson = false) {
  console.log(asJson ? JSON.stringify(value, null, 2) : JSON.stringify(value, null, 2));
}

function connectorConfig(profile) {
  if (!profile) throw new Error('no active profile; create or select one first');
  return {
    name: profile.connectorName || `slr-${profile.name}`,
    displayName: `SLR (${profile.projectName || profile.name})`,
    transport: 'stdio',
    command: 'npx',
    args: ['--yes', 'github:ResearchPulse/slr_skill_open_science', '--mcp', '--profile', profile.name],
    ...(profile.credentialId ? { envCredentialIds: { SLR_AGENT_TOKEN: profile.credentialId } } : {}),
  };
}

function configConnectorConfig(credentialId = undefined) {
  return {
    name: 'slr-config',
    displayName: 'SLR Config',
    transport: 'stdio',
    command: 'npx',
    args: ['--yes', 'github:ResearchPulse/slr_skill_open_science', '--config-mcp'],
    ...(credentialId ? { envCredentialIds: { SLR_AGENT_TOKEN: credentialId } } : {}),
  };
}

function openScienceCommand(executable, args, input = undefined) {
  const windowsBatch = process.platform === 'win32' && /\.(cmd|bat)$/i.test(executable);
  const command = windowsBatch ? (process['env']['ComSpec'] || 'cmd.exe') : executable;
  const commandArgs = windowsBatch
    ? ['/d', '/s', '/c', [executable, ...args].map(value => {
      const text = String(value);
      return /[\s"&|<>^()]/.test(text) ? `"${text.replace(/(["^])/g, '^$1')}"` : text;
    }).join(' ')]
    : args;
  return spawnSync(command, commandArgs, {
    input,
    encoding: 'utf8',
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: args[0] === 'status'
      ? OPEN_SCIENCE_STATUS_TIMEOUT_MS
      : args[0] === 'start'
        ? OPEN_SCIENCE_START_TIMEOUT_MS
        : 15_000,
    windowsHide: true,
  });
}

function waitMilliseconds(milliseconds) {
  if (!milliseconds || milliseconds <= 0) return;
  const signal = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(signal, 0, 0, milliseconds);
}

function parseJsonOutput(stdout) {
  try {
    return JSON.parse(stdout || '{}');
  } catch {
    return null;
  }
}

function connectorRecords(value) {
  const records = [];
  const visit = candidate => {
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    if (!candidate || typeof candidate !== 'object') return;
    if (connectorIdFromRecord(candidate) && (
      candidate.name || candidate.connectorName || candidate.displayName || candidate.connector?.name
      || candidate.config?.name || candidate.config?.displayName || candidate.config?.connector?.name
    )) records.push(candidate);
    Object.values(candidate).forEach(visit);
  };
  visit(value);
  return records;
}

function connectorIdFromRecord(record) {
  return record?.id || record?.connectorId || record?.connector?.id
    || record?.config?.id || record?.config?.connectorId || record?.name || null;
}

function existingConnectorId(stdout, connector) {
  const records = connectorRecords(parseJsonOutput(stdout));
  const namedMatch = records.find(record => {
    const names = [
      record?.id,
      record?.name,
      record?.connectorName,
      record?.displayName,
      record?.connector?.name,
      record?.config?.name,
      record?.config?.displayName,
      record?.config?.connector?.name,
    ];
    return names.includes(connector.name) || names.includes(connector.displayName);
  });
  if (namedMatch) return connectorIdFromRecord(namedMatch);

  const expectedMode = connector.args.includes('--config-mcp') ? '--config-mcp' : '--mcp';
  const signatureMatch = records.find(record => {
    const config = record?.config || record?.connector || record;
    const args = Array.isArray(config?.args) ? config.args.map(value => String(value)) : [];
    return config?.command === connector.command
      && args.includes('github:ResearchPulse/slr_skill_open_science')
      && args.includes(expectedMode);
  });
  return signatureMatch ? connectorIdFromRecord(signatureMatch) : null;
}

function failureCode(result) {
  const value = parseJsonOutput(result?.stderr) || parseJsonOutput(result?.stdout);
  return value?.error?.code || value?.code || null;
}

function daemonState(result) {
  if (!result || result.error || result.status !== 0) return { known: false, running: false };
  const value = parseJsonOutput(result.stdout);
  return typeof value?.running === 'boolean'
    ? { known: true, running: value.running }
    : { known: false, running: false };
}

export function ensureOpenScienceDaemon(
  executable,
  run = openScienceCommand,
  { pollAttempts = DAEMON_POLL_ATTEMPTS, pollDelayMs = DAEMON_POLL_DELAY_MS } = {},
) {
  const initial = daemonState(run(executable, ['status', '--json']));
  if (initial.known && initial.running) return { ready: true, started: false };

  const started = run(executable, ['start', '--no-open']);
  if (started.error || started.status !== 0) {
    return { ready: false, started: false, reason: 'open-science-daemon-start-failed' };
  }

  for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
    const current = daemonState(run(executable, ['status', '--json']));
    if (current.known && current.running) return { ready: true, started: true };
    if (attempt < pollAttempts - 1) waitMilliseconds(pollDelayMs);
  }

  return { ready: false, started: true, reason: 'open-science-daemon-not-ready' };
}

function connectorIdFromAddOutput(stdout, fallback) {
  const value = parseJsonOutput(stdout);
  return value?.id || value?.connectorId || value?.connector?.id || value?.data?.id || fallback;
}

function writeConnectorDefinitionConfig(connector, environment = process.env) {
  const directory = join(configRootFor(environment), 'connectors');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const target = join(directory, `${connector.name}.json`);
  const temporary = `${target}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(connector, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
  try { chmodSync(temporary, 0o600); } catch { /* Windows may not support POSIX modes. */ }
  try {
    renameSync(temporary, target);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
  return target;
}

export function writeConnectorConfig(profile, environment = process.env) {
  return writeConnectorDefinitionConfig(connectorConfig(profile), environment);
}

export function writeConfigConnectorConfig(environment = process.env, credentialId = undefined) {
  return writeConnectorDefinitionConfig(configConnectorConfig(credentialId), environment);
}

function registerConnectorDefinition(connector, report, run = openScienceCommand, ensureDaemon = ensureOpenScienceDaemon) {
  if (!report.openScienceCli.available || !report.openScienceCli.executable) {
    return { registered: false, reason: 'open-science-cli-not-detected' };
  }
  const executable = report.openScienceCli.executable;
  const daemon = ensureDaemon(executable, run);
  if (!daemon?.ready) {
    return {
      registered: false,
      reason: daemon?.reason || 'open-science-daemon-not-ready',
    };
  }
  const listed = run(executable, ['connector', 'list', '--json']);
  const existingId = listed.error || listed.status !== 0
    ? null
    : existingConnectorId(listed.stdout, connector);
  let operation = existingId ? 'update' : 'add';
  let connectorId = existingId;
  let result = run(
    executable,
    existingId ? ['connector', 'update', existingId, '--json'] : ['connector', 'add', '--json'],
    `${JSON.stringify(connector)}\n`,
  );
  if ((result.error || result.status !== 0) && !existingId) {
    const fallback = run(executable, ['connector', 'update', connector.name, '--json'], `${JSON.stringify(connector)}\n`);
    if (!fallback.error && fallback.status === 0) {
      operation = 'update';
      connectorId = connector.name;
      result = fallback;
    }
  }
  if (result.error || result.status !== 0) {
    return {
      registered: false,
      reason: `open-science-connector-${operation}-failed${failureCode(result) ? `:${failureCode(result)}` : ''}`,
      exitCode: result.status ?? null,
    };
  }
  connectorId ||= connectorIdFromAddOutput(result.stdout, connector.name);
  const enabled = run(executable, ['connector', 'enable', connectorId]);
  if (enabled.error || enabled.status !== 0) {
    return {
      registered: true,
      enabled: false,
      connector: connectorId,
      reason: 'open-science-connector-enable-failed',
    };
  }
  return { registered: true, enabled: true, connector: connectorId, updated: operation === 'update' };
}

export function registerConnector(profile, report, run = openScienceCommand, ensureDaemon = ensureOpenScienceDaemon) {
  return registerConnectorDefinition(connectorConfig(profile), report, run, ensureDaemon);
}

export function registerConfigConnector(
  credentialId,
  report,
  run = openScienceCommand,
  ensureDaemon = ensureOpenScienceDaemon,
) {
  return registerConnectorDefinition(configConnectorConfig(credentialId), report, run, ensureDaemon);
}

function profileOptions(args) {
  return {
    name: profileNameFrom(args),
    apiBaseUrl: flagValue(args, '--api-base-url'),
    projectId: flagValue(args, '--project-id'),
    projectName: flagValue(args, '--project-name'),
    credentialId: flagValue(args, '--credential-id'),
    connectorId: flagValue(args, '--connector-id'),
    connectorName: flagValue(args, '--connector-name'),
  };
}

function rejectCredentialArguments(args) {
  const hasCredentialOption = args.some(arg => CREDENTIAL_OPTION_PREFIXES.some(prefix => (
    arg === prefix || arg.startsWith(`${prefix}=`)
  )));
  if (hasCredentialOption) {
    throw new Error('credential options are not accepted; configure credentials through the Open-Science connector');
  }
}

function commandPath() {
  return process.platform === 'win32' ? 'where.exe' : 'which';
}

function installedOpenScienceCliCandidates(environment = process.env) {
  if (process.platform !== 'win32') return [];
  const candidates = [
    environment.OPEN_SCIENCE_CLI,
    environment.APPDATA && join(environment.APPDATA, 'Open-Science', 'open-science.cmd'),
    environment.APPDATA && join(environment.APPDATA, 'Open-Science', 'bin', 'open-science.cmd'),
    environment.LOCALAPPDATA && join(environment.LOCALAPPDATA, 'Open-Science', 'open-science.cmd'),
    environment.LOCALAPPDATA && join(environment.LOCALAPPDATA, 'Open-Science', 'bin', 'open-science.cmd'),
    environment.APPDATA && join(environment.APPDATA, 'npm', 'open-science.cmd'),
  ];
  return [...new Set(candidates.filter(Boolean))];
}

function detectOpenScienceCli(environment = process.env) {
  const result = spawnSync(commandPath(), ['open-science'], {
    encoding: 'utf8',
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 2_000,
    windowsHide: true,
  });

  if (result.status === 0 && !result.error) {
    const executable = result.stdout.trim().split(/\r?\n/)[0];
    if (executable) return { available: true, executable, source: 'path' };
  }

  const executable = installedOpenScienceCliCandidates(environment).find(candidate => existsSync(candidate));
  return executable
    ? { available: true, executable, source: 'known-path' }
    : { available: false };
}

export function inspectPackage(packageRoot) {
  const assets = {
    skill: resolve(packageRoot, 'skill', 'slr', 'SKILL.md'),
    mcpEntrypoint: resolve(packageRoot, 'mcp', 'slr-agent-mcp', 'out', 'index.js'),
    configMcpEntrypoint: resolve(packageRoot, 'mcp', 'slr-config-mcp', 'out', 'index.js'),
    setupGuide: resolve(packageRoot, 'docs', 'SLR_MCP_OPEN_SCIENCE_SETUP.md'),
  };

  return {
    packageRoot,
    assets: Object.fromEntries(Object.entries(assets).map(([name, path]) => [name, {
      path,
      present: existsSync(path),
    }])),
    openScienceCli: detectOpenScienceCli(),
  };
}

export function openScienceReport(environment = process.env) {
  return { openScienceCli: detectOpenScienceCli(environment) };
}

function printHelp() {
  console.log(`SLR Open-Science installer

Usage:
  npx github:ResearchPulse/slr_skill_open_science [command]

Commands:
  setup     Interactive setup: copy skill, save URL/token, test API, register MCP
  profile   Manage project profiles (create, list, use, inspect, remove)
  workspace Initialize or inspect the local review workspace
  skill     Install or update the /slr skill for Open-Science import
  config    Choose a profile and configure its project token
  doctor    Check package assets, profiles, and Open-Science CLI availability
  update    Show update guidance without changing existing profiles
  help      Show this help

In-chat /slr commands (after the skill is imported):
  /slr help  Show the SLR command menu and confirmation rule
  /slr config Configure or switch the local project profile
  /slr setup Run the read-only quick check via list_assigned_tasks(limit: 1)

The package command slr setup installs/prepares local assets and connector
configuration; it is different from the in-chat /slr setup check.

Internal:
  --mcp     Start the local MCP stdio server with the current environment
  --config-mcp  Start the local profile/token configuration MCP server

Setup flags:
  --profile NAME --api-base-url URL --project-id ID --credential-id ID
  --workspace   initialize paper-review/ for the selected profile
  --skill-dir PATH  override the local skill import directory
  --register   force connector registration (setup attempts it by default)
  --no-register skip connector registration

Credentials:
  Setup asks for the token with hidden terminal input. Config accepts a token
  only through stdin, validates it before committing, and never prints it.
  Use config profiles, config begin --profile NAME --token-stdin --json,
  then config commit --operation ID --action save|switch|update --json.
  Never pass a token in argv or generated connector JSON.`);
}

function printSetup(report, asJson, setup = {}) {
  if (asJson) {
    console.log(JSON.stringify({
      command: 'setup',
      mode: 'preview',
      ...report,
      profile: setup.profile || null,
      connection: setup.connection || null,
      registration: setup.registration || null,
      connectorConfigPath: setup.connectorConfigPath || null,
      configRegistration: setup.configRegistration || null,
      configConnectorConfigPath: setup.configConnectorConfigPath || null,
      nextSteps: [
        'Open a new Open-Science conversation so the updated /slr skill is loaded.',
        'Run /slr setup to verify the read-only MCP connection.',
        'Assign a paper in the SLR web application, then run /slr tasks or /slr review next.',
      ],
    }, null, 2));
    return;
  }

  if (setup.connection?.connected) {
    console.log(`SLR ready${setup.connection.projectName ? ` · ${setup.connection.projectName}` : ''} · ${setup.connection.assignedTasks ?? 0} assigned tasks`);
  } else if (setup.connection) {
    console.log('SLR setup incomplete');
    console.log(`API: failed (${setup.connection.code || 'unknown'})`);
  } else {
    console.log('SLR setup incomplete');
    console.log('API: not tested');
  }
  if (!setup.registration) {
    console.log('Connector: registration skipped');
  } else if (setup.registration.registered && setup.registration.enabled) {
    console.log('Connector: enabled');
  } else if (setup.registration.registered) {
    console.log(`Connector: registered but not enabled (${setup.registration.reason || 'unknown error'})`);
  } else if (setup.registration.reason === 'open-science-cli-not-detected') {
    console.log('Connector: Open-Science CLI not found (manual import required)');
  } else if (setup.registration.reason?.startsWith('open-science-daemon-')) {
    console.log('Connector: Open-Science daemon could not be started (manual import required)');
  } else {
    console.log('Connector: not registered automatically' + (setup.registration?.reason ? ' (' + setup.registration.reason + ')' : ''));
  }
  if (!setup.configRegistration) {
    console.log('Config connector: registration skipped');
  } else if (setup.configRegistration.registered && setup.configRegistration.enabled) {
    console.log('Config connector: enabled');
  } else if (setup.configRegistration.registered) {
    console.log('Config connector: registered but not enabled (' + (setup.configRegistration.reason || 'unknown error') + ')');
  } else {
    console.log('Config connector: not registered automatically' + (setup.configRegistration.reason ? ' (' + setup.configRegistration.reason + ')' : ''));
  }
  if (setup.skill?.status) console.log('Skill: ' + setup.skill.status);
  if ((!setup.registration?.registered || !setup.registration.enabled
    || !setup.configRegistration?.registered || !setup.configRegistration.enabled)
    && (setup.connectorConfigPath || setup.configConnectorConfigPath)) {
    console.log('Manual config: ' + [setup.connectorConfigPath, setup.configConnectorConfigPath].filter(Boolean).join(', '));
  }
  console.log('Next: Open-Science → New conversation → /slr setup');
}

function runProfileCommand(args, asJson) {
  const subcommand = firstCommand(args, 'list') === 'profile'
    ? (args[args.indexOf('profile') + 1] || 'list')
    : firstCommand(args, 'list');
  if (subcommand === 'create') {
    const input = profileOptions(args);
    if (!input.name || !input.apiBaseUrl) throw new Error('profile create requires --name and --api-base-url');
    printValue(createProfile(input), asJson);
    return;
  }
  if (subcommand === 'list') {
    printValue(listProfiles(), asJson);
    return;
  }
  if (subcommand === 'use') {
    const name = profileNameFrom(args) || args[args.indexOf('use') + 1];
    if (!name) throw new Error('profile use requires a profile name');
    printValue(useProfile(name), asJson);
    return;
  }
  if (subcommand === 'inspect') {
    const name = profileNameFrom(args) || args[args.indexOf('inspect') + 1];
    printValue(name ? getProfile(name) : selectedProfile(args), asJson);
    return;
  }
  if (subcommand === 'update') {
    const name = profileNameFrom(args) || args[args.indexOf('update') + 1];
    if (!name) throw new Error('profile update requires a profile name');
    printValue(updateProfile(name, profileOptions(args)), asJson);
    return;
  }
  if (subcommand === 'remove') {
    const name = profileNameFrom(args) || args[args.indexOf('remove') + 1];
    if (!name || !hasFlag(args, '--yes')) throw new Error('profile remove requires a profile name and --yes');
    printValue(removeProfile(name), asJson);
    return;
  }
  throw new Error('unknown profile command; use create, list, use, inspect, update, or remove');
}

function runWorkspaceCommand(args, asJson) {
  const subcommand = firstCommand(args, 'init') === 'workspace'
    ? (args[args.indexOf('workspace') + 1] || 'init')
    : firstCommand(args, 'init');
  const positionalProfile = args[subcommand === 'workspace' ? -1 : args.indexOf(subcommand) + 1];
  const profile = selectedProfile(args) || (positionalProfile ? getProfile(positionalProfile) : null);
  if (!profile) throw new Error('no active profile; create one first');
  if (subcommand === 'init') {
    printValue({ profile: profile.name, paths: initializeWorkspace(profile) }, asJson);
    return;
  }
  if (subcommand === 'drafts') {
    printValue({ profile: profile.name, drafts: listDrafts(profile) }, asJson);
    return;
  }
  if (subcommand === 'audit') {
    printValue({ profile: profile.name, events: listAudit(profile, Number(flagValue(args, '--limit') || 50)) }, asJson);
    return;
  }
  throw new Error('unknown workspace command; use init, drafts, or audit');
}

function runSkillCommand(args, asJson, packageRoot) {
  const subcommand = firstCommand(args, 'install') === 'skill'
    ? (args[args.indexOf('skill') + 1] || 'install')
    : firstCommand(args, 'install');
  if (subcommand !== 'install') throw new Error('unknown skill command; use install');
  printValue(installSkill(packageRoot, flagValue(args, '--skill-dir')), asJson);
}

async function readAllStdin() {
  let value = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) value += chunk;
  return value.trim();
}

async function runConfigCommand(args, asJson, report) {
  const configIndex = args.indexOf('config');
  const candidate = args[configIndex + 1];
  const subcommand = candidate && !candidate.startsWith('--') ? candidate : 'print';
  if (subcommand === 'profiles') {
    printValue({ profiles: listProfiles() }, true);
    return;
  }
  if (subcommand === 'begin') {
    if (!hasFlag(args, '--token-stdin')) throw new Error('config begin requires --token-stdin');
    const token = await readAllStdin();
    const result = await beginTokenConfiguration({
      name: profileNameFrom(args),
      apiBaseUrl: flagValue(args, '--api-base-url'),
      token,
    });
    printValue(result, true);
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (subcommand === 'commit') {
    const operation = flagValue(args, '--operation');
    const action = flagValue(args, '--action');
    if (!operation || !action) throw new Error('config commit requires --operation and --action');
    const result = commitTokenConfiguration(operation, action, process.env, profileNameFrom(args));
    const connectorConfigPath = writeConnectorConfig(result.profile);
    const registration = registerConnector(result.profile, report);
    const configConnectorConfigPath = writeConfigConnectorConfig(process.env, result.profile.credentialId);
    const configRegistration = registerConfigConnector(result.profile.credentialId, report);
    const connectorReady = registration.registered === true && registration.enabled === true;
    const activeProfile = connectorReady ? useProfile(result.profile.name) : getActiveProfile();
    if (report.openScienceCli.available && !connectorReady) process.exitCode = 1;
    printValue({ ...result, activeProfile, connectorConfigPath, registration, configConnectorConfigPath, configRegistration }, true);
    return;
  }
  if (subcommand === 'cancel') {
    const operation = flagValue(args, '--operation');
    if (!operation) throw new Error('config cancel requires --operation');
    printValue(cancelTokenConfiguration(operation), true);
    return;
  }
  if (subcommand === 'print') {
    printValue(connectorConfig(selectedProfile(args)), true);
    return;
  }
  throw new Error('unknown config command; use profiles, begin, commit, cancel, or print');
}

export async function main(args = process.argv.slice(2), options = {}) {
  rejectCredentialArguments(args);
  const packageRoot = options.packageRoot || resolve(fileURLToPath(new URL('..', import.meta.url)));
  const command = firstCommand(args);
  const asJson = hasFlag(args, '--json');
  const report = inspectPackage(packageRoot);

  if (command === 'help' || command === '--help') {
    printHelp();
    return;
  }

  if (command === 'setup') {
    const options = profileOptions(args);
    const interactive = !asJson && Boolean(process.stdin.isTTY && process.stdout.isTTY);
    const setup = await prepareProfile({
      name: options.name,
      apiBaseUrl: options.apiBaseUrl,
      interactive,
    });
    let profile = setup.profile;
    const skill = installSkill(packageRoot, flagValue(args, '--skill-dir'));
    if (profile && hasFlag(args, '--workspace')) initializeWorkspace(profile);
    const connection = profile ? await testProfileConnection(profile, setup.token) : null;
    if (profile && connection?.connected && (connection.projectId || connection.projectName)) {
      profile = updateProfile(profile.name, {
        projectId: connection.projectId,
        projectName: connection.projectName,
      });
    }
    const connectorConfigPath = profile ? writeConnectorConfig(profile) : null;
    const registration = profile && !hasFlag(args, '--no-register')
      ? registerConnector(profile, report)
      : null;
    const configConnectorConfigPath = !hasFlag(args, '--no-register')
      ? writeConfigConnectorConfig(process.env, profile?.credentialId)
      : null;
    const configRegistration = !hasFlag(args, '--no-register')
      ? registerConfigConnector(profile?.credentialId, report)
      : null;
    const value = {
      command: 'setup',
      mode: profile && setup.token ? 'configured' : 'incomplete',
      ...report,
      profile: profile || null,
      connector: profile ? connectorConfig(profile) : null,
      connection,
      registration,
      connectorConfigPath,
      configRegistration,
      configConnectorConfigPath,
      skill,
      nextSteps: [
        'Open a new Open-Science conversation so the updated /slr skill is loaded.',
        'Run /slr setup before reviewing a paper.',
        'Assign a paper in the SLR web application, then run /slr tasks or /slr review next.',
      ],
    };
    if (asJson) printValue(value, true);
    else {
      printSetup(report, false, { profile, connection, registration, connectorConfigPath, configRegistration, configConnectorConfigPath, skill });
    }
    return;
  }

  if (command === 'profile') {
    runProfileCommand(args, asJson);
    return;
  }

  if (command === 'workspace') {
    runWorkspaceCommand(args, asJson);
    return;
  }

  if (command === 'skill') {
    runSkillCommand(args, asJson, packageRoot);
    return;
  }

  if (command === 'config') {
    await runConfigCommand(args, asJson, report);
    return;
  }

  if (command === 'doctor') {
    const activeProfile = getActiveProfile();
    const profileReport = {
      activeProfile: activeProfile ? { name: activeProfile.name, apiBaseUrl: activeProfile.apiBaseUrl, hasCredentialBinding: activeProfile.hasCredentialBinding, workspaceRoot: activeProfile.workspaceRoot } : null,
      profiles: listProfiles().map(profile => ({ name: profile.name, active: profile.active, hasCredentialBinding: profile.hasCredentialBinding })),
    };
    console.log(JSON.stringify({ command, ...report, ...profileReport }, null, 2));
    const missingAsset = Object.values(report.assets).some(asset => !asset.present);
    if (missingAsset) process.exitCode = 1;
    return;
  }

  if (command === 'update') {
    console.log('Update is non-destructive. Re-run the GitHub package reference, then review the generated setup preview before changing connector state.');
    return;
  }

  throw new Error('unknown command; run slr help');
}
