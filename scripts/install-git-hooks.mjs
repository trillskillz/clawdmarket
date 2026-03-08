#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const gitDir = path.join(root, '.git');
const hooksDir = path.join(gitDir, 'hooks');
const srcHook = path.join(root, 'scripts', 'git-hooks', 'pre-commit');
const dstHook = path.join(hooksDir, 'pre-commit');

if (!fs.existsSync(gitDir)) {
  console.error('❌ .git directory not found. Run from repo root.');
  process.exit(1);
}

if (!fs.existsSync(srcHook)) {
  console.error('❌ Source hook missing at scripts/git-hooks/pre-commit');
  process.exit(1);
}

fs.mkdirSync(hooksDir, { recursive: true });
fs.copyFileSync(srcHook, dstHook);
fs.chmodSync(dstHook, 0o755);

console.log('✅ Installed pre-commit hook');
