import { createHash } from 'node:crypto'
/** Preserve original version-1/2/3 fingerprints exactly; no credential fields. */
export function spendingAuthorityHash(row){
  return createHash('sha256').update(JSON.stringify({version:row.version??1,...(row.version!==undefined&&row.version>=2?{payment_terms_json:row.payment_terms_json}:{}),organization_id:row.organization_id,owner_account_id:row.owner_account_id,buyer_agent_id:row.buyer_agent_id,
    team_id:row.team_id,cost_center:row.cost_center,client_reference:row.client_reference,name:row.name,allowed_services_json:row.allowed_services_json,
    max_purchase_minor:row.max_purchase_minor,max_daily_minor:row.max_daily_minor,max_monthly_minor:row.max_monthly_minor,max_lifetime_minor:row.max_lifetime_minor,
    expires_at:row.expires_at.toISOString()})).digest('hex')
}
