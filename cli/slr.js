import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import readline from 'node:readline';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  captureProfileStore,
  createProfile,
  getActiveProfile,
  getProfile,
  listProfiles,
  removeProfile,
  tokenFingerprint,
  restoreProfileStore,
  updateProfile,
  useProfile,
} from './profile-store.js';
import { defaultSkillRoot, installSkill, removeManagedSkill } from './skill-store.js';
import { ensureRuntime } from './runtime-store.js';
import {
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
const SLR_CREDENTIAL_DISPLAY_NAME = 'SLR_AGENT_TOKEN';
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

function promptProjectToken() {
  return new Promise(resolveToken => {
    const prompt = 'Project token (press Enter to configure later): ';
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = value => {
      if (value.includes(prompt)) rl.output.write(value);
      else if (value === '\r\n' || value === '\n' || value === '\r') rl.output.write('\n');
      else rl.output.write('*'.repeat(value.length));
    };
    rl.question(prompt, answer => {
      rl.close();
      resolveToken(String(answer || '').trim());
    });
  });
}

function connectorRuntimeArgs(runtimePackageRoot, mode, profileName = undefined) {
  const args = [resolve(runtimePackageRoot, 'bin', 'install.js'), mode];
  if (profileName) args.push('--profile', profileName);
  return args;
}

function connectorConfig(profile, runtimePackageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))) {
  if (!profile) throw new Error('no active profile; create or select one first');
  return {
    name: profile.connectorName || `slr-${profile.name}`,
    displayName: `SLR (${profile.projectName || profile.name})`,
    transport: 'stdio',
    command: process.execPath,
    args: connectorRuntimeArgs(runtimePackageRoot, '--mcp', profile.name),
    ...(profile.credentialId ? { envCredentialIds: { SLR_AGENT_TOKEN: profile.credentialId } } : {}),
  };
}

function configConnectorConfig(
  credentialId = undefined,
  runtimePackageRoot = resolve(fileURLToPath(new URL('..', import.meta.url))),
) {
  return {
    name: 'slr-config',
    displayName: 'SLR Config',
    transport: 'stdio',
    command: process.execPath,
    args: connectorRuntimeArgs(runtimePackageRoot, '--config-mcp'),
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
  if (!String(stdout || '').trim()) return null;
  try {
    return JSON.parse(stdout);
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
    )) {
      records.push(candidate);
      if (candidate.config || candidate.connector) return;
    }
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
  const expectedMode = connector.args.includes('--config-mcp') ? '--config-mcp' : '--mcp';
  const signatureMatches = records.filter(record => {
    const config = record?.config || record?.connector || record;
    const args = Array.isArray(config?.args) ? config.args.map(value => String(value)) : [];
    const directRuntime = config?.command === connector.command
      && args.some(value => /[\\/]bin[\\/]install\.js$/i.test(value));
    const legacyNpx = config?.command === 'npx'
      && args.includes('github:ResearchPulse/slr_skill_open_science');
    return (directRuntime || legacyNpx)
      && args.includes(expectedMode)
      && (connector.args.includes('--profile')
        ? args.includes('--profile')
          && args[args.indexOf('--profile') + 1] === connector.args[connector.args.indexOf('--profile') + 1]
        : !args.includes('--profile'));
  });
  const namedMatch = signatureMatches.find(record => {
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
  return signatureMatches.length === 1 ? connectorIdFromRecord(signatureMatches[0]) : null;
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

function connectorIdFromAddOutput(stdout) {
  const value = parseJsonOutput(stdout);
  return value?.id
    || value?.connectorId
    || value?.connector?.id
    || value?.createdConnector?.id
    || value?.data?.id
    || value?.data?.connectorId
    || value?.data?.connector?.id
    || null;
}

export function projectTokenCredentialName(profileName = 'default') {
  const name = String(profileName || 'default').trim() || 'default';
  return name === 'default' ? SLR_CREDENTIAL_DISPLAY_NAME : `${SLR_CREDENTIAL_DISPLAY_NAME} (${name})`;
}

function credentialRecords(stdout) {
  const value = parseJsonOutput(stdout);
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.credentials)) return value.credentials;
  if (Array.isArray(value?.data?.credentials)) return value.data.credentials;
  return [];
}

function credentialIdFromWriteOutput(stdout, fallback) {
  const value = parseJsonOutput(stdout);
  return value?.createdCredential?.id
    || value?.credential?.id
    || value?.data?.credential?.id
    || value?.id
    || fallback;
}

function credentialFailure(result, operation) {
  return `open-science-credential-${operation}-failed${failureCode(result) ? `:${failureCode(result)}` : ''}`;
}

function existingSlrCredential(stdout, displayName = SLR_CREDENTIAL_DISPLAY_NAME) {
  const credentials = credentialRecords(stdout).filter(credential => credential?.kind === 'token');
  return credentials.find(credential => credential.displayName === displayName) || null;
}

export function ensureOpenScienceCredential(
  token,
  report,
  run = openScienceCommand,
  ensureDaemon = ensureOpenScienceDaemon,
  displayName = SLR_CREDENTIAL_DISPLAY_NAME,
) {
  if (!token) return { configured: false, reason: 'token-missing' };
  if (!report.openScienceCli.available || !report.openScienceCli.executable) {
    return { configured: false, reason: 'open-science-cli-not-detected' };
  }

  const executable = report.openScienceCli.executable;
  const daemon = ensureDaemon(executable, run);
  if (!daemon?.ready) {
    return { configured: false, reason: daemon?.reason || 'open-science-daemon-not-ready' };
  }

  const listed = run(executable, ['credential', 'list', '--json']);
  if (listed.error || listed.status !== 0) {
    return { configured: false, reason: credentialFailure(listed, 'list') };
  }
  if (parseJsonOutput(listed.stdout) === null) {
    return { configured: false, reason: 'open-science-credential-list-failed:invalid_json' };
  }

  const existing = existingSlrCredential(listed.stdout, displayName);
  const operation = existing ? 'update' : 'add';
  const args = existing
    ? ['credential', 'update', existing.id, '--json']
    : ['credential', 'add', '--json'];
  const input = `${JSON.stringify({
    displayName,
    ...(existing ? {} : { kind: 'token' }),
    secret: token,
  })}\n`;
  const written = run(executable, args, input);
  if (written.error || written.status !== 0) {
    return { configured: false, reason: credentialFailure(written, operation) };
  }

  const credentialId = credentialIdFromWriteOutput(written.stdout, existing?.id);
  if (!credentialId) return { configured: false, reason: 'open-science-credential-id-missing' };
  return {
    configured: true,
    credentialId,
    displayName,
    created: !existing,
    updated: Boolean(existing),
  };
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
  if (listed.error || listed.status !== 0) {
    return {
      registered: false,
      reason: `open-science-connector-list-failed${failureCode(listed) ? `:${failureCode(listed)}` : ''}`,
      exitCode: listed.status ?? null,
    };
  }
  if (parseJsonOutput(listed.stdout) === null) {
    return { registered: false, reason: 'open-science-connector-list-failed:invalid_json' };
  }
  const existingId = existingConnectorId(listed.stdout, connector);
  let operation = existingId ? 'update' : 'add';
  let connectorId = existingId;
  let result = run(
    executable,
    existingId ? ['connector', 'update', existingId, '--json'] : ['connector', 'add', '--json'],
    `${JSON.stringify(connector)}\n`,
  );
  if (result.error || result.status !== 0) {
    return {
      registered: false,
      reason: `open-science-connector-${operation}-failed${failureCode(result) ? `:${failureCode(result)}` : ''}`,
      exitCode: result.status ?? null,
    };
  }
  connectorId ||= connectorIdFromAddOutput(result.stdout);
  if (!connectorId) {
    // Some Open-Science CLI versions acknowledge a successful add without
    // returning the created ID. Read the saved connector back and resolve it
    // by the same name/runtime signature used for idempotent updates.
    const refreshed = run(executable, ['connector', 'list', '--json']);
    if (!refreshed.error && refreshed.status === 0) {
      connectorId = existingConnectorId(refreshed.stdout, connector);
    }
    if (!connectorId) {
      return { registered: false, reason: 'open-science-connector-id-missing' };
    }
  }
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

export function registerConnector(
  profile,
  report,
  run = openScienceCommand,
  ensureDaemon = ensureOpenScienceDaemon,
  runtimePackageRoot = resolve(fileURLToPath(new URL('..', import.meta.url))),
) {
  if (!profile?.credentialId) return { registered: false, reason: 'credential-binding-missing' };
  return registerConnectorDefinition(connectorConfig(profile, runtimePackageRoot), report, run, ensureDaemon);
}

export function registerConfigConnector(
  credentialId,
  report,
  run = openScienceCommand,
  ensureDaemon = ensureOpenScienceDaemon,
  runtimePackageRoot = resolve(fileURLToPath(new URL('..', import.meta.url))),
) {
  return registerConnectorDefinition(configConnectorConfig(credentialId, runtimePackageRoot), report, run, ensureDaemon);
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
  setup     Install the skill and connectors; optionally enter the project token
  install   Alias for setup
  profile   Manage project profiles (create, list, use, inspect, remove)
  workspace Initialize or inspect the local review workspace
  skill     Install or update the /slr skill for Open-Science import
  config    Choose a profile and configure its project token
  mcp       Show safe connector metadata for the active profile
  doctor    Check package assets, profiles, and Open-Science CLI availability
  update    Re-run the setup/update flow while preserving existing profile metadata
  uninstall Remove the managed /slr skill (use --yes; profiles and credentials stay)
  help      Show this help

In-chat /slr commands (after the skill is imported):
  /slr help  Show the SLR command menu and confirmation rule
  /slr config Configure or switch the local project profile
  /slr setup Run the bounded read-only quick check via connection_test

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

Project token:
  Interactive setup asks once (input is hidden); press Enter to configure later
  with /slr config token <TOKEN>. The same project token identifies the agent
  and project to the SLR API. Open-Science stores that value in its encrypted
  SLR_AGENT_TOKEN credential and passes it to the MCP; this is storage/binding
  for the same token, not a second token. Raw token is never stored in profile
  metadata or connector JSON.`);
}

function runMcpCommand(args, asJson, report, packageRoot) {
  const profile = selectedProfile(args);
  const runtimePackageRoot = profile ? ensureRuntime(packageRoot).packageRoot : null;
  const value = {
    command: 'mcp',
    openScienceCli: report.openScienceCli,
    profile: profile ? {
      name: profile.name,
      projectId: profile.projectId,
      projectName: profile.projectName,
      credentialId: profile.credentialId,
      connectorId: profile.connectorId,
      connectorName: profile.connectorName,
    } : null,
    reviewConnector: profile && runtimePackageRoot ? connectorConfig(profile, runtimePackageRoot) : null,
    configConnector: runtimePackageRoot ? configConnectorConfig(profile?.credentialId, runtimePackageRoot) : null,
    note: 'Connector metadata only; tokens are stored by Open-Science credentials and are never printed.',
  };
  printValue(value, asJson);
}

function runUninstallCommand(args, asJson) {
  if (!hasFlag(args, '--yes') && !hasFlag(args, '-y')) {
    throw new Error('uninstall requires --yes (profile metadata and credentials are preserved by default)');
  }
  const skill = removeManagedSkill(flagValue(args, '--skill-dir') || defaultSkillRoot());
  const value = {
    command: 'uninstall',
    skill,
    profilesPreserved: true,
    credentialsPreserved: true,
    connectorsPreserved: true,
    note: 'Remove the SLR connectors from Open-Science Settings separately if they are no longer needed.',
  };
  if (asJson) printValue(value, true);
  else console.log('SLR skill removed: ' + skill.path + '\nProfiles and Open-Science credentials were preserved.');
}

function printSetup(report, asJson, setup = {}) {
  if (asJson) {
    console.log(JSON.stringify({
      command: 'setup',
      mode: 'preview',
      ...report,
      profile: setup.profile || null,
      connection: setup.connection || null,
      credentialBinding: setup.credentialBinding || null,
      registration: setup.registration || null,
      configRegistration: setup.configRegistration || null,
      nextSteps: [
        'In Open-Science, import the local skill: Settings > Skills > Add skill > Import installed skills; select slr and import it.',
        'Open a new conversation after importing the skill.',
        ...(setup.tokenConfigured
          ? ['Run /slr setup to verify the read-only MCP connection.', 'Assign a paper in the SLR web application, then run /slr tasks or /slr review next.']
          : ['Run /slr config token <TOKEN> to bind the project credential and enable the review connector.']),
      ],
    }, null, 2));
    return;
  }

  if (!setup.tokenConfigured && setup.configRegistration?.registered && setup.configRegistration?.enabled) {
    console.log(`SLR skill installed${setup.profile?.name ? ` · profile ${setup.profile.name}` : ''}`);
    console.log('Config connector: enabled (slr-config)');
    if (setup.skill?.status) console.log('Skill files: ' + setup.skill.status);
    console.log('Next: Open-Science → Settings → Skills → Add skill → Import installed skills → select slr → Import selected');
    console.log('Then open a new conversation and run /slr config token <TOKEN> if the project token is not configured.');
    return;
  } else if (setup.connection?.connected) {
    console.log(`SLR ready${setup.connection.projectName ? ` · ${setup.connection.projectName}` : ''} · ${setup.connection.assignedTasks ?? 0} assigned tasks`);
  } else if (setup.connection) {
    console.log('SLR setup incomplete');
    console.log(`API: failed (${setup.connection.code || 'unknown'})`);
    if (setup.connection.message) console.log(`API detail: ${setup.connection.message}`);
  } else if (setup.tokenConfigured) {
    console.log('SLR connectors ready');
    console.log('API: not checked; run /slr setup');
  } else {
    console.log('SLR setup incomplete');
    console.log('API: not tested');
  }
  if (setup.credentialBinding?.configured) console.log('Project token: validated and connected');
  const reviewReady = setup.registration?.registered === true && setup.registration?.enabled === true;
  const configReady = setup.configRegistration?.registered === true && setup.configRegistration?.enabled === true;
  if (setup.tokenConfigured && reviewReady && configReady) console.log('Connectors: enabled (slr-default, slr-config)');
  else console.log(`Connector setup failed (${setup.registration?.reason || setup.configRegistration?.reason || 'unknown'})`);
  if (setup.skill?.status) console.log('Skill files: ' + setup.skill.status);
  console.log('Next: Import slr from Open-Science → Settings → Skills → Add skill → Import installed skills, then open a new conversation.');
  if (setup.tokenConfigured) console.log('Run /slr setup to verify the connection.');
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

async function runConfigCommand(args, asJson, report) {
  const configIndex = args.indexOf('config');
  const candidate = args[configIndex + 1];
  const subcommand = candidate && !candidate.startsWith('--') ? candidate : 'print';
  if (subcommand === 'profiles') {
    printValue({ profiles: listProfiles() }, true);
    return;
  }
  if (['begin', 'commit', 'cancel', 'print'].includes(subcommand)) {
    throw new Error('profile token configuration is available only through the connected slr-config MCP connector');
  }
  throw new Error('unknown config command; use profiles or /slr config in Open-Science');
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

  if (command === 'setup' || command === 'install' || command === 'update') {
    const profileStoreSnapshot = captureProfileStore(process.env);
    try {
      const options = profileOptions(args);
      const setup = await prepareProfile({
        name: options.name,
        apiBaseUrl: options.apiBaseUrl,
      });
      const canPrompt = !asJson && !hasFlag(args, '--yes')
        && process.stdin.isTTY && process.stdout.isTTY;
      if (canPrompt && !hasFlag(args, '--no-register') && setup.profile && !setup.profile.credentialId) {
        const token = await promptProjectToken();
        if (token) setup.token = token;
      }
    let profile = setup.profile;
    const hasCredential = Boolean(setup.token || profile?.credentialId);
    const skill = installSkill(packageRoot, flagValue(args, '--skill-dir'));
    if (profile && hasFlag(args, '--workspace')) initializeWorkspace(profile);
    const connection = profile && setup.token ? await testProfileConnection(profile, setup.token) : null;
    if (profile && connection?.connected && (connection.projectId || connection.projectName)) {
      profile = updateProfile(profile.name, {
        projectId: connection.projectId,
        projectName: connection.projectName,
      });
    }
    const credentialBinding = profile && setup.token && !hasFlag(args, '--no-register')
      ? (connection?.connected
        ? ensureOpenScienceCredential(setup.token, report, openScienceCommand, ensureOpenScienceDaemon, projectTokenCredentialName(profile.name))
        : { configured: false, reason: `project-token-validation-failed:${connection?.code || 'unknown'}` })
      : null;
    if (profile && credentialBinding?.configured) {
      profile = updateProfile(profile.name, {
        credentialId: credentialBinding.credentialId,
        credentialFingerprint: tokenFingerprint(setup.token),
      });
    }
    const runtimePackageRoot = profile && !hasFlag(args, '--no-register')
      ? ensureRuntime(packageRoot).packageRoot
      : null;
    const registration = profile && hasCredential && !hasFlag(args, '--no-register')
      ? (credentialBinding?.configured || profile.credentialId
        ? registerConnector(profile, report, openScienceCommand, ensureOpenScienceDaemon, runtimePackageRoot)
        : { registered: false, reason: credentialBinding?.reason || 'credential-binding-missing' })
      : null;
    const configRegistration = profile && !hasFlag(args, '--no-register')
      ? (!setup.token || credentialBinding?.configured
        ? registerConfigConnector(credentialBinding?.credentialId || profile?.credentialId, report, openScienceCommand, ensureOpenScienceDaemon, runtimePackageRoot)
        : { registered: false, reason: credentialBinding?.reason || 'credential-binding-missing' })
      : null;
    const value = {
      command: 'setup',
      mode: profile && hasCredential ? 'configured' : 'installed',
      ...report,
      profile: profile || null,
      connector: profile && hasCredential && runtimePackageRoot ? connectorConfig(profile, runtimePackageRoot) : null,
      connection,
      credentialBinding,
      registration,
      configRegistration,
      skill,
      nextSteps: [
        'Import slr in Open-Science: Settings > Skills > Add skill > Import installed skills; select slr and import it.',
        'Open a new conversation after importing the skill.',
        ...(hasCredential
          ? ['Run /slr setup before reviewing a paper.', 'Assign a paper in the SLR web application, then run /slr tasks or /slr review next.']
          : ['Run /slr config token <TOKEN> to bind the project credential and enable the review connector.']),
      ],
    };
    const connectorsReady = hasCredential
      ? registration?.registered === true && registration?.enabled === true
        && configRegistration?.registered === true && configRegistration?.enabled === true
      : configRegistration?.registered === true && configRegistration?.enabled === true;
    if (!hasFlag(args, '--no-register') && !connectorsReady) process.exitCode = 1;
    if (!hasFlag(args, '--no-register') && !connectorsReady) {
      restoreProfileStore(profileStoreSnapshot, process.env);
      profile = null;
    } else if (connectorsReady && profile) {
      profile = useProfile(profile.name);
    }
    value.mode = profile && connectorsReady ? (hasCredential ? 'configured' : 'installed') : 'incomplete';
    value.profile = profile || null;
    value.connector = profile && hasCredential && runtimePackageRoot ? connectorConfig(profile, runtimePackageRoot) : null;
    if (asJson) printValue(value, true);
    else {
      printSetup(report, false, { profile, connection, credentialBinding, registration, configRegistration, skill, tokenConfigured: hasCredential });
    }
      return;
    } catch (error) {
      try { restoreProfileStore(profileStoreSnapshot, process.env); } catch { /* Preserve the original setup error. */ }
      throw error;
    }
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

  if (command === 'mcp') {
    runMcpCommand(args, asJson, report, packageRoot);
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

  if (command === 'uninstall' || command === 'remove') {
    runUninstallCommand(args, asJson);
    return;
  }

  throw new Error('unknown command; run slr help');
}
