import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_COMMAND = 'help';
const CREDENTIAL_OPTION_PREFIXES = ['--token', '--agent-token', '--api-key', '--password', '--secret'];

function hasFlag(args, flag) {
  return args.includes(flag);
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
  npx github:<org>/slr_skill_open_science [command]

Commands:
  setup     Show safe setup preview and next steps
  doctor    Check package assets and Open-Science CLI availability
  update    Show update guidance without changing existing profiles
  help      Show this help

Internal:
  --mcp     Start the local MCP stdio server with the current environment

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
        'Bind the project credential through the Open-Science connector.',
        'Install/import the /slr skill after the connector integration phase is available.',
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
  console.log('2. Bind the project credential through the local Open-Science connector.');
  console.log('3. Import/install the /slr skill when connector setup is enabled.');
  console.log('');
  console.log('The project token is never requested or printed by this command.');
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
    printSetup(report, asJson);
    return;
  }

  if (command === 'doctor') {
    console.log(JSON.stringify({ command, ...report }, null, 2));
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
