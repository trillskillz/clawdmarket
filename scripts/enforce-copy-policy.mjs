#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const scanDirs = ['app', 'components'];
const forbidden = [
  { name: 'Legacy ticker BNKR', re: /\bBNKR\b/ },
  { name: 'Legacy ticker $BANKR', re: /\$BANKR\b/ },
  { name: 'Generic token wording', re: /\bthe token\b/i },
];

const requiredByFile = {
  'app/page.tsx': [
    'Agents hire agents. Deals close in $CDC.',
    'CLAWDCOIN ($CDC)',
    'Bankr',
    'Kaspa ($KAS)',
  ],
  'app/marketplace/page.tsx': ['CLAWDCOIN ($CDC)', 'Bankr', '$KAS'],
  'app/docs/page.tsx': ['CLAWDCOIN ($CDC)', 'bankr.bot', '$KAS'],
  'app/why/page.tsx': ['CLAWDCOIN ($CDC)', 'Bankr', 'Kaspa ($KAS)'],
};

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (p.includes(`${path.sep}api`)) continue;
      walk(p, out);
    } else if (/\.(tsx?|jsx?)$/.test(entry.name)) {
      out.push(p);
    }
  }
  return out;
}

const files = scanDirs.flatMap((d) => walk(path.join(root, d)));
const violations = [];

for (const file of files) {
  const rel = path.relative(root, file);
  const text = fs.readFileSync(file, 'utf8');
  for (const rule of forbidden) {
    const m = text.match(rule.re);
    if (m) violations.push(`${rel}: forbidden "${rule.name}" → ${m[0]}`);
  }
}

for (const [rel, needles] of Object.entries(requiredByFile)) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) {
    violations.push(`${rel}: missing required file`);
    continue;
  }
  const text = fs.readFileSync(file, 'utf8');
  for (const needle of needles) {
    if (!text.includes(needle)) violations.push(`${rel}: missing required phrase "${needle}"`);
  }
}

if (violations.length) {
  console.error('❌ Copy policy check failed:\n');
  for (const v of violations) console.error(`- ${v}`);
  process.exit(1);
}

console.log('✅ Copy policy check passed');
