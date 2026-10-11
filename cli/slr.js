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
import { prepareProfile, testProfileConnection } from './setup.js';
import { initializeWorkspace, listAudit, listDrafts } from './workspace.js';

const DEFAULT_COMMAND = 'setup';
const CREDENTIAL_OPTION_PREFIXES = ['--token', '--agent-token', '--api-key', '--password', '--secret'];
const VALUE_FLAGS = new Set([
  '--profile', '--name', '--api-base-url', '--project-id', '--project-name',
  '--credential-id', '--connector-id', '--connector-name', '--skill-dir', '--limit',
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
    env: {
      SLR_API_BASE_URL: profile.apiBaseUrl,
      SLR_PROFILE_ID: profile.name,
      ...(profile.projectId ? { SLR_PROJECT_ID: profile.projectId } : {}),
      ...(profile.projectName ? { SLR_PROJECT_NAME: profile.projectName } : {}),
    },
    envCredentialIds: profile.credentialId ? { SLR_AGENT_TOKEN: profile.credentialId } : {},
  };
}

export function writeConnectorConfig(profile, environment = process.env) {
  const directory = join(configRootFor(environment), 'connectors');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const target = join(directory, `${profile.name}.json`);
  const temporary = `${target}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(connectorConfig(profile), null, 2)}\n`, {
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

function registerConnector(profile, report) {
  if (!report.openScienceCli.available || !report.openScienceCli.executable) {
    return { registered: false, reason: 'open-science-cli-not-detected' };
  }
  const result = spawnSync(report.openScienceCli.executable, ['connector', 'add', '--json'], {
    input: `${JSON.stringify(connectorConfig(profile))}\n`,
    encoding: 'utf8',
    shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(report.openScienceCli.executable),
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 15_000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    return { registered: false, reason: 'open-science-connector-registration-failed' };
  }
  return { registered: true, connector: profile.connectorName || `slr-${profile.name}` };
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

function detectOpenScienceCli() {
  const result = spawnSync(commandPath(), ['open-science'], {
    encoding: 'utf8',
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 2_000,
    windowsHide: true,
  });

  if (result.status !== 0 || result.error) {
    return { available: false };
  }

  const executable = result.stdout.trim().split(/\r?\n/)[0];
  return executable ? { available: true, executable } : { available: false };
}

function inspectPackage(packageRoot) {
  const assets = {
    skill: resolve(packageRoot, 'skill', 'slr', 'SKILL.md'),
    mcpEntrypoint: resolve(packageRoot, 'mcp', 'slr-agent-mcp', 'out', 'index.js'),
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

function printHelp() {
  console.log(`SLR Open-Science installer

Usage:
  npx github:ResearchPulse/slr_skill_open_science [command]

Commands:
  setup     Interactive setup: copy skill, save URL/token, test API, register MCP
  profile   Manage project profiles (create, list, use, inspect, remove)
  workspace Initialize or inspect the local review workspace
  skill     Install or update the /slr skill for Open-Science import
  config    Print a secret-free Open-Science connector configuration
  doctor    Check package assets, profiles, and Open-Science CLI availability
  update    Show update guidance without changing existing profiles
  help      Show this help

In-chat /slr commands (after the skill is imported):
  /slr help  Show the SLR command menu and confirmation rule
  /slr setup Run the read-only quick check via list_assigned_tasks(limit: 1)

The package command slr setup installs/prepares local assets and connector
configuration; it is different from the in-chat /slr setup check.

Internal:
  --mcp     Start the local MCP stdio server with the current environment

Setup flags:
  --profile NAME --api-base-url URL --project-id ID --credential-id ID
  --workspace   initialize paper-review/ for the selected profile
  --skill-dir PATH  override the local skill import directory
  --register   force connector registration (setup attempts it by default)
  --no-register skip connector registration

Credentials:
  Setup asks for the token with hidden terminal input and stores it in the
  selected local profile. Never paste the token into chat, CLI flags, source
  files, generated connector JSON, or logs; this help output contains no secret value.`);
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
      nextSteps: [
        'Import or start the generated connector and enable the /slr skill.',
        'Restart the connector after changing profiles or rotating the token.',
        'Run /slr setup in Open-Science to verify the read-only MCP connection.',
      ],
    }, null, 2));
    return;
  }

  console.log('SLR Open-Science setup preview');
  console.log(`Package root: ${report.packageRoot}`);
  console.log(`Open-Science CLI: ${report.openScienceCli.available ? 'detected' : 'not detected'}`);
  console.log('');
  console.log('Next steps:');
  if (setup.connection?.connected) {
    console.log(`API test: connected${setup.connection.projectName ? ` to ${setup.connection.projectName}` : ''}; assigned tasks: ${setup.connection.assignedTasks ?? 0}.`);
  } else if (setup.connection) {
    console.log(`API test: failed (${setup.connection.code || 'unknown'}). ${setup.connection.message || ''}`);
  } else {
    console.log('API test: not run because setup is non-interactive or incomplete.');
  }
  console.log(`Connector: ${setup.registration?.registered ? 'registered' : 'manual import required'}.`);
  if (setup.connectorConfigPath) console.log(`Manual connector config: ${setup.connectorConfigPath}`);
  console.log('1. Import/start the connector and enable the /slr skill.');
  console.log('2. Restart the connector after changing profiles or rotating the token.');
  console.log('3. Run /slr setup in Open-Science to verify the read-only MCP connection.');
  console.log('');
  console.log('The project token is never printed by this command.');
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
    const value = {
      command: 'setup',
      mode: profile && setup.token ? 'configured' : 'incomplete',
      ...report,
      profile: profile || null,
      connector: profile ? connectorConfig(profile) : null,
      connection,
      registration,
      connectorConfigPath,
      skill,
      nextSteps: [
        'Import/start the connector and enable the /slr skill.',
        'Restart the connector after changing profiles or rotating the token.',
        'Run /slr setup before reviewing a paper.',
      ],
    };
    if (asJson) printValue(value, true);
    else {
      printSetup(report, false, { profile, connection, registration, connectorConfigPath });
      console.log(`Skill: ${skill.status} at ${skill.path}`);
      if (profile) {
        console.log('');
        console.log(`Profile: ${profile.name}`);
        console.log(`Run 'slr config --profile ${profile.name}' to print the connector configuration.`);
      }
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
    printValue(connectorConfig(selectedProfile(args)), true);
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
