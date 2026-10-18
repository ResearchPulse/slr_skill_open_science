#!/usr/bin/env node
/*
 * slr-skill-open-science — installer for the /slr skill and its MCP connector in Open-Science.
 *
 *   npx github:<user>/<repo>                 interactive install
 *   npx github:<user>/<repo> install --url https://host/api --token XXX -y
 *   npx github:<user>/<repo> mcp             print the connector config only
 *   npx github:<user>/<repo> doctor          check python / skill / connector / connection
 *   npx github:<user>/<repo> uninstall       remove skill + connector
 *
 * No npm dependencies. Needs Python 3.8+ (the skill is stdlib-only) and, for automatic
 * connector registration, the Open-Science command-line tool (`open-science`).
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { spawnSync } = require('child_process');

const PKG_ROOT = path.resolve(__dirname, '..');
const PKG = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8'));
const SKILL_NAME = 'slr';
const CONNECTOR_NAME = 'slr';
const SKILL_ENTRIES = ['SKILL.md', 'scripts', 'AI_AGENT_TASK_API_CONTRACT.md'];
const STALE_ENTRIES = ['references']; // inlined into SKILL.md
const HOME = os.homedir();
const IS_WIN = process.platform === 'win32';
const DEFAULT_URL = 'https://slr-agent.hyperdatalab.org/api';
const SKILLS_ROOT = path.join(HOME, '.agents', 'skills'); // Open-Science "Import installed skills"
const CONF_DIR = process.env.REVIEW_CONFIG_DIR || path.join(HOME, '.config', 'slr-open-science');
// Left behind by the previous two-connector package; replaced on install.
const LEGACY_MARKER = '.slr-open-science-managed';
const LEGACY_CONNECTORS = /^slr-/;
const LEGACY_SCRIPTS = /slr_mcp\.py|slr_config_mcp\.py|install\.js|slr-agent-mcp|slr-config-mcp/;

// ------------------------------------------------------------------ output

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const c = { bold: paint(1), dim: paint(2), red: paint(31), green: paint(32), yellow: paint(33), cyan: paint(36) };
const ok = (m) => console.log(`${c.green('✔')} ${m}`);
const warn = (m) => console.log(`${c.yellow('!')} ${m}`);
const fail = (m) => console.log(`${c.red('✖')} ${m}`);
const info = (m) => console.log(`${c.cyan('›')} ${m}`);
const step = (m) => console.log(`\n${c.bold(m)}`);

// ------------------------------------------------------------------ args

function parseArgs(argv) {
  const opts = { cmd: 'install', yes: false };
  const flags = {
    '--url': 'url', '--token': 'token', '--profile': 'profile', '--target': 'target',
    '--python': 'python', '--open-science': 'osCli',
  };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i];
    let val;
    if (a.startsWith('--') && a.includes('=')) [a, val] = [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)];
    if (flags[a]) {
      opts[flags[a]] = val !== undefined ? val : argv[++i];
      if (opts[flags[a]] === undefined) die(`Missing value for ${a}`);
    } else if (a === '-y' || a === '--yes') opts.yes = true;
    else if (a === '--purge') opts.purge = true;
    else if (a === '--no-mcp') opts.noMcp = true;
    else if (a === '-h' || a === '--help') opts.cmd = 'help';
    else if (a === '-v' || a === '--version') opts.cmd = 'version';
    else if (a.startsWith('-')) die(`Unknown option ${a} (see --help)`);
    else rest.push(a);
  }
  if (rest[0]) opts.cmd = rest[0];
  if (!opts.token && process.env.SLR_TOKEN) opts.token = process.env.SLR_TOKEN;
  if (!opts.url && process.env.SLR_API_URL) opts.url = process.env.SLR_API_URL;
  return opts;
}

function die(msg) {
  fail(msg);
  process.exit(1);
}

const HELP = `
${c.bold('slr-skill-open-science')} v${PKG.version} — install the /slr skill and its MCP connector for Open-Science

${c.bold('Usage')}
  npx github:${repoSlug()} [command] [options]

${c.bold('Commands')}
  install     (default) copy the skill, configure URL/token, register the "slr" connector
  mcp         print the connector command/arguments (for adding it by hand)
  doctor      check Python, skill files, open-science CLI, connector and API connection
  uninstall   remove the skill folder and connector (--purge also deletes saved URLs/tokens)

${c.bold('Options')}
  --url <url>          API base URL (default ${DEFAULT_URL})   (env SLR_API_URL)
  --token <tok>        agent token from My AI review workspace         (env SLR_TOKEN)
  --profile <p>        store URL/token under this profile and make it active (one per project)
  --target <dir>       skills folder to install into (default ~/.agents/skills)
  --no-mcp             do not register the connector
  --open-science <cmd> path to the open-science CLI (default: PATH, then the app's bin folder)
  --python <cmd>       Python 3 interpreter to use (default: auto-detect py / python3 / python)
  -y, --yes            non-interactive: never prompt, skip anything not given by flags
  -h, --help           show this help
`;

// ------------------------------------------------------------------ prompts

const interactive = (opts) => !opts.yes && process.stdin.isTTY && process.stdout.isTTY;

function ask(question, { hidden = false, def = '' } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const suffix = def ? c.dim(` [${def}]`) : '';
    if (hidden) {
      rl._writeToOutput = function (s) {
        if (s.includes(question)) rl.output.write(s);
        else if (s === '\r\n' || s === '\n' || s === '\r') rl.output.write('\n');
        else rl.output.write('*'.repeat(s.length));
      };
    }
    rl.question(`${c.cyan('?')} ${question}${suffix} `, (ans) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(ans.trim() || def);
    });
  });
}

async function confirm(question, opts, def = true) {
  if (!interactive(opts)) return def;
  const ans = (await ask(`${question} ${c.dim(def ? '(Y/n)' : '(y/N)')}`)).toLowerCase();
  if (!ans) return def;
  return ans.startsWith('y') || ans.startsWith('c'); // "c" = "có"
}

// ------------------------------------------------------------------ python

function findPython(opts) {
  const probe = 'import sys;print(sys.version_info[0],sys.version_info[1]);print(sys.executable)';
  const candidates = opts.python
    ? [opts.python.split(' ')]
    : IS_WIN ? [['py', '-3'], ['python'], ['python3']] : [['python3'], ['python']];
  for (const [cmd, ...pre] of candidates) {
    const r = spawnSync(cmd, [...pre, '-c', probe], { encoding: 'utf8', windowsHide: true });
    if (r.status !== 0 || !r.stdout) continue;
    const [verLine, exe] = r.stdout.trim().split(/\r?\n/);
    const [major, minor] = verLine.split(' ').map(Number);
    if (major === 3 && minor >= 8 && exe) return { exe: exe.trim(), version: `${major}.${minor}` };
  }
  return null;
}

function runPy(py, script, args, input) {
  const r = spawnSync(py.exe, [script, ...args], {
    encoding: 'utf8', input, windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch (_) { /* not JSON */ }
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', json };
}

// ------------------------------------------------------------------ skill files

function skillDir(opts) {
  if (!opts.target) return path.join(SKILLS_ROOT, SKILL_NAME);
  const dir = path.resolve(opts.target.replace(/^~(?=$|[\\/])/, HOME));
  return path.basename(dir) === SKILL_NAME ? dir : path.join(dir, SKILL_NAME);
}

function copySkill(dir) {
  if (fs.existsSync(path.join(dir, LEGACY_MARKER))) {
    fs.rmSync(dir, { recursive: true, force: true }); // previous package's layout
    info('Replaced the skill installed by the previous slr_skill_open_science version');
  }
  fs.mkdirSync(dir, { recursive: true });
  for (const entry of STALE_ENTRIES) fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
  for (const entry of SKILL_ENTRIES) {
    const dst = path.join(dir, entry);
    fs.rmSync(dst, { recursive: true, force: true });
    fs.cpSync(path.join(PKG_ROOT, entry), dst, {
      recursive: true,
      filter: (src) => !/__pycache__|\.pyc$/.test(src),
    });
  }
}

// ------------------------------------------------------------------ open-science CLI

function osCandidates(opts) {
  if (opts.osCli) return [opts.osCli];
  const list = [];
  if (process.env.OPEN_SCIENCE_CLI) list.push(process.env.OPEN_SCIENCE_CLI);
  list.push('open-science');
  if (IS_WIN) {
    const appData = process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming');
    list.push(path.join(appData, 'Open-Science', 'bin', 'open-science.cmd'));
  } else {
    list.push(path.join(HOME, '.local', 'bin', 'open-science'), '/usr/local/bin/open-science');
  }
  return list;
}

function spawnOs(exe, args, input) {
  // A Windows .cmd launcher (and a bare name resolving to one) must run through the shell.
  const shell = IS_WIN && !/\.exe$/i.test(exe);
  const quote = (a) => (/[\s"&|<>^()]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a);
  const o = { encoding: 'utf8', input, windowsHide: true, timeout: 60000 };
  return shell
    ? spawnSync([exe, ...args].map(quote).join(' '), { ...o, shell: true })
    : spawnSync(exe, args, o);
}

function findOpenScience(opts) {
  for (const exe of osCandidates(opts)) {
    if (path.isAbsolute(exe) && !fs.existsSync(exe)) continue;
    const r = spawnOs(exe, ['--help']);
    if (!r.error && /open-science/i.test(`${r.stdout}${r.stderr}`)) return exe;
  }
  return null;
}

function osJson(exe, args, input) {
  const r = spawnOs(exe, [...args, '--json'], input);
  let json = null;
  try { json = JSON.parse((r.stdout || '').trim()); } catch (_) { /* not JSON */ }
  const err = (json && json.error) || null;
  return { ok: r.status === 0 && !err, status: r.status, json, err, text: `${r.stdout || ''}${r.stderr || ''}`.trim() };
}

const isDaemonDown = (r) => r.status === 3 || /daemon_unavailable|not running/i.test(r.text);

function ensureDaemon(exe) {
  let r = osJson(exe, ['connector', 'list']);
  if (r.ok || !isDaemonDown(r)) return r;
  info('Open-Science is not running — starting it in the background (open-science start --no-open)');
  spawnOs(exe, ['start', '--no-open']);
  const until = Date.now() + 45000;
  while (Date.now() < until) {
    r = osJson(exe, ['connector', 'list']);
    if (r.ok || !isDaemonDown(r)) return r;
    spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},1500)']);
  }
  return r;
}

function connectorRecords(json) {
  if (Array.isArray(json)) return json;
  if (json && typeof json === 'object') {
    // Open-Science returns built-in catalog connectors under `connectors` and
    // user-managed stdio connectors under `customServers`. Prefer the latter
    // so install/update/remove can see the existing `slr` connector and clean
    // legacy `slr-*` registrations instead of attempting a duplicate add.
    for (const k of ['customServers', 'items', 'data', 'servers', 'connectors']) {
      if (Array.isArray(json[k])) return json[k];
    }
  }
  return [];
}

const recordId = (rec) => rec && (rec.id || rec.connectorId || rec.name);
const resultId = (json) => json && (json.id || json.connectorId || (json.connector && json.connector.id)
  || (json.createdConnector && json.createdConnector.id));

function connectorConfig(py, scriptsDir) {
  return {
    name: CONNECTOR_NAME,
    displayName: 'SLR Review',
    description: 'Systematic literature review screening: tasks, full text, votes and /slr config (Agent Task API).',
    transport: 'stdio',
    command: py.exe,
    args: [path.join(scriptsDir, 'slr_mcp.py')],
  };
}

function registerConnector(exe, config) {
  const listed = ensureDaemon(exe);
  if (!listed.ok) throw new Error(`open-science connector list failed: ${(listed.err && listed.err.message) || listed.text}`);
  const records = connectorRecords(listed.json);

  // Remove connectors left by the previous two-connector package (slr-config, slr-default, …).
  for (const rec of records) {
    const blob = JSON.stringify([rec.command, rec.args]);
    if (LEGACY_CONNECTORS.test(rec.name || '') && LEGACY_SCRIPTS.test(blob)) {
      const r = osJson(exe, ['connector', 'remove', recordId(rec)]);
      if (r.ok) info(`Removed old connector "${rec.name}"`); else warn(`Could not remove old connector "${rec.name}": ${r.text}`);
    }
  }

  const existing = records.find((r) => r.name === CONNECTOR_NAME);
  let id;
  if (existing) {
    id = recordId(existing);
    const r = osJson(exe, ['connector', 'update', id], JSON.stringify({ ...config, name: undefined, env: {}, envCredentialIds: {} }));
    if (!r.ok) throw new Error(`connector update failed: ${(r.err && r.err.message) || r.text}`);
  } else {
    const r = osJson(exe, ['connector', 'add'], JSON.stringify(config));
    if (!r.ok) throw new Error(`connector add failed: ${(r.err && r.err.message) || r.text}`);
    id = resultId(r.json);
    if (!id) id = recordId(connectorRecords(osJson(exe, ['connector', 'list']).json).find((x) => x.name === CONNECTOR_NAME));
  }
  if (!id) throw new Error('connector was saved but its id could not be read back');
  const en = osJson(exe, ['connector', 'enable', id]);
  if (!en.ok) throw new Error(`connector enable failed: ${(en.err && en.err.message) || en.text}`);
  const test = osJson(exe, ['connector', 'test', id]);
  return { id, updated: Boolean(existing), test: test.json || { success: false, message: test.text } };
}

function printManual(config) {
  console.log(c.dim('─'.repeat(60)));
  console.log(`Name:       ${config.name}`);
  console.log(`Transport:  stdio (local)`);
  console.log(`Command:    ${config.command}`);
  console.log(`Arguments:  ${config.args.join(' ')}`);
  console.log(c.dim('─'.repeat(60)));
  console.log(c.dim('As JSON (open-science connector add --json < file):'));
  console.log(JSON.stringify(config, null, 2));
}

// ------------------------------------------------------------------ profile helpers

function readProfile(py, slrPy, profile) {
  const r = runPy(py, slrPy, ['config', 'show']);
  if (!r.json || !r.json.profiles) return {};
  const want = profile || (r.json.profiles.find((p) => p.active) || {}).profile;
  return r.json.profiles.find((p) => p.profile === want) || {};
}

const profileArgs = (opts) => (opts.profile ? ['--profile', opts.profile] : []);

// ------------------------------------------------------------------ commands

async function cmdInstall(opts) {
  console.log(c.bold(`\n/slr skill installer for Open-Science v${PKG.version}`));

  step('1. Python');
  const py = findPython(opts);
  if (!py) {
    die('Python 3.8+ not found. Install it from https://www.python.org/downloads/ '
      + '(Windows: tick "Add python.exe to PATH"), or pass --python <path>.');
  }
  ok(`Python ${py.version} — ${py.exe}`);

  step('2. Skill files');
  const dir = skillDir(opts);
  copySkill(dir);
  ok(`Skill: ${dir}`);
  const scriptsDir = path.join(dir, 'scripts');
  const slrPy = path.join(scriptsDir, 'slr.py');

  step('3. API server & agent token');
  const current = readProfile(py, slrPy, opts.profile);
  let url = opts.url;
  if (!url && interactive(opts)) {
    url = await ask('API base URL:', { def: current.api_base_url || DEFAULT_URL });
  }
  url = url || current.api_base_url || DEFAULT_URL;
  if (url !== current.api_base_url) {
    const r = runPy(py, slrPy, ['config', 'set-url', url, ...profileArgs(opts)]);
    if (r.json && r.json.ok) { url = r.json.api_base_url; ok(`URL saved: ${url} (profile ${r.json.profile})`); }
    else { fail(`Could not save URL: ${(r.json && r.json.message) || r.stderr.trim()}`); url = current.api_base_url; }
  } else ok(`URL: ${url}`);
  if (opts.profile) runPy(py, slrPy, ['config', 'use', opts.profile]);

  let token = opts.token;
  const hasToken = current.token && current.token !== 'missing';
  if (!token && interactive(opts)) {
    const q = hasToken ? `Agent token (Enter to keep current ${current.token}):` : 'Agent token (input hidden, Enter to skip):';
    token = await ask(q, { hidden: true });
  }
  if (token) {
    const r = runPy(py, slrPy, ['config', 'set-token', '--stdin', ...profileArgs(opts)], token);
    if (r.json && r.json.ok) {
      ok(`Token saved: ${r.json.token} (profile ${r.json.profile})`);
      if (r.json.connected === true) ok(`Connected — project "${r.json.project}", ${r.json.assigned} assigned / ${r.json.completed} completed`);
      else if (r.json.connected === false) warn(`Saved, but connection test failed: ${JSON.stringify(r.json.error)}`);
    } else fail(`Could not save token: ${(r.json && r.json.message) || r.stderr.trim()}`);
  } else if (hasToken) {
    ok(`Token: ${current.token}`);
    const t = runPy(py, slrPy, ['config', 'test', ...profileArgs(opts)]);
    if (t.json && t.json.connected) ok(`Connected — project "${t.json.project}", ${t.json.assigned} assigned`);
    else warn(`Connection test failed: ${JSON.stringify((t.json && t.json.error) || t.stderr.trim())}`);
  } else warn('No token yet — in chat use /slr config token <TOKEN>, or re-run with --token');

  step('4. MCP connector');
  const config = connectorConfig(py, scriptsDir);
  if (opts.noMcp) info('Skipped (--no-mcp).');
  else {
    const exe = findOpenScience(opts);
    if (!exe) {
      warn('open-science CLI not found. Install it in the app: Settings → General → Command line tool,');
      warn('open a new terminal and re-run this installer — or add the connector by hand:');
      printManual(config);
    } else {
      try {
        const r = registerConnector(exe, config);
        ok(`Connector "${CONNECTOR_NAME}" ${r.updated ? 'updated' : 'added'} and enabled (id ${r.id})`);
        if (r.test.success) ok(`Connector test: ${r.test.toolCount || '?'} tools discovered`);
        else warn(`Connector test: ${r.test.message || JSON.stringify(r.test)}`);
      } catch (e) {
        fail(e.message);
        info('Add the connector by hand in Settings → Connectors instead:');
        printManual(config);
        process.exitCode = 1;
      }
    }
  }

  step('Done — in Open-Science:');
  console.log(`  1. Settings → Skills → Add skill → ${c.bold('Import installed skills')} → select ${c.bold('slr')} → Import selected (enable it).`);
  console.log(`  2. Open a ${c.bold('new conversation')} and type ${c.bold('/slr setup')}.`);
  console.log(`  Check everything any time:  ${c.bold(`npx github:${repoSlug()} doctor`)}\n`);
}

function cmdMcp(opts) {
  const py = findPython(opts) || die('Python 3.8+ not found (use --python).');
  const dir = skillDir(opts);
  if (!fs.existsSync(path.join(dir, 'SKILL.md'))) warn(`Skill not installed yet — run install first. Path below assumes ${dir}`);
  info('Settings → Connectors → add a custom local (stdio) connector with:');
  printManual(connectorConfig(py, path.join(dir, 'scripts')));
}

function cmdDoctor(opts) {
  let bad = 0;
  step('Python');
  const py = findPython(opts);
  if (py) ok(`Python ${py.version} — ${py.exe}`); else { fail('Python 3.8+ not found'); bad++; }

  step('Skill');
  const dir = skillDir(opts);
  const installed = fs.existsSync(path.join(dir, 'SKILL.md'));
  if (installed) ok(dir); else { fail(`Skill not installed at ${dir} (run install)`); bad++; }
  if (installed) info('Open-Science uses its imported copy: Settings → Skills → Import installed skills → slr');

  step('Open-Science connector');
  const exe = findOpenScience(opts);
  if (!exe) { warn('open-science CLI not found — cannot check the connector (Settings → General → Command line tool)'); bad++; }
  else {
    ok(`CLI: ${exe}`);
    const listed = osJson(exe, ['connector', 'list']);
    if (!listed.ok) { warn(isDaemonDown(listed) ? 'Open-Science is not running (open-science start --no-open)' : listed.text); bad++; }
    else {
      const rec = connectorRecords(listed.json).find((r) => r.name === CONNECTOR_NAME);
      if (!rec) { fail(`Connector "${CONNECTOR_NAME}" not registered (run install)`); bad++; }
      else {
        const args = JSON.stringify(rec.args || []);
        (rec.enabled === false ? warn : ok)(`Connector "${CONNECTOR_NAME}" ${rec.enabled === false ? 'is DISABLED' : 'registered'} — ${rec.command || ''} ${args}`);
        if (rec.enabled === false) bad++;
        const t = osJson(exe, ['connector', 'test', recordId(rec)]);
        if (t.json && t.json.success) ok(`Connector test: ${t.json.toolCount || '?'} tools`);
        else { fail(`Connector test failed: ${(t.json && t.json.message) || t.text}`); bad++; }
      }
      const legacy = connectorRecords(listed.json).filter((r) => LEGACY_CONNECTORS.test(r.name || '') && LEGACY_SCRIPTS.test(JSON.stringify([r.command, r.args])));
      if (legacy.length) warn(`Old connectors still present: ${legacy.map((r) => r.name).join(', ')} — re-run install to remove them`);
    }
  }

  if (py && installed) {
    const scripts = path.join(dir, 'scripts');
    step('MCP server handshake');
    const init = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
    const list = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const r = runPy(py, path.join(scripts, 'slr_mcp.py'), [], `${init}\n${list}\n`);
    const tools = (r.stdout.trim().split(/\r?\n/).map((l) => { try { return JSON.parse(l); } catch (_) { return {}; } })
      .find((m) => m.id === 2) || {}).result;
    if (tools && tools.tools) ok(`slr_mcp.py answers — tools: ${tools.tools.map((t) => t.name).join(', ')}`);
    else { fail(`slr_mcp.py did not answer: ${r.stderr.trim().split('\n').pop()}`); bad++; }

    step('API connection');
    const t = runPy(py, path.join(scripts, 'slr.py'), ['config', 'test', ...profileArgs(opts)]);
    if (t.json && t.json.connected) ok(`profile ${t.json.profile}: project "${t.json.project}", ${t.json.assigned} assigned / ${t.json.completed} completed`);
    else { warn(`not connected: ${JSON.stringify((t.json && (t.json.error || t.json)) || t.stderr.trim())}`); bad++; }
  }
  console.log();
  if (bad) { fail(`${bad} problem(s) found`); process.exitCode = 1; } else ok('All good');
}

async function cmdUninstall(opts) {
  const dir = skillDir(opts);
  if (!(await confirm(`Remove /slr skill (${dir}) and the "${CONNECTOR_NAME}" connector?`, opts))) return;
  if (fs.existsSync(dir)) { fs.rmSync(dir, { recursive: true, force: true }); ok(`Removed ${dir}`); }
  const exe = findOpenScience(opts);
  if (exe) {
    const listed = osJson(exe, ['connector', 'list']);
    const rec = connectorRecords(listed.json).find((r) => r.name === CONNECTOR_NAME);
    if (rec) {
      const r = osJson(exe, ['connector', 'remove', recordId(rec)]);
      if (r.ok) ok(`Connector "${CONNECTOR_NAME}" removed`); else warn(`Could not remove connector: ${r.text}`);
    } else if (!listed.ok) warn('Open-Science not running — remove the "slr" connector in Settings → Connectors');
  } else info('Remove the "slr" connector in Settings → Connectors if you added it.');
  info('Also remove the imported skill in Settings → Skills.');
  if (opts.purge) {
    fs.rmSync(CONF_DIR, { recursive: true, force: true });
    ok(`Removed saved URLs/tokens: ${CONF_DIR}`);
  } else info(`Saved URLs/tokens kept in ${CONF_DIR} (use --purge to delete)`);
}

function repoSlug() {
  const m = ((PKG.repository && PKG.repository.url) || '').match(/github\.com[/:]([^/]+\/[^/.]+)/);
  return m ? m[1] : '<user>/<repo>';
}

// ------------------------------------------------------------------ main

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  switch (opts.cmd) {
    case 'install': case 'update': case 'setup': return cmdInstall(opts);
    case 'mcp': return cmdMcp(opts);
    case 'doctor': return cmdDoctor(opts);
    case 'uninstall': case 'remove': return cmdUninstall(opts);
    case 'version': return console.log(PKG.version);
    case 'help': return console.log(HELP);
    default: die(`Unknown command "${opts.cmd}" (see --help)`);
  }
}

main().catch((e) => die(e.stack || e.message));
