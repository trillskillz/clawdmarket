import 'server-only'

/** Expressions are fixed source-code columns, never request input. Preserve millisecond precision. */
export function activityEpochSql(column: string) {
  return `CASE WHEN typeof(${column}) IN ('integer', 'real')
    OR (trim(${column}) <> '' AND trim(${column}) NOT GLOB '*[^0-9.]*' AND trim(${column}) GLOB '*[0-9]*' AND trim(${column}) NOT LIKE '%.%.%')
    THEN CASE WHEN CAST(${column} AS REAL) <= 9999999999
      THEN CAST(${column} AS REAL) * 1000 ELSE CAST(${column} AS REAL) END
    ELSE ROUND((julianday(${column}) - 2440587.5) * 86400000) END`
}

export function latestActivitySql(query: string, timestamp: string) {
  return `SELECT * FROM (SELECT source.*, ${activityEpochSql(timestamp)} AS event_at_ms
    FROM (${query}) source) WHERE event_at_ms IS NOT NULL ORDER BY event_at_ms DESC, id DESC LIMIT 50`
}
