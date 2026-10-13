import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const MARKER = '.slr-open-science-managed';

export function defaultSkillRoot() {
  return join(homedir(), '.agents', 'skills', 'slr');
}

export function installSkill(packageRoot, targetRoot = defaultSkillRoot()) {
  const sourceRoot = resolve(packageRoot, 'skill', 'slr');
  const sourceScripts = resolve(packageRoot, 'scripts');
  const target = resolve(targetRoot);
  if (!existsSync(resolve(sourceRoot, 'SKILL.md'))) {
    throw new Error('package skill asset is missing');
  }
  const marker = resolve(target, MARKER);
  const existed = existsSync(target);
  if (existed && !existsSync(marker)) {
    throw new Error(`skill target already exists and is not managed by SLR: ${target}`);
  }
  mkdirSync(resolve(target, '..'), { recursive: true, mode: 0o700 });
  cpSync(sourceRoot, target, { recursive: true, force: true });
  if (existsSync(sourceScripts)) cpSync(sourceScripts, resolve(target, 'scripts'), { recursive: true, force: true });
  writeFileSync(marker, 'Managed by slr_skill_open_science.\n', { encoding: 'utf8', mode: 0o600 });
  return { status: existed ? 'updated' : 'installed', path: target };
}

export function removeManagedSkill(targetRoot = defaultSkillRoot()) {
  const target = resolve(targetRoot);
  const marker = resolve(target, MARKER);
  if (!existsSync(target)) return { status: 'missing', path: target };
  if (!existsSync(marker)) {
    throw new Error(`skill target exists and is not managed by SLR: ${target}`);
  }
  rmSync(target, { recursive: true, force: true });
  return { status: 'removed', path: target };
}
