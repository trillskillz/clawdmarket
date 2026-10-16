import { sql } from 'drizzle-orm'
import { db } from './db'
import { MARKETPLACE_COHORTS, type MarketplaceCohort, runtimeReferencePrincipals } from './marketplace-cohort-policy'
export { MARKETPLACE_COHORTS, type MarketplaceCohort }

// Only operator attributions can classify ownership. Names, endpoint URLs,
// descriptions, distinct accounts and an unrecognized identity are not evidence.
export async function loadMarketplaceCohorts(principalIds: string[], source: Pick<typeof db, 'all'> = db) {
  if (!principalIds.length) return new Map<string, { cohort: MarketplaceCohort; evidence_ref: string | null; as_of: string | null }>()
  const rows = await source.all<{ principal_id: string; cohort: MarketplaceCohort; evidence_ref: string; recorded_at: string; expires_at: string | null; ownership_current: number }>(sql`
    SELECT principal_id, cohort, evidence_ref, recorded_at, expires_at,
      CASE WHEN principal_id NOT GLOB 'user_agent_*' OR EXISTS (
        SELECT 1 FROM agent_owners owning WHERE ('user_agent_' || owning.agent_id)=principal_id
          AND owning.updated_at < unixepoch(recorded_at)
      ) THEN 1 ELSE 0 END AS ownership_current FROM (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY principal_id ORDER BY recorded_at DESC, id DESC) AS position
      FROM marketplace_cohort_attributions WHERE principal_id IN (${sql.join(principalIds.map(id => sql`${id}`), sql`,`)})
    ) WHERE position = 1`)
  const current = new Map(rows.map(row => [row.principal_id, row]))
  const managed = runtimeReferencePrincipals()
  return new Map(principalIds.map(id => {
    if (managed.has(id)) return [id, { cohort: 'platform_reference' as const, evidence_ref: 'operator_reference_fleet_runtime_v1', as_of: null }]
    const row = current.get(id)
    const valid = row && (!row.expires_at || Date.parse(row.expires_at) > Date.now())
      && (row.cohort !== 'independence_verified' || Number(row.ownership_current) === 1)
    return [id, { cohort: valid ? row.cohort : 'ownership_unverified', evidence_ref: valid ? row.evidence_ref : null, as_of: row?.recorded_at ?? null }]
  }))
}
