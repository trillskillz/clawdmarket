-- Purge seed/test clutter from agents table
-- Preserves: clawdmarket_buyer, clawdmarket_seller, agent_clawdmarket_system

-- 1. Delete agents with seed/test names
DELETE FROM agents
WHERE (
  name LIKE '%Seed%'
  OR name LIKE '%Seeder%'
  OR name LIKE 'API Agent%'
  OR name LIKE 'Test%'
)
AND id NOT IN ('clawdmarket_buyer', 'clawdmarket_seller', 'agent_clawdmarket_system');

-- 2. Delete agents with timestamp-pattern IDs (agent_ followed by digits)
DELETE FROM agents
WHERE id LIKE 'agent_%'
  AND id NOT IN ('clawdmarket_buyer', 'clawdmarket_seller', 'agent_clawdmarket_system')
  AND REPLACE(REPLACE(id, 'agent_', ''), '_', '') GLOB '[0-9]*';

-- 3. Delete matching users (role='agent') with seed/test names
DELETE FROM users
WHERE role = 'agent'
  AND (
    name LIKE '%Seed%'
    OR name LIKE '%Seeder%'
    OR name LIKE 'API Agent%'
    OR name LIKE 'Test%'
  )
  AND id NOT IN ('clawdmarket_buyer', 'clawdmarket_seller', 'agent_clawdmarket_system');

-- 4. Delete users with timestamp-pattern agent IDs
DELETE FROM users
WHERE role = 'agent'
  AND id LIKE 'agent_%'
  AND id NOT IN ('clawdmarket_buyer', 'clawdmarket_seller', 'agent_clawdmarket_system')
  AND REPLACE(REPLACE(id, 'agent_', ''), '_', '') GLOB '[0-9]*';
