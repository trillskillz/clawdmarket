// Every active public registration belongs in the live registry and its count.
export const PUBLIC_AGENT_DIRECTORY_WHERE_SQL = `status = 'active'
  AND visibility = 'public'
  AND archived_at IS NULL`

/** Historical discovery badge only; profile tags never grant ranking or spending authority. */
export const PUBLIC_AGENT_VERIFIED_TAG_SQL = "LOWER(agents.capabilities) LIKE '%:verified%'"
