import test from 'node:test'
import assert from 'node:assert/strict'
import { inspectOrganizationChainFeeHealth } from '../../lib/organization-chain-fee-health.mjs'
import { formatChainFeeUnits } from '../../lib/chain-fee-format.mjs'
const address=(n:string)=>`0x${n.repeat(40)}`,hash=(n:string)=>`0x${n.repeat(64)}`
function record(chain=1,role='buyer',fee='50000000000000'){
  const payer=address('1'),treasury=address('2'),token=chain===4217?'0x20c0000000000000000000000000000000000000':address('3')
  const payment={rail:chain===4217?'mpp':'evm',chain_id:chain,payer_address:payer,treasury_address:treasury,token_address:token,fee_token_address:token,max_gas_cost_wei:'99999999999999999999999999999',max_fee_token_cost_units:'10000'}
  const who=role==='buyer'?payer:treasury
  const evidence=chain===4217?{version:1,model:'tempo_pathusd_sender_fee_v1',chain_id:chain,tx_hash:hash('a'),block_hash:hash('b'),block_number:'5',payer_address:who,fee_asset:'fee_token',unit:'token_base_units',fee_token_address:token,fee_manager_address:'0xfeec000000000000000000000000000000000000',fee_log_index:'0',gas_price_unit:'attousd',gas_price_scale:'1000000000000',gas_used:'21000',effective_gas_price:'1000000000',execution_fee_units:'21',blob_fee_units:'0',total_fee_units:'21',fee_transfer_amount_units:'21'}
    :{version:1,model:'ethereum_l1_native_v1',chain_id:chain,tx_hash:hash('a'),block_hash:hash('b'),block_number:'5',payer_address:who,fee_asset:'native',unit:'wei',gas_used:'1',effective_gas_price:fee,execution_fee_units:fee,blob_fee_units:'0',total_fee_units:fee}
  return {role,version:chain===4217?3:2,payment_terms_json:JSON.stringify({payment,token_decimals:6,token_usd_price:1,fee_token_decimals:6}),original_authority:'a'.repeat(64),use_authority:'a'.repeat(64),original_buyer:'private-buyer',order_buyer:'private-buyer',trade_buyer:'private-buyer',original_trade:'private-trade',order_trade:'private-trade',original_account:'private-account',order_account:'private-account',chain_id:chain,payment_rail:payment.rail,token_address:token,payer_address:who,tx_hash:hash('a'),chain_fee_evidence_json:JSON.stringify(evidence),status:'confirmed'}
}
const inspect=(rows:any[])=>inspectOrganizationChainFeeHealth({execute:async(sql:string)=>{assert.match(sql,/LIMIT 10001/);assert.doesNotMatch(sql,/credential|raw_transaction|INSERT|UPDATE|DELETE/i);return {rows}}})

test('enterprise fee observations separate original buyer/treasury, chains and exact units including charged failed attempts',async()=>{
  const rows=[record(),record(1,'buyer','184467440737095516160000'),record(11155111),record(4217),{...record(4217,'treasury'),status:'failed'}]
  const view=await inspect(rows),[l1,sepolia,tempo]=view.groups
  assert.equal(view.healthy,true);assert.equal(l1.buyer.total_fee_units,'184467440787095516160000');assert.equal(l1.treasury.total_fee_units,null)
  assert.equal(sepolia.buyer.total_fee_units,'50000000000000');assert.equal(tempo.buyer.total_fee_units,'21');assert.equal(tempo.treasury.total_fee_units,'21')
  assert.equal(tempo.treasury.measured_count,1);assert.equal(tempo.treasury.coverage,'measured')
  const text=JSON.stringify(view);for(const value of ['private-buyer','private-trade','private-account',hash('a'),address('1'),address('2'),'payment_terms_json'])assert.equal(text.includes(value),false)
})

test('historical missing observations retain known subtotal and null actual totals without an invariant alert',async()=>{
  const view=await inspect([record(),{...record(),chain_fee_evidence_json:null}]),buyer=view.groups[0].buyer
  assert.equal(view.healthy,true);assert.equal(buyer.coverage,'partial');assert.equal(buyer.measured_count,1);assert.equal(buyer.unmeasured_count,1)
  assert.equal(buyer.known_fee_units,'50000000000000');assert.equal(buyer.total_fee_units,null);assert.deepEqual(view.alerts,[])
  const empty=await inspect([]);assert.ok(empty.groups.every(group=>group.buyer.coverage==='no_records'&&group.buyer.total_fee_units===null))
})

test('changed original fee identity, model, linkage, ceiling or unconfirmed evidence is excluded and privately alerted',async()=>{
  const mutations=[(r:any)=>{r.tx_hash=hash('c')},(r:any)=>{r.payer_address=address('4')},(r:any)=>{r.order_trade='different'},(r:any)=>{r.trade_buyer='different'},(r:any)=>{r.use_authority='changed'},(r:any)=>{r.chain_id=4217},(r:any)=>{r.token_address=address('4')},(r:any)=>{r.chain_fee_evidence_json='{'},(r:any)=>{const terms=JSON.parse(r.payment_terms_json);terms.payment.max_gas_cost_wei='1';r.payment_terms_json=JSON.stringify(terms)}]
  for(const mutate of mutations){const original=record();mutate(original);const view=await inspect([original]);assert.equal(view.invalid_count,1);assert.equal(view.groups[0].buyer.total_fee_units,null);assert.equal(view.groups[0].buyer.known_fee_units,'0');assert.equal(view.alerts[0].code,'ORGANIZATION_CHAIN_FEE_INVARIANT')}
  const pending=await inspect([{...record(4217,'treasury'),status:'submitted'}]);assert.equal(pending.invalid_count,1)
  const unsupported=record();unsupported.payment_terms_json='{}';const view=await inspect([unsupported]);assert.equal(view.unclassified_record_count,1);assert.equal(view.healthy,false)
})

test('bounded unavailable fee storage fails closed and decimal formatting preserves smallest and large original amounts',async()=>{
  await assert.rejects(inspect(Array(10001).fill(record())),/ORGANIZATION_CHAIN_FEE_OBSERVATIONS_UNAVAILABLE/)
  await assert.rejects(inspectOrganizationChainFeeHealth({execute:async()=>{throw Error('Unavailable original storage')}}))
  assert.equal(formatChainFeeUnits('1',18),'0.000000000000000001');assert.equal(formatChainFeeUnits('21',6),'0.000021')
  assert.equal(formatChainFeeUnits('184467440737095516160000',18),'184467.44073709551616');assert.equal(formatChainFeeUnits('0',6),'0')
  for(const value of ['1e18','0001','-1'])assert.throws(()=>formatChainFeeUnits(value,18))
})
