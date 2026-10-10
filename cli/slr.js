import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createProfile,
  getActiveProfile,
  getProfile,
  listProfiles,
  removeProfile,
  updateProfile,
  useProfile,
} from './profile-store.js';
import { installSkill } from './skill-store.js';
import { initializeWorkspace, listAudit, listDrafts } from './workspace.js';

const DEFAULT_COMMAND = 'help';
const CREDENTIAL_OPTION_PREFIXES = ['--token', '--agent-token', '--api-key', '--password', '--secret'];

function hasFlag(args, flag) {
  return args.includes(flag);
}

function flagValue(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
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
    args: ['--yes', 'github:ResearchPulse/slr_skill_open_science#v0.1.0', '--mcp'],
    env: {
      SLR_API_BASE_URL: profile.apiBaseUrl,
      SLR_PROFILE_ID: profile.name,
      ...(profile.projectId ? { SLR_PROJECT_ID: profile.projectId } : {}),
      ...(profile.projectName ? { SLR_PROJECT_NAME: profile.projectName } : {}),
    },
    envCredentialIds: profile.credentialId ? { SLR_AGENT_TOKEN: profile.credentialId } : {},
    requiredCredentialEnvironment: ['SLR_AGENT_TOKEN'],
    note: 'Bind SLR_AGENT_TOKEN to an Open-Science credential. This configuration contains no secret value.',
  };
}

function registerConnector(profile, report) {
  if (!profile.credentialId) throw new Error('connector registration requires --credential-id for an existing Open-Science credential');
  if (!report.openScienceCli.available || !report.openScienceCli.executable) {
    throw new Error('Open-Science CLI was not detected; use `slr config` and import the generated JSON manually');
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
    throw new Error('Open-Science connector registration failed; use `slr config` for manual import');
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
  setup     Create/inspect a profile and show connector setup
  profile   Manage project profiles (create, list, use, inspect, remove)
  workspace Initialize or inspect the local review workspace
  skill     Install or update the /slr skill for Open-Science import
  config    Print a secret-free Open-Science connector configuration
  doctor    Check package assets, profiles, and Open-Science CLI availability
  update    Show update guidance without changing existing profiles
  help      Show this help

Internal:
  --mcp     Start the local MCP stdio server with the current environment

Setup flags:
  --profile NAME --api-base-url URL --project-id ID --credential-id ID
  --workspace   initialize paper-review/ for the selected profile
  --skill-dir PATH  override the local skill import directory
  --register   register the secret-free connector through the Open-Science CLI

The installer never asks for or prints the project token. Configure credentials
through the Open-Science connector or a protected runtime environment.`);
}

function printSetup(report, asJson) {
  if (asJson) {
    console.log(JSON.stringify({
      command: 'setup',
      mode: 'preview',
      ...report,
      nextSteps: [
        'Create or select an SLR project agent connection in the SLR web UI.',
        'Create an Open-Science token credential and bind it to SLR_AGENT_TOKEN.',
        'Import the secret-free connector configuration and enable the /slr skill.',
      ],
    }, null, 2));
    return;
  }

  console.log('SLR Open-Science setup preview');
  console.log(`Package root: ${report.packageRoot}`);
  console.log(`Open-Science CLI: ${report.openScienceCli.available ? 'detected' : 'not detected'}`);
  console.log('');
  console.log('Next steps:');
  console.log('1. Connect the ChatGPT/Open-Science agent to the SLR project in the SLR web UI.');
  console.log('2. Create an Open-Science token credential and bind it to SLR_AGENT_TOKEN.');
  console.log('3. Import the secret-free connector configuration and enable the /slr skill.');
  console.log('');
  console.log('The project token is never requested or printed by this command.');
}

function runProfileCommand(args, asJson) {
  const subcommand = args.find(arg => !arg.startsWith('--') && arg !== 'profile') || 'list';
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
  const subcommand = args.find(arg => !arg.startsWith('--') && arg !== 'workspace') || 'init';
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
  const subcommand = args.find(arg => !arg.startsWith('--') && arg !== 'skill') || 'install';
  if (subcommand !== 'install') throw new Error('unknown skill command; use install');
  printValue(installSkill(packageRoot, flagValue(args, '--skill-dir')), asJson);
}

export async function main(args = process.argv.slice(2), options = {}) {
  rejectCredentialArguments(args);
  const packageRoot = options.packageRoot || resolve(fileURLToPath(new URL('..', import.meta.url)));
  const command = args.find(arg => !arg.startsWith('--')) || DEFAULT_COMMAND;
  const asJson = hasFlag(args, '--json');
  const report = inspectPackage(packageRoot);

  if (command === 'help' || command === '--help') {
    printHelp();
    return;
  }

  if (command === 'setup') {
    const options = profileOptions(args);
    let profile = options.name ? (() => {
      try { return getProfile(options.name); } catch (error) {
        if (!options.apiBaseUrl) throw error;
        return createProfile(options);
      }
    })() : getActiveProfile();
    if (profile && options.apiBaseUrl && options.name) {
      profile = updateProfile(options.name, options);
    }
    const skill = installSkill(packageRoot, flagValue(args, '--skill-dir'));
    if (profile && hasFlag(args, '--workspace')) initializeWorkspace(profile);
    const registration = profile && hasFlag(args, '--register') ? registerConnector(profile, report) : null;
    const value = {
      command: 'setup',
      mode: profile ? 'configured' : 'preview',
      ...report,
      profile: profile || null,
      connector: profile ? connectorConfig(profile) : null,
      registration,
      skill,
      nextSteps: [
        'Connect the ChatGPT/Open-Science agent to the SLR project in the SLR web UI.',
        'Create an Open-Science token credential and bind it to SLR_AGENT_TOKEN.',
        'Import the secret-free connector configuration and enable the /slr skill.',
        'Run /slr status before reviewing a paper.',
      ],
    };
    if (asJson) printValue(value, true);
    else {
      printSetup(report, false);
      console.log(`Skill: ${skill.status} at ${skill.path}`);
      if (profile) {
        console.log('');
        console.log(`Profile: ${profile.name}`);
        console.log('Run `slr config --profile <name>` to print the connector configuration.');
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
    console.log('Update is non-destructive. Re-run the pinned package reference, then review the generated setup preview before changing connector state.');
    return;
  }

  throw new Error('unknown command; run slr help');
}
