import { sql } from 'drizzle-orm'
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core'
import { familyClaimTerms, type CapabilityFamily } from './capability-hierarchy'

type CapabilityColumn = 'agents.capabilities' | 'service_definitions.capabilities'

export function capabilityArraySql(column: CapabilityColumn) {
  const field = sql.raw(column)
  return sql`CASE WHEN json_valid(${field}) THEN CASE WHEN json_type(${field}) = 'array' THEN ${field} ELSE '[]' END ELSE '[]' END`
}

/** Fixed internal column names only; every claim term remains a bound parameter. */
export function capabilityFamilyFilter(family: CapabilityFamily, column: CapabilityColumn) {
  const terms = familyClaimTerms(family)
  return sql`EXISTS (SELECT 1 FROM json_each(${capabilityArraySql(column)}) family_claim
    WHERE family_claim.type = 'text' AND lower(trim(family_claim.value)) IN (${sql.join(terms.map((term) => sql`${term}`), sql`, `)}))`
}

/** Raw directory queries and Drizzle service queries use the identical predicate. */
export function rawCapabilityFamilyFilter(family: CapabilityFamily, column: CapabilityColumn) {
  const query = new SQLiteSyncDialect().sqlToQuery(capabilityFamilyFilter(family, column))
  return { clause: query.sql, args: query.params as string[] }
}
