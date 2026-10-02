/** Aggregate-only inventory. Never return owner_address or a reversible derivative. */
export async function inspectLegacyOwnerValues(client) {
  const classification = `WITH classified AS (
    SELECT id, CASE
      WHEN LENGTH(TRIM(owner_address)) = 0 THEN 'blank'
      WHEN owner_address LIKE '%@%' THEN 'email_like'
      WHEN LENGTH(owner_address) = 42 AND LOWER(SUBSTR(owner_address, 1, 2)) = '0x'
        AND SUBSTR(owner_address, 3) NOT GLOB '*[^0-9A-Fa-f]*' THEN 'evm_address'
      WHEN LOWER(owner_address) LIKE 'https://%' OR LOWER(owner_address) LIKE 'http://%' THEN 'url_like'
      WHEN LENGTH(owner_address) = 36 AND SUBSTR(owner_address, 9, 1) = '-'
        AND SUBSTR(owner_address, 14, 1) = '-' AND SUBSTR(owner_address, 19, 1) = '-'
        AND SUBSTR(owner_address, 24, 1) = '-'
        AND REPLACE(owner_address, '-', '') NOT GLOB '*[^0-9A-Fa-f]*' THEN 'uuid_like'
      WHEN SUBSTR(owner_address, 1, 11) = 'user_agent_'
        OR SUBSTR(owner_address, 1, 6) = 'agent:'
        OR SUBSTR(owner_address, 1, 11) = 'autonomous:' THEN 'agent_reference_like'
      WHEN LOWER(owner_address) LIKE '0x%' THEN 'malformed_wallet_like'
      WHEN LENGTH(owner_address) <= 20 THEN 'opaque_short'
      WHEN LENGTH(owner_address) <= 64 THEN 'opaque_medium'
      ELSE 'opaque_long'
    END AS category FROM agents
  )`
  const result = await client.execute(`${classification} SELECT category, COUNT(*) AS count FROM classified GROUP BY category`)
  const categories = Object.fromEntries([
    'blank', 'email_like', 'evm_address', 'url_like', 'uuid_like', 'agent_reference_like',
    'malformed_wallet_like', 'opaque_short', 'opaque_medium', 'opaque_long',
  ].map((category) => [category, 0]))
  for (const row of result.rows) categories[String(row.category)] = Number(row.count || 0)
  const linked = { ...categories }
  for (const category of Object.keys(linked)) linked[category] = 0
  const links = await client.execute(`${classification}
    SELECT c.category, COUNT(o.agent_id) AS count FROM classified c
    LEFT JOIN agent_owners o ON o.agent_id = c.id GROUP BY c.category`)
  for (const row of links.rows) linked[String(row.category)] = Number(row.count || 0)
  const collisions = await client.execute(`WITH wallet_owners AS (
    SELECT LOWER(owner_address) AS wallet, COUNT(*) AS agents
    FROM agents
    WHERE LENGTH(owner_address) = 42 AND LOWER(SUBSTR(owner_address, 1, 2)) = '0x'
      AND SUBSTR(owner_address, 3) NOT GLOB '*[^0-9A-Fa-f]*'
    GROUP BY LOWER(owner_address) HAVING COUNT(*) > 1
  ) SELECT COUNT(*) AS groups, COALESCE(SUM(agents), 0) AS agents FROM wallet_owners`)
  const emailAgreement = await client.execute(`SELECT COUNT(*) AS matches FROM agents
    WHERE owner_address LIKE '%@%' AND owner_email IS NOT NULL
      AND LOWER(TRIM(owner_address)) = LOWER(TRIM(owner_email))`)
  const collisionLinks = await client.execute(`WITH shared_wallets AS (
    SELECT LOWER(a.owner_address) AS wallet, COUNT(*) AS agents,
      COUNT(o.agent_id) AS linked_agents, COUNT(DISTINCT o.user_id) AS linked_accounts
    FROM agents a LEFT JOIN agent_owners o ON o.agent_id = a.id
    WHERE LENGTH(a.owner_address) = 42 AND LOWER(SUBSTR(a.owner_address, 1, 2)) = '0x'
      AND SUBSTR(a.owner_address, 3) NOT GLOB '*[^0-9A-Fa-f]*'
    GROUP BY LOWER(a.owner_address) HAVING COUNT(*) > 1
  ) SELECT
    COALESCE(SUM(CASE WHEN linked_accounts > 1 THEN 1 ELSE 0 END), 0) AS multiple_linked_accounts,
    COALESCE(SUM(CASE WHEN linked_agents < agents THEN 1 ELSE 0 END), 0) AS incomplete_links
    FROM shared_wallets`)
  return {
    total: Object.values(categories).reduce((sum, count) => sum + count, 0), ...categories,
    evm_address_collision_groups: Number(collisions.rows[0]?.groups || 0),
    evm_address_agents_in_collision: Number(collisions.rows[0]?.agents || 0),
    linked_owner_by_category: linked,
    email_like_owner_email_matches: Number(emailAgreement.rows[0]?.matches || 0),
    evm_address_collision_groups_with_multiple_linked_accounts: Number(collisionLinks.rows[0]?.multiple_linked_accounts || 0),
    evm_address_collision_groups_with_incomplete_links: Number(collisionLinks.rows[0]?.incomplete_links || 0),
  }
}
