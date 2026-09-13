import { is, SQL } from 'drizzle-orm'
import { getTableConfig, SQLiteSyncDialect, type SQLiteTable } from 'drizzle-orm/sqlite-core'
import type { Client } from '@libsql/client'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// libSQL opens a new connection after transactions, so these integration tests
// use a disposable local database instead of a connection-local :memory: DB.
export async function createLocalTestSchema(client: Client, tables: Record<string, SQLiteTable>) {
  if (!process.env.TURSO_DATABASE_URL?.startsWith(`file:${join(tmpdir(), 'clawdmarket-workspace-test-')}`)) throw new Error('These fixtures require an isolated temporary database')
  const dialect = new SQLiteSyncDialect()
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`
  const literal = (value: unknown): string => is(value, SQL) ? dialect.sqlToQuery(value).sql
    : typeof value === 'string' ? `'${value.replaceAll("'", "''")}'` : typeof value === 'boolean' ? String(Number(value)) : String(value)
  for (const table of Object.values(tables)) {
    const config = getTableConfig(table)
    const columns = config.columns.map((column) => `${quote(column.name)} ${column.getSQLType()}${column.primary ? ' PRIMARY KEY' : ''}${column.notNull ? ' NOT NULL' : ''}${column.isUnique ? ' UNIQUE' : ''}${column.default !== undefined ? ` DEFAULT ${literal(column.default)}` : ''}`)
    for (const foreignKey of config.foreignKeys) {
      const reference = foreignKey.reference()
      columns.push(`FOREIGN KEY (${reference.columns.map((column) => quote(column.name)).join(', ')}) REFERENCES ${quote(getTableConfig(reference.foreignTable).name)} (${reference.foreignColumns.map((column) => quote(column.name)).join(', ')})`)
    }
    await client.execute(`CREATE TABLE IF NOT EXISTS ${quote(config.name)} (${columns.join(', ')})`)
    for (const index of config.indexes) {
      const fields = index.config.columns.map((column) => is(column, SQL) ? dialect.sqlToQuery(column).sql : quote(column.name))
      await client.execute(`CREATE ${index.config.unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS ${quote(index.config.name)} ON ${quote(config.name)} (${fields.join(', ')})`)
    }
  }
}
