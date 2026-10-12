'use client'
import { use, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import styles from '@/app/organizations/enterprise.module.css'

type Review = {
  id:string; organization_id:string; authority_hash:string; state:'pending'|'approved'|'revoked'; viewer_role:'owner'|'reviewer'
  buyer_id:string; team_id:string|null; cost_center:string
  route:{objective:string; input:Record<string,unknown>; required_capabilities:string[]; candidates:Array<{
    service_id:string; pricing:{estimated_total:string}; explanation:string[]; eligibility:{approval_required?:boolean}
  }>}
  terms:{max_daily_minor:number; max_monthly_minor:number; max_lifetime_minor:number; max_lifetime_gas_cost_wei:string}
  mandate:{id:string; expires_at:string; terms_hash:string; terms:{max_aggregate:string; max_per_execution:string;
    max_attempts:number; max_retry_budget:string; payment:{chain_id:number; token_address:string; payer_address:string;
      treasury_address:string; minimum_token_reserve_units:string; minimum_native_reserve_wei:string; max_gas_cost_wei:string}}}
  use:{amount_minor:number;maximum_gas_cost_wei:string}|null
}
type Decision={version:1;client_reference:string;authority_hash:string;approve:true}
const usd=(minor:number)=>`$${(minor/100).toFixed(2)} USD`

export default function OrganizationRouteReview({params}:{params:Promise<{id:string;authorizationId:string}>}) {
  const {id,authorizationId}=use(params),path=`/api/organizations/${encodeURIComponent(id)}/route-authorizations/${encodeURIComponent(authorizationId)}`
  const [review,setReview]=useState<Review|null>(null),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false)
  const [error,setError]=useState(''),[message,setMessage]=useState(''),[observed,setObserved]=useState(0)
  const generation=useRef(0),working=useRef(false),decision=useRef<Decision|null>(null)
  const key=`clawdmarket-route-review:${id}:${authorizationId}`
  const load=useCallback(async()=>{
    const current=++generation.current;setReview(null);setConfirmed(false)
    try {
      const response=await fetch(path,{credentials:'include',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)})
      if(!response.ok)throw Error([401,403,404].includes(response.status)?'Sign in as the current owner or selected reviewer to inspect this private route.':'Inspection is unavailable. Refresh before making a decision.')
      const value=await response.json(),a=value.authorization as Review
      if(a.id!==authorizationId||a.organization_id!==id||!['owner','reviewer'].includes(a.viewer_role)||!/^[a-f0-9]{64}$/.test(a.authority_hash))throw Error('The original review could not be verified.')
      if(current===generation.current){setReview(a);setObserved(Date.now());setError('')}
    }catch(cause){if(current===generation.current){setReview(null);setError(cause instanceof Error?cause.message:'Inspection unavailable.')}}
  },[path,id,authorizationId])
  const invalidate=useCallback(()=>{generation.current++},[])
  useEffect(()=>{decision.current=null;void load();return invalidate},[load,invalidate])
  useEffect(()=>{
    const clear=()=>{generation.current++;setReview(null);setConfirmed(false);decision.current=null;setError('Refresh and sign in to inspect the original review.')}
    const visibility=()=>{if(document.hidden)clear()}
    window.addEventListener('focus',clear);document.addEventListener('visibilitychange',visibility)
    const timer=setTimeout(()=>{setReview(null);setConfirmed(false);setMessage('Review expired. Refresh current state before deciding.')},60000)
    return()=>{clearTimeout(timer);window.removeEventListener('focus',clear);document.removeEventListener('visibilitychange',visibility)}
  },[observed])
  const mutate=async(approve:boolean)=>{
    if(!review||working.current||Date.now()-observed>=60000||approve&&!confirmed)return
    working.current=true;setBusy(true);setError('');setMessage('')
    try {
      let body:Decision|undefined
      if(approve){
        let saved:Decision|null=decision.current
        if(!saved){const source=sessionStorage.getItem(key);if(source)saved=JSON.parse(source)}
        if(saved&&(saved.version!==1||saved.approve!==true||saved.authority_hash!==review.authority_hash||!saved.client_reference))throw Error('The original saved decision differs. Inspect its status before continuing.')
        body=saved??{version:1,client_reference:crypto.randomUUID(),authority_hash:review.authority_hash,approve:true}
        // Save only decision identity, never private work, account tokens or wallet secrets.
        sessionStorage.setItem(key,JSON.stringify(body));decision.current=body
      }
      const csrf=decodeURIComponent(document.cookie.split('; ').find(cookie=>cookie.startsWith('csrf-token='))?.slice(11)||'')
      const response=await fetch(path+(approve?'/approval':''),{method:approve?'POST':'DELETE',credentials:'include',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},...(body?{body:JSON.stringify(body)}:{})})
      if(!response.ok)throw Error('The decision was not confirmed. Refresh the original review; retain the saved reference.')
      const result=await response.json()
      if(result.authorization?.id!==review.id)throw Error('Original review identity did not match. Refresh before continuing.')
      await load();setMessage(result.authorization.state==='revoked'?'Fresh spending is revoked. Original payments and refunds remain recoverable.':'Original approval recorded. Buyer funding and delivery acceptance remain separate.')
    }catch(cause){setReview(null);setConfirmed(false);setError(cause instanceof Error?cause.message:'Response unavailable. Refresh the original review before continuing.')}
    finally{working.current=false;setBusy(false)}
  }
  const payment=review?.mandate.terms.payment,expired=!!review&&Date.parse(review.mandate.expires_at)<=Date.now()
  return <main className={`${styles.page} ${styles.workspace}`}>
    <Link href={`/organizations/${encodeURIComponent(id)}`}>Organization workspace</Link>
    <h1>Review organization route</h1>
    <p>The owner proposes one Ethereum L1 purchase. The selected independent reviewer approves its exact scope before checkout. Delivery still requires an explicit buyer decision.</p>
    <button disabled={busy} onClick={()=>void load()}>Refresh original review</button>
    {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
    {review&&payment&&<>
      <section aria-label="Original purchase scope"><h2>Original purchase scope</h2><p>Status: {review.state}{expired?' · expired':''}</p>
        <p>{review.route.objective}</p><p>Capabilities: {review.route.required_capabilities.join(', ')}</p>
        <dl><div><dt>Department</dt><dd>{review.team_id??'Organization'} · {review.cost_center}</dd></div>
          <div><dt>Purchase ceiling</dt><dd>${review.mandate.terms.max_per_execution} USD</dd></div>
          <div><dt>Daily / monthly / lifetime gross ceilings</dt><dd>{usd(review.terms.max_daily_minor)} / {usd(review.terms.max_monthly_minor)} / {usd(review.terms.max_lifetime_minor)}</dd></div>
          <div><dt>Attempts / paid retry budget</dt><dd>{review.mandate.terms.max_attempts} / ${review.mandate.terms.max_retry_budget}</dd></div>
          <div><dt>Expires (UTC)</dt><dd><time dateTime={review.mandate.expires_at}>{new Date(review.mandate.expires_at).toISOString()}</time></dd></div></dl>
        <details><summary>Private work input</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(review.route.input,null,2)}</pre></details>
      </section>
      <section aria-label="Frozen payment terms"><h2>Frozen payment terms</h2>
        <dl>{[['Chain',payment.chain_id],['Token',payment.token_address],['Payer',payment.payer_address],['Treasury',payment.treasury_address],['Token reserve (base units)',payment.minimum_token_reserve_units],['Native reserve (wei)',payment.minimum_native_reserve_wei],['Per-payment gas ceiling (wei)',payment.max_gas_cost_wei],['Lifetime gas ceiling (wei)',review.terms.max_lifetime_gas_cost_wei]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        <p>Refunds and cancellation do not replenish gross or reserved fee exposure.</p>
        {review.use&&<p>Original gross consumed: {usd(review.use.amount_minor)}. Original reserved gas: {review.use.maximum_gas_cost_wei} wei.</p>}
      </section>
      <section aria-label="Frozen providers"><h2>Frozen providers</h2>{review.route.candidates.map(candidate=><article key={candidate.service_id}>
        <h3>Service {candidate.service_id}</h3><p>Quoted total: ${candidate.pricing.estimated_total} USD</p>
        {candidate.eligibility.approval_required&&<p>Independent purchasing approval required.</p>}
        <ul>{candidate.explanation.map((explanation,index)=><li key={index}>{explanation}</li>)}</ul>
      </article>)}</section>
      {review.state==='pending'&&review.viewer_role==='reviewer'&&!expired&&<section aria-label="Independent approval">
        <label><input type="checkbox" checked={confirmed} disabled={busy} onChange={event=>setConfirmed(event.target.checked)}/>I reviewed the original input, providers, payment terms and limits.</label>
        <button disabled={busy||!confirmed} onClick={()=>void mutate(true)}>Approve original route</button>
      </section>}
      {review.state==='pending'&&review.viewer_role==='owner'&&<p>The selected independent reviewer must approve this proposal.</p>}
      {review.state!=='revoked'&&<button disabled={busy} onClick={()=>void mutate(false)}>Revoke fresh spending</button>}
    </>}
  </main>
}
