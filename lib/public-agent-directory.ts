// Every active public registration belongs in the live registry and its count.
export const PUBLIC_AGENT_DIRECTORY_WHERE_SQL = `status = 'active'
  AND visibility = 'public'
  AND archived_at IS NULL`
