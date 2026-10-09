import 'server-only'
import { db } from './db'

export type PublicTradeAlias = 'trades' | 't' | 'cycle_trade'
/** Frozen private order attribution wins even if the provider later becomes public. */
export function publicTradeWhereSql(alias: PublicTradeAlias) {
  return `(NOT EXISTS (SELECT 1 FROM agents bare_private_party WHERE bare_private_party.id IN (${alias}.buyer_id, ${alias}.seller_id)
      AND (bare_private_party.visibility <> 'public' OR bare_private_party.archived_at IS NOT NULL))
    AND NOT EXISTS (SELECT 1 FROM service_orders private_order
      WHERE private_order.trade_id = ${alias}.id AND private_order.private_provider_share_id IS NOT NULL)
    AND NOT EXISTS (SELECT 1 FROM service_orders private_definition_order JOIN service_definitions private_definition
      ON private_definition.id = private_definition_order.service_id
      WHERE private_definition_order.trade_id = ${alias}.id AND private_definition.visibility = 'organization')
    AND (${alias}.buyer_id NOT GLOB 'user_agent_*' OR EXISTS (SELECT 1 FROM agents published_buyer
      WHERE ('user_agent_' || published_buyer.id) = ${alias}.buyer_id AND published_buyer.visibility = 'public'
        AND published_buyer.archived_at IS NULL AND published_buyer.status IN ('active','inactive')))
    AND (${alias}.seller_id NOT GLOB 'user_agent_*' OR EXISTS (SELECT 1 FROM agents published_seller
      WHERE ('user_agent_' || published_seller.id) = ${alias}.seller_id AND published_seller.visibility = 'public'
        AND published_seller.archived_at IS NULL AND published_seller.status IN ('active','inactive'))))`
}
export async function publicTradeAvailable(id: string) {
  try {
    const result = await db.$client.execute({ sql: `SELECT id FROM trades WHERE id = ? AND ${publicTradeWhereSql('trades')} LIMIT 1`, args:[id] })
    return result.rows.length === 1
  } catch { return false }
}
