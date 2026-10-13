import { existsSync } from 'node:fs';

const required = [
  'bin/install.js',
  'skill/slr/SKILL.md',
  'scripts/slr.py',
  'scripts/slr_mcp.py',
  'scripts/slr_config_mcp.py',
];

const missing = required.filter((path) => !existsSync(path));
if (missing.length) {
  console.error(`slr package is missing required runtime assets: ${missing.join(', ')}`);
  process.exitCode = 1;
}
