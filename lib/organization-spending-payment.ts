import 'server-only'
import { and, eq, isNull, or } from 'drizzle-orm'
import { createPublicClient, erc20Abi, http, parseUnits, type Address } from 'viem'
import { db } from './db'
import { buyer_evm_payment_claims, buyer_mpp_payment_claims, evm_payment_intents, organization_spending_payment_claims as claims, payment_receipts,
  organization_spending_mpp_claims, organization_task_payment_claims, organization_task_mpp_claims } from './schema'
import { originalSpendingPayment, spendingFundingEligibility, spendingPaymentTerms } from './organization-spending-accounts'
import { purchasingTransaction, PurchasingError, type PurchasingSource } from './organization-purchasing-transaction'
import { inspectSignedEvmPayment, assertBuyerWalletReserve } from './buyer-signed-transaction.mjs'
import { verifyEvmPaymentProof } from './evm-payment-proof'
import { serviceFundingEligibility } from './service-funding-eligibility'
import { getNewPaymentControl } from './payment-control'
import { findAcceptedToken, explicitRpcUrl } from './payment-config'
import type { BuyerPaymentClaimInput } from './buyer-payment-claim'

/** Cross-family wallet collisions are checked in the same transaction as the immutable claim. */
export async function spendingWalletConflict(source:PurchasingSource,chain:number,payer:string,nonce:number){
  for (const family of [claims, organization_spending_mpp_claims, organization_task_payment_claims, organization_task_mpp_claims] as const) {
    const [row] = await source.select({ state: family.state }).from(family).where(and(eq(family.chain_id, chain),
      eq(family.payer_address, payer), or(eq(family.state, 'claimed'), eq(family.nonce, nonce)))).limit(1)
    if (row) return row.state === 'claimed' ? 'BUYER_WALLET_PAYMENT_UNRECONCILED' : 'BUYER_WALLET_NONCE_ALREADY_CLAIMED'
  }
  return null
}
export async function claimSpendingEvmPayment(tradeId:string,buyerId:string,input:BuyerPaymentClaimInput){
  return purchasingTransaction(async tx=>{
    const original=await originalSpendingPayment(tx,tradeId)
    if(!original||original.account.version!==2||original.trade.buyer_id!==buyerId||original.account.id!==input.mandate_id||original.trade.payment_rail!=='evm')throw new PurchasingError('BUYER_PAYMENT_SCOPE_MISMATCH')
    const {account,trade}=original,{payment,token_decimals,token_usd_price}=spendingPaymentTerms(account)
    if(payment.rail!=='evm')throw new PurchasingError('SPENDING_PAYMENT_TERMS_MISMATCH')
    const [intent]=await tx.select().from(evm_payment_intents).where(and(eq(evm_payment_intents.id,input.intent_id),eq(evm_payment_intents.trade_id,tradeId))).limit(1)
    if(!intent||!intent.buyer_operation_id||intent.buyer_operation_id!==input.buyer_operation_id)throw new PurchasingError('BUYER_OPERATION_CONFLICT')
    if(intent.token_decimals!==token_decimals||intent.token_usd_price!==token_usd_price||intent.token_amount!==parseUnits((trade.total_cost/token_usd_price).toFixed(token_decimals),token_decimals).toString())throw new PurchasingError('SPENDING_PAYMENT_TERMS_MISMATCH')
    let checked
    try{checked=await inspectSignedEvmPayment(input.serialized_transaction,intent,payment)}catch(error){throw new PurchasingError(error instanceof Error?error.message:'BUYER_TRANSACTION_SCOPE_MISMATCH')}
    if(!await verifyEvmPaymentProof(intent,checked.tx_hash,input.payer_signature))throw new PurchasingError('PAYER_AUTHORIZATION_INVALID',403)
    const [prior]=await tx.select().from(claims).where(eq(claims.intent_id,intent.id)).limit(1)
    if(prior&&(prior.tx_hash!==checked.tx_hash||prior.account_id!==account.id||prior.trade_id!==tradeId||prior.authority_hash!==account.authority_hash
      ||prior.chain_id!==checked.chain_id||prior.payer_address!==checked.payer_address||prior.nonce!==checked.nonce
      ||prior.maximum_execution_gas_cost_wei!==checked.maximum_execution_gas_cost_wei||!['claimed','confirmed'].includes(prior.state)))throw new PurchasingError('PAYMENT_TRANSACTION_CONFLICT')
    if(intent.tx_hash&&intent.tx_hash!==checked.tx_hash)throw new PurchasingError('PAYMENT_TRANSACTION_CONFLICT')
    const reason=prior?.state==='confirmed'||trade.status!=='pending'||!trade.payment_due_at||Date.parse(trade.payment_due_at)<=Date.now()?'CHECKOUT_CLOSED'
      :(await getNewPaymentControl()).paused?'NEW_PAYMENTS_PAUSED':await spendingFundingEligibility(trade,tx,{rail:'evm',chainId:intent.chain_id,tokenAddress:intent.token_address,payerAddress:intent.payer_address,treasuryAddress:intent.treasury_address})||await serviceFundingEligibility(trade,tx)
    if(reason){if(prior)return {claim:prior,send_allowed:false,idempotent:true,state:'recover_existing_payment'};throw new PurchasingError(reason)}
    if(!prior){
      for(const family of [buyer_evm_payment_claims,buyer_mpp_payment_claims] as const){
        const [other]=await tx.select({state:family.state}).from(family).where(and(eq(family.chain_id,checked.chain_id),eq(family.payer_address,checked.payer_address),or(eq(family.state,'claimed'),eq(family.nonce,checked.nonce)))).limit(1)
        if(other)throw new PurchasingError(other.state==='claimed'?'BUYER_WALLET_PAYMENT_UNRECONCILED':'BUYER_WALLET_NONCE_ALREADY_CLAIMED')
      }
      const conflict=await spendingWalletConflict(tx,checked.chain_id,checked.payer_address,checked.nonce);if(conflict)throw new PurchasingError(conflict)
    }
    const token=findAcceptedToken(payment.chain_id,payment.token_address)
    const rpcUrl=token?explicitRpcUrl(token):null
    if(!token||!rpcUrl)throw new PurchasingError('MANDATE_PAYMENT_RAIL_UNAVAILABLE')
    const client=createPublicClient({transport:http(rpcUrl,{retryCount:0,timeout:5000,fetchOptions:{redirect:'error'}})})
    try{
      if(await client.getChainId()!==payment.chain_id)throw Error('BUYER_WALLET_CHAIN_MISMATCH')
      const [tokenBalance,nativeBalance]=await Promise.all([client.readContract({address:payment.token_address as Address,abi:erc20Abi,functionName:'balanceOf',args:[payment.payer_address as Address]}),client.getBalance({address:payment.payer_address as Address})])
      assertBuyerWalletReserve({tokenBalance,nativeBalance,paymentAmount:BigInt(intent.token_amount),gasCost:BigInt(checked.maximum_execution_gas_cost_wei),payment})
    }catch(error){
      if(prior)return {claim:prior,send_allowed:false,idempotent:true,state:'recover_existing_payment'}
      throw new PurchasingError(error instanceof Error&&error.message.startsWith('BUYER_')?error.message:'BUYER_WALLET_RESERVE_UNAVAILABLE',503)
    }
    if(prior)return {claim:prior,send_allowed:true,idempotent:true,state:'submit_exact_transaction'}
    if(intent.tx_hash)throw new PurchasingError('PAYMENT_ALREADY_SUBMITTED_RECOVER_ONLY')
    const [claim]=await tx.insert(claims).values({intent_id:intent.id,account_id:account.id,trade_id:tradeId,authority_hash:account.authority_hash,
      chain_id:checked.chain_id,payer_address:checked.payer_address,nonce:checked.nonce,tx_hash:checked.tx_hash,maximum_execution_gas_cost_wei:checked.maximum_execution_gas_cost_wei}).returning()
    const [attached]=await tx.update(evm_payment_intents).set({tx_hash:checked.tx_hash,payer_signature:input.payer_signature}).where(and(eq(evm_payment_intents.id,intent.id),or(isNull(evm_payment_intents.tx_hash),eq(evm_payment_intents.tx_hash,checked.tx_hash)))).returning()
    if(!attached)throw new PurchasingError('PAYMENT_TRANSACTION_CONFLICT')
    return {claim,send_allowed:true,idempotent:false,state:'submit_exact_transaction'}
  })
}
export async function recordSpendingPayment(source:PurchasingSource,tradeId:string){
  await (await import('./organization-spending-tempo-payment')).recordOrganizationTempoPayment(source,tradeId)
  const [intent]=await source.select().from(evm_payment_intents).where(eq(evm_payment_intents.trade_id,tradeId)).limit(1)
  const [receipt]=await source.select().from(payment_receipts).where(eq(payment_receipts.trade_id,tradeId)).limit(1)
  if(intent?.tx_hash&&receipt?.tx_hash===intent.tx_hash&&receipt.payment_rail==='evm'&&receipt.chain_id===intent.chain_id
    &&receipt.payer_address?.toLowerCase()===intent.payer_address&&receipt.token_address?.toLowerCase()===intent.token_address&&receipt.token_amount===intent.token_amount){
    await source.update(claims).set({state:'confirmed'}).where(and(eq(claims.intent_id,intent.id),eq(claims.tx_hash,intent.tx_hash)))
  }
}
export async function inspectSpendingEvmClaim(intentId:string){return (await db.select().from(claims).where(eq(claims.intent_id,intentId)).limit(1))[0]??null}
