// Keep the unfiltered registry total and public agent statistics in sync.
export const PUBLIC_AGENT_DIRECTORY_WHERE_SQL = `status = 'active'
  AND visibility = 'public'
  AND archived_at IS NULL
  AND name NOT LIKE '%Seed%'
  AND name NOT LIKE '%Seeder%'
  AND name NOT LIKE 'API Agent%'
  AND name NOT LIKE 'Test%'`
