/** Browser-side original owner review. Stores reviewed terms; never credential responses. */
import { parseUnits } from 'viem'
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const address=/^0x[a-f0-9]{40}$/
const unit=/^(?:0|[1-9][0-9]{0,77})$/
const fields=['version','client_reference','name','buyer_agent_id','team_id','cost_center','allowed_services','max_purchase','max_daily','max_monthly','max_lifetime','expires_at']
const paymentFields={evm:['rail','chain_id','token_address','payer_address','treasury_address','minimum_token_reserve_units','minimum_native_reserve_wei','max_gas_cost_wei','max_lifetime_gas_cost_wei'],mpp:['rail','chain_id','token_address','payer_address','treasury_address','minimum_token_reserve_units','fee_token_address','minimum_fee_token_reserve_units','max_fee_token_cost_units','max_lifetime_fee_token_cost_units']}
function invalid(){throw Error('OWNER_GRANT_REVIEW_INVALID')}
export function decimalGrantUnits(value,decimals,positive=false){
  if(!Number.isInteger(decimals)||decimals<0||decimals>36||typeof value!=='string'||!new RegExp(`^(?:0|[1-9][0-9]{0,76})${decimals?`(?:\\.[0-9]{1,${decimals}})?`:''}$`).test(value))invalid()
  const amount=parseUnits(value,decimals);if(amount<0n||amount>=2n**256n||positive&&amount===0n)invalid();return amount.toString()
}
function checkedGrant(grant){
  if(!grant||![1,2,3].includes(grant.version)||!uuid.test(grant.client_reference)||typeof grant.name!=='string'||!grant.name.trim()||grant.name.length>120||typeof grant.buyer_agent_id!=='string'||!grant.buyer_agent_id||grant.team_id!==null&&!uuid.test(grant.team_id)||typeof grant.cost_center!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(grant.cost_center)||!Array.isArray(grant.allowed_services)||grant.allowed_services.length<1||grant.allowed_services.length>20||!Number.isFinite(Date.parse(grant.expires_at)))invalid()
  for(const item of grant.allowed_services)if(!item||!uuid.test(item.service_id)||item.provider_share_id!==null&&!uuid.test(item.provider_share_id)||Object.keys(item).some(key=>!['service_id','provider_share_id'].includes(key)))invalid()
  for(const key of ['max_purchase','max_daily','max_monthly','max_lifetime'])decimalGrantUnits(grant[key],2,true)
  const allowed=[...fields,...(grant.version>=2?['payment','expected_token_decimals','expected_token_usd_price']:[])];if(Object.keys(grant).some(key=>!allowed.includes(key)))invalid()
  if(grant.version>=2){if(!Number.isInteger(grant.expected_token_decimals)||grant.expected_token_decimals<0||grant.expected_token_decimals>36||!Number.isFinite(grant.expected_token_usd_price)||grant.expected_token_usd_price<=0||grant.version===3&&(grant.expected_token_decimals!==6||grant.expected_token_usd_price!==1))invalid();const p=grant.payment,rail=grant.version===2?'evm':'mpp',keys=paymentFields[rail];if(!p||p.rail!==rail||Object.keys(p).length!==keys.length||Object.keys(p).some(key=>!keys.includes(key))||!keys.every(key=>key in p)||(rail==='evm'?![1,11155111].includes(p.chain_id):p.chain_id!==4217))invalid()
    for(const key of keys){if(key.endsWith('_address')&&!address.test(p[key]))invalid();if(key.endsWith('_units')||key.endsWith('_wei')){if(!unit.test(p[key])||BigInt(p[key])>=2n**256n||key.startsWith('max_')&&BigInt(p[key])===0n)invalid()}}
    if(rail==='mpp'&&p.fee_token_address!==p.token_address)invalid()
  }
  return grant
}
export function encodeOwnerGrantReview(organizationId,grant,phase='reviewed'){
  if(!uuid.test(organizationId)||!['reviewed','request_started'].includes(phase))invalid()
  const text=JSON.stringify({version:1,organization_id:organizationId,phase,grant:checkedGrant(grant)})
  if(text.length>16384)invalid();return text
}
export function decodeOwnerGrantReview(text,organizationId){
  if(typeof text!=='string'||text.length>16384)invalid();let value;try{value=JSON.parse(text)}catch{invalid()}
  if(value?.version!==1||value.organization_id!==organizationId||!['reviewed','request_started'].includes(value.phase)||Object.keys(value).some(key=>!['version','organization_id','phase','grant'].includes(key)))invalid()
  checkedGrant(value.grant);return value
}
const stable=value=>JSON.stringify(value,typeof value==='object'&&value!==null&&!Array.isArray(value)?Object.keys(value).sort():undefined)
export function ownerGrantReviewMatches(grant,account){
  checkedGrant(grant)
  if(!account||account.client_reference!==grant.client_reference||account.version!==grant.version)return false
  for(const key of fields){
    if(key.startsWith('max_')){try{if(decimalGrantUnits(grant[key],2,true)!==decimalGrantUnits(account[key],2,true))return false}catch{return false}}
    else if(key==='expires_at'){if(new Date(grant[key]).toISOString()!==new Date(account[key]).toISOString())return false}
    else if(key==='allowed_services'){if(grant[key].length!==account[key]?.length||!grant[key].every((item,i)=>item.service_id===account[key][i].service_id&&item.provider_share_id===account[key][i].provider_share_id))return false}
    else if(grant[key]!==account[key])return false
  }
  return grant.version===1?account.payment===undefined:account.token_decimals===grant.expected_token_decimals&&account.token_usd_price===grant.expected_token_usd_price&&stable(grant.payment)===stable(account.payment)
}
