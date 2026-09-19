import { execFile } from 'node:child_process'
import { mkdtemp, realpath, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { createClient } from '@libsql/client'
import { inspectDatabaseSchema } from '../lib/database-readiness.ts'

const execFileAsync = promisify(execFile)

const argument = process.argv[2] === '--' ? process.argv[3] : process.argv[2]
if (!argument || argument.startsWith('libsql:') || argument.startsWith('http:') || argument.startsWith('https:')) {
  throw new Error('Pass an explicit local SQLite file path. This tool never accesses a remote database.')
}
const source = await realpath(resolve(argument))
if (!(await stat(source)).isFile()) throw new Error('Source must be a regular SQLite file')

const started = Date.now()
const directory = await mkdtemp(join(tmpdir(), 'clawdmarket-restore-'))
const destination = join(directory, 'restored.db')
let restored
try {
  // SQLite .backup creates a consistent snapshot even when the source uses WAL.
  // The source is opened read-only; all validation runs against the copy.
  await execFileAsync('sqlite3', ['-readonly', source, `.backup ${destination}`])
  restored = createClient({ url: `file:${destination}` })
  const integrity = await restored.execute('PRAGMA integrity_check')
  const foreignKeys = await restored.execute('PRAGMA foreign_key_check')
  const schema = await inspectDatabaseSchema(restored)
  const counts = {}
  for (const table of ['users', 'trades', 'payment_receipts', 'settlement_transfers', 'payment_controls']) {
    const result = await restored.execute(`SELECT COUNT(*) AS total FROM "${table}"`)
    counts[table] = Number(result.rows[0]?.total || 0)
  }
  const result = {
    restored_at: new Date().toISOString(), elapsed_ms: Date.now() - started,
    integrity: String(integrity.rows[0]?.integrity_check || ''),
    foreign_key_violations: foreignKeys.rows.length,
    schema_ready: schema.ready,
    missing_tables: schema.missing_tables,
    missing_columns: schema.missing_columns,
    counts,
    scope: 'isolated local SQLite rehearsal; not a Turso production recovery-point test',
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  if (result.integrity !== 'ok' || result.foreign_key_violations > 0 || !result.schema_ready) process.exitCode = 1
} finally {
  restored?.close()
  await rm(directory, { recursive: true, force: true })
}
