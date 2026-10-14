'use client'
import { use, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { OrganizationTaskAuthorization, OrganizationTaskDecision } from '@/sdk/typescript/src/index'
import styles from '@/app/organizations/enterprise.module.css'

const usd = (minor:number) => `$${(minor/100).toFixed(2)} USD`
const utc = (value:string|null) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : 'Not set'

export default function OrganizationTaskReview({params}:{params:Promise<{id:string;authorizationId:string}>}) {
  const {id,authorizationId}=use(params),path=`/api/organizations/${encodeURIComponent(id)}/task-authorizations/${encodeURIComponent(authorizationId)}`
  const [review,setReview]=useState<OrganizationTaskAuthorization|null>(null),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false)
  const [error,setError]=useState(''),[message,setMessage]=useState(''),[observed,setObserved]=useState(0)
  const generation=useRef(0),working=useRef(false),decision=useRef<OrganizationTaskDecision|null>(null)
  const key=`clawdmarket-task-review:${id}:${authorizationId}`
  const load=useCallback(async()=>{
    const current=++generation.current;setReview(null);setConfirmed(false);setMessage('')
    try {
      const response=await fetch(path,{credentials:'include',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)})
      if(!response.ok)throw Error([401,403,404].includes(response.status)?'Sign in as the current owner or selected reviewer to inspect this private task.':'Inspection is unavailable. Refresh before making a decision.')
      const {authorization:a}=await response.json() as {authorization:OrganizationTaskAuthorization}
      if(a.id!==authorizationId||a.organization_id!==id||!['owner','reviewer'].includes(a.viewer_role)||!['pending','approved','revoked'].includes(a.state)
        ||!['1','2'].includes(String(a.version))||!/^[a-f0-9]{64}$/.test(a.authority_hash)||a.terms.version!==a.version||a.task_id!==a.terms.task.id
        ||a.winning_bid_id!==a.terms.bid.id||a.winning_bid_id!==a.terms.task.winning_bid_id||a.terms.explicit_acceptance!==true||!Number.isFinite(Date.parse(a.terms.expires_at)))throw Error('The original task review could not be verified.')
      if(current===generation.current){setReview(a);setObserved(Date.now());setError('')}
    }catch(cause){if(current===generation.current){setReview(null);setError(cause instanceof Error?cause.message:'Inspection unavailable.')}}
  },[path,id,authorizationId])
  const invalidate=useCallback(()=>{generation.current++},[])
  useEffect(()=>{decision.current=null;void load();return invalidate},[load,invalidate])
  useEffect(()=>{
    const clear=()=>{generation.current++;setReview(null);setConfirmed(false);decision.current=null;setMessage('');setError('Refresh and sign in to inspect the original review.')}
    const visibility=()=>{if(document.hidden)clear()}
    window.addEventListener('focus',clear);document.addEventListener('visibilitychange',visibility)
    const timer=setTimeout(()=>{generation.current++;setReview(null);setConfirmed(false);setMessage('Review expired. Refresh current state before deciding.')},60000)
    return()=>{clearTimeout(timer);window.removeEventListener('focus',clear);document.removeEventListener('visibilitychange',visibility)}
  },[observed])
  const mutate=async(approve:boolean)=>{
    if(!review||working.current||Date.now()-observed>=60000||approve&&!confirmed)return
    const original=review,current=++generation.current
    working.current=true;setBusy(true);setError('');setMessage('')
    try {
      let body:OrganizationTaskDecision|undefined
      if(approve){
        let saved=decision.current
        if(!saved){const source=sessionStorage.getItem(key);if(source)saved=JSON.parse(source) as OrganizationTaskDecision}
        if(saved&&(Object.keys(saved).some(field=>!['version','client_reference','authority_hash','approve'].includes(field))||saved.version!==original.version||saved.approve!==true||saved.authority_hash!==original.authority_hash||!/^[A-Za-z0-9._:-]{8,128}$/.test(saved.client_reference)))throw Error('The original saved decision differs. Inspect its status before continuing.')
        body=saved??{version:original.version,client_reference:crypto.randomUUID(),authority_hash:original.authority_hash,approve:true}
        // Retain only the original decision identity, never private requirements, account tokens or payment secrets.
        sessionStorage.setItem(key,JSON.stringify(body));decision.current=body
      }
      const csrf=decodeURIComponent(document.cookie.split('; ').find(cookie=>cookie.startsWith('csrf-token='))?.slice(11)||'')
      const response=await fetch(path+(approve?'/approval':''),{method:approve?'POST':'DELETE',credentials:'include',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},...(body?{body:JSON.stringify(body)}:{})})
      if(current!==generation.current)return
      if(!response.ok)throw Error('The decision was not confirmed. Refresh the original review; retain the saved reference.')
      const result=await response.json() as {authorization:OrganizationTaskAuthorization}
      if(current!==generation.current)return
      if(result.authorization?.id!==original.id||result.authorization.authority_hash!==original.authority_hash)throw Error('Original task identity did not match. Refresh before continuing.')
      await load();setMessage(result.authorization.state==='revoked'?'Fresh task spending is revoked. Original payments, delivery and refunds remain recoverable.':'Original task approval recorded. Buyer funding and delivery acceptance remain separate.')
    }catch(cause){if(current===generation.current){setReview(null);setConfirmed(false);setError(cause instanceof Error&&!(cause instanceof TypeError)&&!(cause instanceof DOMException)?cause.message:'Response unavailable. Refresh the original review before continuing.')}}
    finally{working.current=false;setBusy(false)}
  }
  const terms=review?.terms,payment=terms?.payment,expired=!!terms&&Date.parse(terms.expires_at)<=Date.now()
  return <main className={`${styles.page} ${styles.workspace}`}>
    <Link href={`/organizations/${encodeURIComponent(id)}`}>Organization workspace</Link>
    <h1>Review organization task</h1>
    <p>The owner proposes one accepted task bid. The selected independent reviewer checks its original scope and payment limits before the assigned buyer creates the original checkout.</p>
    <button disabled={busy} onClick={()=>void load()}>Refresh original review</button>
    {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
    {review&&terms&&payment&&<>
      <section aria-label="Original accepted task"><h2>Original accepted task</h2><p>Status: {review.state}{expired?' · expired':''}</p>
        <h3>{terms.task.title}</h3><p>{terms.task.description}</p>
        <dl>{[['Task',review.task_id],['Original poster',terms.task.poster_agent_id],['Assigned buyer',review.buyer_id],['Assigned provider',terms.task.assigned_agent_id],['Accepted bid',review.winning_bid_id],['Department',`${review.team_id??'Organization'} · ${review.cost_center}`],['Task deadline (UTC)',utc(terms.task.deadline_at)],['Task expires (UTC)',utc(terms.task.expires_at)],['Authority expires (UTC)',utc(terms.expires_at)]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        <p>Required capabilities: {terms.task.required_capabilities.join(', ')||'None specified'}</p>
        <p>One original obligation. A changed bid, quote or scope requires fresh review and cannot replace an existing trade.</p>
      </section>
      <section aria-label="Original accepted bid"><h2>Original accepted bid</h2><p>Bidder: {terms.bid.agent_id}</p><p>{terms.bid.proposal}</p>
        <dl><div><dt>Accepted workspace price</dt><dd>${(terms.workspace.agreed_price??terms.bid.price_usd).toFixed(2)} USD</dd></div><div><dt>Exact total including fees</dt><dd>{usd(terms.total_minor)}</dd></div><div><dt>Estimated hours</dt><dd>{terms.bid.estimated_hours??'Not supplied'}</dd></div></dl>
        {terms.bid.counter_offer&&<details><summary>Original counteroffer</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(terms.bid.counter_offer,null,2)}</pre></details>}
      </section>
      <section aria-label="Original delivery requirements"><h2>Original delivery requirements</h2>
        <p>Output format: {terms.workspace.requirements.output_format}. Minimum sources: {terms.workspace.requirements.minimum_sources}.</p>
        <p>Required JSON keys: {terms.workspace.requirements.required_json_keys.join(', ')||'None'}</p>
        <ul>{terms.workspace.requirements.acceptance_criteria.map((criterion,index)=><li key={index}>{criterion}</li>)}</ul>
        <p>Delivery remains private to the original participants. Structure checks do not accept the work; the buyer must explicitly approve the exact delivery before settlement.</p>
      </section>
      <section aria-label="Frozen payment terms"><h2>Frozen payment terms</h2>
        <dl>{[['Rail',payment.rail==='mpp'?'Tempo':'Ethereum L1'],['Chain',payment.chain_id],['Token',payment.token_address],['Token decimals',terms.token_decimals],['Token USD price',terms.token_usd_price],['Payer',payment.payer_address],['Treasury',payment.treasury_address],['Token reserve (base units)',payment.minimum_token_reserve_units],
          ...(payment.rail==='mpp'?[['Fee token',payment.fee_token_address],['Fee reserve (pathUSD base units)',payment.minimum_fee_token_reserve_units],['Per-payment fee ceiling (pathUSD base units)',payment.max_fee_token_cost_units]]:[['Native reserve (wei)',payment.minimum_native_reserve_wei],['Per-payment gas ceiling (wei)',payment.max_gas_cost_wei]]),
          [`Lifetime fee ceiling (${payment.rail==='mpp'?'pathUSD base units':'wei'})`,terms.max_lifetime_chain_fee_units],['Daily / monthly / lifetime gross ceilings',`${usd(terms.max_daily_minor)} / ${usd(terms.max_monthly_minor)} / ${usd(terms.max_lifetime_minor)}`]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        <p>Original task use shares organization and buyer gross and same-currency fee history with reviewed routes and workflows. Refunds and cancellation do not replenish this exposure.</p>
        {review.use&&<p>Original trade: {review.use.trade_id}. Gross consumed: {usd(review.use.amount_minor)}. Reserved fee: {review.use.maximum_chain_fee_units} {payment.rail==='mpp'?'pathUSD base units':'wei'}.</p>}
      </section>
      {review.state==='pending'&&review.viewer_role==='reviewer'&&!expired&&<section aria-label="Independent approval">
        <label><input type="checkbox" checked={confirmed} disabled={busy} onChange={event=>setConfirmed(event.target.checked)}/>I reviewed the original accepted bid, delivery requirements, exact quote and payment limits.</label>
        <button disabled={busy||!confirmed} onClick={()=>void mutate(true)}>Approve original task</button>
      </section>}
      {review.state==='pending'&&review.viewer_role==='owner'&&<p>The selected independent reviewer must approve this proposal.</p>}
      {review.state!=='revoked'&&<button disabled={busy} onClick={()=>void mutate(false)}>Revoke fresh spending</button>}
    </>}
  </main>
}
