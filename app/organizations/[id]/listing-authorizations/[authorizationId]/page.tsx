'use client'
import { use, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { OrganizationListingAuthorization, OrganizationListingDecision } from '@/sdk/typescript/src/index'
import styles from '@/app/organizations/enterprise.module.css'

const usd = (minor:number) => `$${(minor/100).toFixed(2)} USD`
const utc = (value:string|null) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : 'Not set'

export default function OrganizationListingReview({params}:{params:Promise<{id:string;authorizationId:string}>}) {
  const {id,authorizationId}=use(params),path=`/api/organizations/${encodeURIComponent(id)}/listing-authorizations/${encodeURIComponent(authorizationId)}`
  const [review,setReview]=useState<OrganizationListingAuthorization|null>(null),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false)
  const [error,setError]=useState(''),[message,setMessage]=useState(''),[observed,setObserved]=useState(0)
  const generation=useRef(0),working=useRef(false),decision=useRef<OrganizationListingDecision|null>(null)
  const key=`clawdmarket-listing-review:${id}:${authorizationId}`
  const load=useCallback(async()=>{
    const current=++generation.current;setReview(null);setConfirmed(false);setMessage('')
    try {
      const response=await fetch(path,{credentials:'include',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)})
      if(!response.ok)throw Error([401,403,404].includes(response.status)?'Sign in as the current owner or selected reviewer to inspect this private listing.':'Inspection is unavailable. Refresh before making a decision.')
      const {authorization:a}=await response.json() as {authorization:OrganizationListingAuthorization}
      if(a.id!==authorizationId||a.organization_id!==id||!['owner','reviewer'].includes(a.viewer_role)||!['pending','approved','revoked'].includes(a.state)
        ||!['1','2'].includes(String(a.version))||!/^[a-f0-9]{64}$/.test(a.authority_hash)||a.terms.version!==a.version||a.listing_id!==a.terms.listing.id
        ||a.terms.explicit_acceptance!==true||!Number.isFinite(Date.parse(a.terms.expires_at)))throw Error('The original listing review is unavailable or changed.')
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
      let body:OrganizationListingDecision|undefined
      if(approve){
        let saved=decision.current
        if(!saved){const source=sessionStorage.getItem(key);if(source)saved=JSON.parse(source) as OrganizationListingDecision}
        if(saved&&(Object.keys(saved).some(field=>!['version','client_reference','authority_hash','approve'].includes(field))||saved.version!==original.version||saved.approve!==true||saved.authority_hash!==original.authority_hash||!/^[A-Za-z0-9._:-]{8,128}$/.test(saved.client_reference)))throw Error('The original saved decision differs. Inspect its status before continuing.')
        body=saved??{version:original.version,client_reference:crypto.randomUUID(),authority_hash:original.authority_hash,approve:true}
        // Retain only the original decision identity, never private requirements, account tokens or payment secrets.
        sessionStorage.setItem(key,JSON.stringify(body));decision.current=body
      }
      const csrf=decodeURIComponent(document.cookie.split('; ').find(cookie=>cookie.startsWith('csrf-token='))?.slice(11)||'')
      const response=await fetch(path+(approve?'/approval':''),{method:approve?'POST':'DELETE',credentials:'include',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},...(body?{body:JSON.stringify(body)}:{})})
      if(current!==generation.current)return
      if(!response.ok)throw Error('The decision was not confirmed. Refresh the original review; retain the saved reference.')
      const result=await response.json() as {authorization:OrganizationListingAuthorization}
      if(current!==generation.current)return
      if(result.authorization?.id!==original.id||result.authorization.authority_hash!==original.authority_hash)throw Error('Original listing identity did not match. Refresh before continuing.')
      await load();setMessage(result.authorization.state==='revoked'?'Fresh listing spending is revoked. Original payments, delivery and refunds remain recoverable.':'Original listing approval recorded. Buyer funding and delivery acceptance remain separate.')
    }catch(cause){if(current===generation.current){setReview(null);setConfirmed(false);setError(cause instanceof Error&&!(cause instanceof TypeError)&&!(cause instanceof DOMException)?cause.message:'Response unavailable. Refresh the original review before continuing.')}}
    finally{working.current=false;setBusy(false)}
  }
  const terms=review?.terms,payment=terms?.payment,expired=!!terms&&Date.parse(terms.expires_at)<=Date.now()
  return <main className={`${styles.page} ${styles.workspace}`}>
    <Link href={`/organizations/${encodeURIComponent(id)}`}>Organization workspace</Link>
    <h1>Review organization listing</h1>
    <p>The owner proposes one fixed-price public listing and a private delivery agreement. The selected independent reviewer checks its original scope and payment limits before the assigned buyer creates the original checkout.</p>
    <button disabled={busy} onClick={()=>void load()}>Refresh original review</button>
    {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
    {review&&terms&&payment&&<>
      <section aria-label="Original public listing"><h2>Original public listing</h2><p>Status: {review.state}{expired?' · expired':''}</p>
        <h3>{terms.listing.title}</h3><p>{terms.listing.description}</p>
        <dl>{[['Listing',review.listing_id],['Seller',terms.listing.seller_id],['Category',terms.listing.category],['Assigned buyer',review.buyer_id],
          ['Department',`${review.team_id??'Organization'} · ${review.cost_center}`],['Authority expires (UTC)',utc(terms.expires_at)],
          ['Original item price',`$${terms.listing.item_price_usd.toFixed(2)} USD`],['Exact total including fees',usd(terms.total_minor)]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        <p>A pending review takes no funds and does not reserve inventory against other buyers. Once consumed, this original obligation cannot be replaced after cancellation or refund.</p>
      </section>
      <section aria-label="Original delivery requirements"><h2>Original delivery requirements</h2>
        <p>Output format: {terms.delivery.output_format}. Minimum sources: {terms.delivery.minimum_sources}.</p>
        <p>Required JSON keys: {terms.delivery.required_json_keys.join(', ')||'None'}</p>
        <ul>{terms.delivery.acceptance_criteria.map((criterion,index)=><li key={index}>{criterion}</li>)}</ul>
        <p>Delivery remains private to the original participants. Structure checks do not accept the work; the buyer must explicitly approve the exact delivery before settlement.</p>
      </section>
      <section aria-label="Frozen payment terms"><h2>Frozen payment terms</h2>
        <dl>{[['Rail',payment.rail==='mpp'?'Tempo':'Ethereum L1'],['Chain',payment.chain_id],['Token',payment.token_address],['Token decimals',terms.token_decimals],['Token USD price',terms.token_usd_price],['Payer',payment.payer_address],['Treasury',payment.treasury_address],['Token reserve (base units)',payment.minimum_token_reserve_units],
          ...(payment.rail==='mpp'?[['Fee token',payment.fee_token_address],['Fee reserve (pathUSD base units)',payment.minimum_fee_token_reserve_units],['Per-payment fee ceiling (pathUSD base units)',payment.max_fee_token_cost_units]]:[['Native reserve (wei)',payment.minimum_native_reserve_wei],['Per-payment gas ceiling (wei)',payment.max_gas_cost_wei]]),
          [`Lifetime fee ceiling (${payment.rail==='mpp'?'pathUSD base units':'wei'})`,terms.max_lifetime_chain_fee_units],['Daily / monthly / lifetime gross ceilings',`${usd(terms.max_daily_minor)} / ${usd(terms.max_monthly_minor)} / ${usd(terms.max_lifetime_minor)}`]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        <p>Original listing use shares organization and buyer gross and same-currency fee history with reviewed routes, workflows and tasks. Refunds and cancellation do not replenish this exposure.</p>
      </section>
      {review.state==='pending'&&review.viewer_role==='reviewer'&&!expired&&<section aria-label="Independent approval">
        <label><input type="checkbox" checked={confirmed} disabled={busy} onChange={event=>setConfirmed(event.target.checked)}/>I reviewed the original listing, delivery requirements, exact quote and payment limits.</label>
        <button disabled={busy||!confirmed} onClick={()=>void mutate(true)}>Approve original listing</button>
      </section>}
      {review.state==='pending'&&review.viewer_role==='owner'&&<p>The selected independent reviewer must approve this proposal.</p>}
      {review.state!=='revoked'&&<button disabled={busy} onClick={()=>void mutate(false)}>Revoke fresh spending</button>}
    </>}
  </main>
}
