import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { ESLint } from 'eslint'

const require = createRequire(import.meta.url)
const nextRequire = createRequire(require.resolve('eslint-config-next'))
const pluginEntry = nextRequire.resolve('@next/eslint-plugin-next')
const { getRootDirs } = nextRequire(join(dirname(pluginEntry), 'utils/get-root-dirs.js')) as {
  getRootDirs(context: { cwd: string, settings: { next?: { rootDir?: unknown } } }): string[]
}

test('patched Next root discovery retains directories, arrays, globs and symlinks without vulnerable imports', () => {
  const base = mkdtempSync(join(tmpdir(), 'clawdmarket-lint-roots-'))
  const roots = (rootDir?: unknown) => getRootDirs({ cwd: base, settings: { next: { rootDir } } }).sort()
  try {
    for (const name of ['web', 'docs', 'unused']) mkdirSync(join(base, name))
    writeFileSync(join(base, 'not-a-directory'), '')
    symlinkSync(join(base, 'web'), join(base, 'linked'), 'dir')
    assert.deepEqual(roots(), [base])
    assert.deepEqual(roots(join(base, 'web')), [join(base, 'web')])
    assert.deepEqual(roots(join(base, '{web,docs}')), ['docs', 'web'].map(x => join(base, x)))
    assert.deepEqual(roots(join(base, '+(web|docs)')), ['docs', 'web'].map(x => join(base, x)))
    assert.deepEqual(roots([join(base, 'web'), false, join(base, 'docs')]), ['docs', 'web'].map(x => join(base, x)))
    assert.deepEqual(roots(join(base, '*')), ['docs', 'linked', 'unused', 'web'].map(x => join(base, x)))
    assert.deepEqual(roots(join(base, 'missing')), [])
    assert.deepEqual(roots(join(base, 'not-a-directory')), [])
    assert.throws(() => roots('{'.repeat(17) + 'x' + '}'.repeat(17)), /nesting exceeds/)
    assert.throws(() => roots('a'.repeat(4097)), /4096/)
    const code = readFileSync(join(dirname(pluginEntry), 'utils/get-root-dirs.js'), 'utf8')
    assert.doesNotMatch(code, /require\(["'](?:fast-glob|micromatch|braces)["']\)/)
    const lock = readFileSync(new URL('../../pnpm-lock.yaml', import.meta.url), 'utf8')
    assert.doesNotMatch(lock, /^\s+(?:braces|micromatch|fast-glob)@/m)
  } finally { rmSync(base, { recursive: true, force: true }) }
})

test('security dependency removal retains Next, accessibility, hooks and TypeScript lint diagnostics', async () => {
  const eslint = new ESLint()
  const [result] = await eslint.lintText(`
    import { useState } from 'react';
    const unused: string = 'retained rule';
    export default function Page({ condition }: { condition: boolean }) {
      if (condition) useState(0);
      return <><img src="/photo.png" /><script src="/sync.js" /></>;
    }
  `, { filePath: 'app/security-lint-probe.tsx' })
  const rules = new Set(result.messages.map(message => message.ruleId))
  for (const id of ['@next/next/no-img-element', '@next/next/no-sync-scripts',
    'jsx-a11y/alt-text', 'react-hooks/rules-of-hooks', '@typescript-eslint/no-unused-vars']) {
    assert.ok(rules.has(id), `retained diagnostic: ${id}; got ${[...rules].join(', ')}`)
  }
})

test('dependency hook is scoped to the patched version and rejects upstream drift', () => {
  const { hooks } = require('../../.pnpmfile.cjs')
  const original = { name: '@next/eslint-plugin-next', version: '16.3.8', dependencies: { 'fast-glob': '3.3.1', keep: '1' } }
  assert.deepEqual(hooks.readPackage(original).dependencies, { keep: '1' })
  const unrelated = { name: 'other', version: '16.3.8', dependencies: { 'fast-glob': '3.3.1' } }
  assert.equal(hooks.readPackage(unrelated), unrelated)
  assert.equal(unrelated.dependencies['fast-glob'], '3.3.1')
  assert.throws(() => hooks.readPackage({ name: '@next/eslint-plugin-next', version: '16.4.2', dependencies: { 'fast-glob': '3.3.1' } }), /Reevaluate/)
  assert.throws(() => hooks.readPackage({ name: '@next/eslint-plugin-next', version: '16.3.8', dependencies: { 'fast-glob': 'changed' } }), /Reevaluate/)
  assert.throws(() => hooks.readPackage({ name: '@next/eslint-plugin-next', version: '16.4.1', dependencies: { keep: '1' } }), /Reevaluate/)
})

test('dependency hook is idempotent on a manifest already rebuilt from the lockfile (pnpm update -r / Dependabot)', () => {
  const { hooks } = require('../../.pnpmfile.cjs')
  const rebuilt = { name: '@next/eslint-plugin-next', version: '16.3.8', dependencies: { '@eslint-community/eslint-utils': '4.9.1' } }
  assert.deepEqual(hooks.readPackage(rebuilt).dependencies, { '@eslint-community/eslint-utils': '4.9.1' })
  const once = hooks.readPackage({ name: '@next/eslint-plugin-next', version: '16.3.8', dependencies: { 'fast-glob': '3.3.1', keep: '1' } })
  assert.deepEqual(hooks.readPackage(once).dependencies, { keep: '1' })
  assert.deepEqual(hooks.readPackage({ name: '@next/eslint-plugin-next', version: '16.3.8' }).dependencies, undefined)
})
