import { readChainFeeEvidence, pathUsd } from './chain-fee-codec.mjs'
const maximumRecords=10_000
const original=`FROM organization_spending_uses u JOIN organization_spending_accounts a ON a.id=u.account_id
  LEFT JOIN service_orders o ON o.id=u.order_id LEFT JOIN trades t ON t.id=u.trade_id`
const scope=`a.version,a.payment_terms_json,a.authority_hash AS original_authority,u.authority_hash AS use_authority,
  u.trade_id AS original_trade,u.account_id AS original_account,o.trade_id AS order_trade,o.organization_spending_account_id AS order_account,
  u.buyer_id AS original_buyer,o.buyer_id AS order_buyer,t.buyer_id AS trade_buyer`
const sql=`SELECT 'buyer' AS role,${scope},p.chain_id,p.payment_rail,p.token_address,p.payer_address,p.tx_hash,p.chain_fee_evidence_json,'confirmed' AS status
  ${original} JOIN payment_receipts p ON p.trade_id=u.trade_id WHERE a.version IN (2,3)
  UNION ALL
  SELECT 'treasury',${scope},s.chain_id,CASE WHEN s.chain_id=4217 THEN 'mpp' ELSE 'evm' END,s.token_address,s.from_address,s.tx_hash,s.chain_fee_evidence_json,s.status
  ${original} JOIN settlement_transfers s ON s.trade_id=u.trade_id WHERE a.version IN (2,3)
  LIMIT ${maximumRecords+1}`
const bucket=()=>({record_count:0,measured_count:0,unmeasured_count:0,invalid_count:0,known_fee_units:'0',total_fee_units:null,coverage:'no_records'})
/** Only original stored observations. Never queries RPC, estimates missing fees, or mutates authority. */
export async function inspectOrganizationChainFeeHealth(client){
  const result=await client.execute(sql)
  if(result.rows.length>maximumRecords)throw Error('ORGANIZATION_CHAIN_FEE_OBSERVATIONS_UNAVAILABLE')
  const groups=[1,11155111,4217].map(chain_id=>({chain_id,asset:chain_id===4217?'pathUSD':'ETH',unit:chain_id===4217?'token_base_units':'wei',decimals:chain_id===4217?6:18,buyer:bucket(),treasury:bucket()}))
  let invalid=0,unclassified=0
  for(const row of result.rows){
    let group,role
    try{
      const terms=JSON.parse(row.payment_terms_json),payment=terms.payment
      group=groups.find(entry=>entry.chain_id===payment.chain_id)
      if(!group||!['buyer','treasury'].includes(row.role))throw Error('Unsupported original scope')
      role=group[row.role];role.record_count++
      if(row.version!==(payment.rail==='evm'?2:payment.rail==='mpp'?3:0)||row.version===3&&payment.chain_id!==4217||row.version===2&&![1,11155111].includes(payment.chain_id)
        ||row.original_authority!==row.use_authority||row.original_trade!==row.order_trade||row.original_account!==row.order_account
        ||typeof row.original_buyer!=='string'||row.original_buyer!==row.order_buyer||row.original_buyer!==row.trade_buyer
        ||payment.chain_id!==row.chain_id||payment.rail!==row.payment_rail||payment.token_address!==row.token_address
        ||(row.role==='buyer'?payment.payer_address:payment.treasury_address)!==row.payer_address
        ||row.version===3&&(payment.token_address!==pathUsd||payment.fee_token_address!==pathUsd||terms.token_decimals!==6||terms.token_usd_price!==1||terms.fee_token_decimals!==6))throw Error('Original payment scope changed')
      const evidence=readChainFeeEvidence(row.chain_fee_evidence_json,{chainId:row.chain_id,txHash:row.tx_hash,payerAddress:row.payer_address})
      if(!evidence){role.unmeasured_count++;continue}
      if(!['confirmed','failed'].includes(row.status)||evidence.model!==(row.version===2?'ethereum_l1_native_v1':'tempo_pathusd_sender_fee_v1'))throw Error('Fee observation scope changed')
      const fee=BigInt(evidence.total_fee_units)
      if(row.role==='buyer'){
        const ceiling=row.version===2?payment.max_gas_cost_wei:payment.max_fee_token_cost_units
        if(typeof ceiling!=='string'||!/^[1-9][0-9]{0,77}$/.test(ceiling)||fee>BigInt(ceiling))throw Error('Original buyer fee ceiling exceeded')
      }
      role.measured_count++;role.known_fee_units=(BigInt(role.known_fee_units)+fee).toString()
    }catch{invalid++;if(role)role.invalid_count++;else unclassified++}
  }
  for(const group of groups)for(const role of [group.buyer,group.treasury]){
    role.coverage=role.record_count===0?'no_records':role.invalid_count?'invalid':role.unmeasured_count?'partial':'measured'
    role.total_fee_units=role.coverage==='measured'?role.known_fee_units:null
  }
  return {groups,record_count:result.rows.length,invalid_count:invalid,unclassified_record_count:unclassified,healthy:invalid===0,
    alerts:invalid?[{code:'ORGANIZATION_CHAIN_FEE_INVARIANT',count:invalid,severity:'critical'}]:[],checked_at:new Date().toISOString()}
}
