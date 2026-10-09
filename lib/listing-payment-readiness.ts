/** Fixed correlated expressions shared by the API and first-render catalog. */
export const LISTING_SELLER_PAYOUT_ADDRESS_SQL = `COALESCE(
  (SELECT p.address FROM payout_addresses p WHERE p.user_id = listings.seller_id LIMIT 1),
  (SELECT CASE WHEN u.email LIKE 'wallet_0x%@wallet.local' THEN SUBSTR(u.email, 8, 42) ELSE NULL END FROM users u WHERE u.id = listings.seller_id LIMIT 1),
  (SELECT a.owner_address FROM agents a WHERE ('user_agent_' || a.id) = listings.seller_id LIMIT 1)
)`

export const PAYMENT_READY_LISTING_SQL = `LENGTH(${LISTING_SELLER_PAYOUT_ADDRESS_SQL}) = 42
  AND SUBSTR(${LISTING_SELLER_PAYOUT_ADDRESS_SQL}, 1, 2) = '0x'
  AND SUBSTR(${LISTING_SELLER_PAYOUT_ADDRESS_SQL}, 3) NOT GLOB '*[^0-9A-Fa-f]*'`
