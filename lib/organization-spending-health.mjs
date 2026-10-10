import { parseUnits } from 'viem'
import { spendingAuthorityHash } from './organization-spending-authority.mjs'
const enterpriseClaims=`(SELECT 'evm' AS rail, intent_id, account_id, trade_id, authority_hash, chain_id, payer_address, nonce, tx_hash, state, created_at,maximum_execution_gas_cost_wei AS max_fee,NULL AS fee_token,NULL AS valid_before FROM organization_spending_payment_claims
  UNION ALL SELECT 'mpp', intent_id, account_id, trade_id, authority_hash, chain_id, payer_address, nonce, tx_hash, state, created_at,maximum_fee_token_cost_units,fee_token_address,valid_before FROM organization_spending_mpp_claims)`
const allClaims=`(SELECT 'enterprise_evm' AS family, intent_id, chain_id, payer_address, nonce, tx_hash, state FROM organization_spending_payment_claims
  UNION ALL SELECT 'enterprise_mpp', intent_id, chain_id, payer_address, nonce, tx_hash, state FROM organization_spending_mpp_claims
  UNION ALL SELECT 'route_evm', intent_id, chain_id, payer_address, nonce, tx_hash, state FROM buyer_evm_payment_claims
  UNION ALL SELECT 'route_mpp', intent_id, chain_id, payer_address, nonce, tx_hash, state FROM buyer_mpp_payment_claims)`
/** Fixed bounded aggregate output; raw original records never leave this audit. */
export async function inspectOrganizationSpendingHealth(client){
  const [usage,claims,collisions,transfers]=await Promise.all([
    client.execute(`SELECT a.id,a.version,a.authority_hash,a.payment_terms_json,a.max_lifetime_minor,a.max_purchase_minor,a.max_daily_minor,a.max_monthly_minor,a.organization_id,a.owner_account_id,a.buyer_agent_id,a.team_id,a.cost_center,a.client_reference,a.name,a.allowed_services_json,a.expires_at,
      COUNT(u.order_id) AS uses,COALESCE(SUM(u.amount_minor),0) AS gross_minor,
      COUNT(CASE WHEN u.order_id IS NOT NULL AND (o.id IS NULL OR t.id IS NULL OR approval.order_id IS NULL
        OR o.organization_spending_account_id IS NOT a.id OR u.account_id IS NOT a.id OR o.trade_id IS NOT u.trade_id
        OR u.authority_hash IS NOT a.authority_hash OR u.buyer_id IS NOT o.buyer_id OR u.buyer_id IS NOT t.buyer_id
        OR u.amount_minor IS NOT CAST(ROUND(t.total_cost*100) AS INTEGER) OR approval.amount_minor IS NOT u.amount_minor
        OR approval.trade_id IS NOT t.id OR approval.buyer_id IS NOT t.buyer_id OR u.created_at IS NOT o.created_at*1000
        OR o.payment_rail IS NOT CASE WHEN a.version=2 THEN 'evm' ELSE 'mpp' END OR t.payment_rail IS NOT o.payment_rail) THEN 1 END) AS anomalies,
      (SELECT COUNT(*) FROM service_orders original WHERE original.organization_spending_account_id=a.id
        AND NOT EXISTS(SELECT 1 FROM organization_spending_uses original_use WHERE original_use.account_id=a.id AND original_use.order_id=original.id AND original_use.trade_id=original.trade_id)) AS missing_uses
      FROM organization_spending_accounts a LEFT JOIN organization_spending_uses u ON u.account_id=a.id
      LEFT JOIN service_orders o ON o.id=u.order_id LEFT JOIN trades t ON t.id=u.trade_id
      LEFT JOIN organization_purchase_uses approval ON approval.order_id=o.id AND approval.approval_id=o.purchasing_approval_id
      WHERE a.version IN (2,3) GROUP BY a.id`),
    client.execute(`SELECT c.*,a.version,a.authority_hash AS original_authority,a.payment_terms_json,
      COALESCE(e.id,m.id) AS original_intent_id,COALESCE(e.trade_id,m.trade_id) AS intent_trade,
      COALESCE(e.buyer_id,m.buyer_id) AS intent_buyer,COALESCE(e.buyer_operation_id,m.buyer_operation_id) AS operation,
      COALESCE(e.chain_id,m.chain_id) AS intent_chain,COALESCE(e.payer_address,m.payer_address) AS intent_payer,
      COALESCE(e.token_address,m.token_address) AS intent_token,COALESCE(e.treasury_address,m.treasury_address) AS intent_treasury,
      COALESCE(e.token_amount,m.token_amount) AS intent_amount,COALESCE(e.expires_at,m.expires_at) AS intent_expiry,COALESCE(e.token_decimals,m.token_decimals) AS intent_decimals,
      e.token_usd_price,m.authority_hash AS intent_authority,m.account_id AS intent_account,e.tx_hash AS evm_hash,
      t.id AS original_trade,t.buyer_id AS original_buyer,t.total_cost,t.payment_rail AS trade_rail,
      u.account_id AS use_account,u.authority_hash AS use_authority,
      p.id AS receipt_id,p.tx_hash AS receipt_hash,p.chain_id AS receipt_chain,p.token_address AS receipt_token,
      p.token_amount AS receipt_amount,p.payer_address AS receipt_payer,p.payment_rail AS receipt_rail
      FROM ${enterpriseClaims} c LEFT JOIN organization_spending_accounts a ON a.id=c.account_id
      LEFT JOIN evm_payment_intents e ON c.rail='evm' AND e.id=c.intent_id
      LEFT JOIN organization_spending_mpp_intents m ON c.rail='mpp' AND m.id=c.intent_id
      LEFT JOIN trades t ON t.id=c.trade_id LEFT JOIN organization_spending_uses u ON u.trade_id=c.trade_id
      LEFT JOIN payment_receipts p ON p.trade_id=c.trade_id`),
    client.execute(`SELECT COUNT(*) AS count FROM ${allClaims} c WHERE c.family LIKE 'enterprise_%' AND EXISTS
      (SELECT 1 FROM ${allClaims} other WHERE (other.family<>c.family OR other.intent_id<>c.intent_id)
        AND ((other.chain_id=c.chain_id AND LOWER(other.payer_address)=LOWER(c.payer_address)
        AND (other.nonce=c.nonce OR (other.state='claimed' AND c.state='claimed'))) OR LOWER(other.tx_hash)=LOWER(c.tx_hash)))`),
    client.execute(`SELECT COUNT(*) AS count FROM settlement_transfers transfer WHERE
      (transfer.status='failed' OR (transfer.status IN ('pending','signing','prepared','submitted') AND transfer.updated_at<unixepoch()-900))
      AND EXISTS(SELECT 1 FROM service_orders o JOIN organization_spending_accounts a ON a.id=o.organization_spending_account_id WHERE o.trade_id=transfer.trade_id AND a.version IN (2,3))`),
  ])
  let usageAnomalies=0,feeExposureAnomalies=0,claimAnomalies=0,pending=0,stale=0
  for(const row of usage.rows){
    usageAnomalies+=Number(row.anomalies)+Number(row.missing_uses)
    const count=Number(row.uses),gross=Number(row.gross_minor)
    try{if(spendingAuthorityHash({...row,expires_at:new Date(Number(row.expires_at))})!==row.authority_hash)usageAnomalies++}catch{usageAnomalies++}
    if(!Number.isSafeInteger(count)||count<0||!Number.isSafeInteger(gross)||gross<0||gross>Number(row.max_lifetime_minor))usageAnomalies++
    try{const {payment}=JSON.parse(row.payment_terms_json),expected=row.version===2?'evm':'mpp'
      if(payment.rail!==expected)throw Error('Wrong original rail')
      const fee=BigInt(expected==='evm'?payment.max_gas_cost_wei:payment.max_fee_token_cost_units),limit=BigInt(expected==='evm'?payment.max_lifetime_gas_cost_wei:payment.max_lifetime_fee_token_cost_units)
      if(fee<=0n||limit<=0n||BigInt(count)*fee>limit)feeExposureAnomalies++
    }catch{feeExposureAnomalies++}
  }
  for(const row of claims.rows){
    if(row.state==='claimed'){pending++;if(Number(row.created_at)<Math.floor(Date.now()/1000)-900)stale++}
    try{
      const {payment,token_decimals,token_usd_price}=JSON.parse(row.payment_terms_json)
      if(!row.original_trade||!row.original_intent_id||!row.operation||row.intent_trade!==row.trade_id||row.intent_buyer!==row.original_buyer
        ||row.version!==(row.rail==='evm'?2:3)||row.trade_rail!==row.rail||row.use_account!==row.account_id||row.authority_hash!==row.original_authority||row.use_authority!==row.authority_hash
        ||row.chain_id!==row.intent_chain||row.payer_address!==row.intent_payer||payment.rail!==row.rail||payment.chain_id!==row.chain_id||payment.payer_address!==row.payer_address||payment.token_address!==row.intent_token||payment.treasury_address!==row.intent_treasury||token_decimals!==row.intent_decimals
        ||row.rail==='mpp'&&(row.intent_account!==row.account_id||row.intent_authority!==row.authority_hash||token_decimals!==6||token_usd_price!==1)
        ||row.rail==='evm'&&(row.evm_hash!==row.tx_hash||row.token_usd_price!==token_usd_price)
        ||row.intent_amount!==parseUnits((Number(row.total_cost)/token_usd_price).toFixed(token_decimals),token_decimals).toString()
        ||!['claimed','confirmed'].includes(row.state)||!/^0x[a-f0-9]{64}$/.test(row.tx_hash))throw Error('Original linkage changed')
      const max=BigInt(row.max_fee),limit=BigInt(row.rail==='evm'?payment.max_gas_cost_wei:payment.max_fee_token_cost_units)
      if(max<=0n||max>limit||row.rail==='mpp'&&(row.fee_token!==payment.fee_token_address||!Number.isSafeInteger(row.valid_before)||row.valid_before<=0||row.valid_before>Math.floor(Date.parse(row.intent_expiry)/1000)))throw Error('Claim fee scope changed')
      if(row.state==='confirmed'?!row.receipt_id:!!row.receipt_id)throw Error('Receipt state changed')
      if(row.receipt_id&&(row.receipt_hash!==row.tx_hash||row.receipt_chain!==row.chain_id||row.receipt_token!==row.intent_token||row.receipt_amount!==row.intent_amount||row.receipt_payer!==row.payer_address||row.receipt_rail!==row.rail))throw Error('Original receipt changed')
    }catch{claimAnomalies++}
  }
  const counts={external_account_count:usage.rows.length,original_external_use_count:usage.rows.reduce((n,row)=>n+Number(row.uses),0),pending_claim_count:pending,stale_claim_count:stale,
    usage_anomaly_count:usageAnomalies,fee_exposure_anomaly_count:feeExposureAnomalies,payment_claim_anomaly_count:claimAnomalies,wallet_collision_count:Number(collisions.rows[0]?.count||0),uncertain_transfer_count:Number(transfers.rows[0]?.count||0)}
  const alerts=[['ORGANIZATION_SPENDING_USAGE_INVARIANT',usageAnomalies],['ORGANIZATION_SPENDING_FEE_EXPOSURE',feeExposureAnomalies],['ORGANIZATION_PAYMENT_CLAIM_INVARIANT',claimAnomalies],['ORGANIZATION_WALLET_COLLISION',counts.wallet_collision_count],['ORGANIZATION_PAYMENT_UNCONFIRMED',stale],['ORGANIZATION_TRANSFER_UNCERTAIN',counts.uncertain_transfer_count]].filter(([,count])=>count>0).map(([code,count])=>({code,count,severity:'critical'}))
  return {...counts,healthy:alerts.length===0,alerts,checked_at:new Date().toISOString(),stale_after_seconds:900}
}
