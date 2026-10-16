'use client'
import { use, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { inspectBuyerArtifact } from '@/lib/buyer-review-artifact'
import type { OrganizationListingRequirements } from '@/sdk/typescript/src/index'
import styles from '@/app/organizations/enterprise.module.css'
import workStyles from './work.module.css'

type Delivery = { id:string;content_hash:string;summary:string;artifact:unknown;delivery_url:string|null }
type Acceptance = { mode:string;accepted:boolean;auto_confirm_enabled:boolean;error_code?:string }
type Work = { id:string;viewer:{is_buyer:boolean;is_seller:boolean};workspace:{
  trade:{id:string;buyer_id:string;seller_id:string;status:string;payout_status:string};
  reviewed_listing:{listing_id:string;title:string;description:string;requirements:OrganizationListingRequirements};delivery:Delivery|null;acceptance:Acceptance } }
type Verification = {trade_id:string;delivery:{id:string;content_hash:string}|null;acceptance:Acceptance;categories:Record<string,boolean>;
  artifacts:Array<{id:string;delivery_id:string|null;sha256:string;media_type:string;size_bytes:number;name:string}>}
type View = {work:Work;verification:Verification;artifacts:Array<{id:string;name:string;text:string}>;at:number}

export default function OriginalListingWork({params}:{params:Promise<{id:string}>}) {
  const {id}=use(params),path=`/api/trades/${encodeURIComponent(id)}`
  const [view,setView]=useState<View|null>(null),[error,setError]=useState(''),[message,setMessage]=useState(''),[checked,setChecked]=useState(false),[busy,setBusy]=useState(false)
  const generation=useRef(0),working=useRef(false),abort=useRef<AbortController|null>(null)
  const clear=useCallback(()=>{generation.current++;abort.current?.abort();setView(null);setChecked(false)},[])
  const load=useCallback(async()=>{
    clear();const current=++generation.current,controller=new AbortController();abort.current=controller;setError('');setMessage('')
    const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])
    const read=async<T,>(url:string):Promise<T>=>{const response=await fetch(url,{credentials:'include',cache:'no-store',redirect:'error',signal});if(!response.ok)throw Error([401,403,404].includes(response.status)?'access':'unavailable');return response.json()}
    try {
      const work=await read<Work>(path+'/listing-work'),verification=await read<Verification>(path+'/verification')
      const {trade,delivery,acceptance}=work.workspace
      if(trade.id!==id||work.id!==work.workspace.reviewed_listing.listing_id||(!work.viewer.is_buyer&&!work.viewer.is_seller)
        ||verification.trade_id!==id||acceptance.mode!=='explicit_buyer'||acceptance.auto_confirm_enabled!==false
        ||verification.acceptance.accepted!==acceptance.accepted||verification.delivery?.id!==delivery?.id
        ||verification.delivery?.content_hash!==delivery?.content_hash||delivery&&!/^[a-f0-9]{64}$/.test(delivery.content_hash))throw Error('changed')
      const currentArtifacts=verification.artifacts.filter(item=>item.delivery_id===delivery?.id)
      if(currentArtifacts.length>8||new Set(currentArtifacts.map(item=>item.id)).size!==currentArtifacts.length||currentArtifacts.reduce((total,item)=>total+item.size_bytes,0)>262144)throw Error('changed')
      const artifacts=[]
      for(const item of currentArtifacts)artifacts.push({id:item.id,name:item.name,text:await inspectBuyerArtifact(id,item,signal)})
      if(current===generation.current){setView({work,verification,artifacts,at:Date.now()});setChecked(false)}
    }catch(problem){if(current===generation.current){setView(null);setError(problem instanceof Error&&problem.message==='access'?'Sign in as an original participant to inspect this private listing purchase.':'Original work is unavailable or changed. Refresh before accepting.')}}
  },[clear,path,id])
  useEffect(()=>{void load();return clear},[load,clear])
  useEffect(()=>{const invalidate=()=>{clear();setError('Refresh original state before continuing.')};window.addEventListener('focus',invalidate);document.addEventListener('visibilitychange',invalidate)
    const timer=setTimeout(invalidate,60000);return()=>{window.removeEventListener('focus',invalidate);document.removeEventListener('visibilitychange',invalidate);clearTimeout(timer)}},[clear,view?.at])
  async function accept(){
    if(!view||working.current||!view.work.viewer.is_buyer||!view.work.workspace.delivery||view.work.workspace.trade.status!=='pending_release'
      ||view.work.workspace.acceptance.error_code||view.verification.acceptance.error_code||!checked)return
    if(Date.now()-view.at>=60000){clear();setError('Inspection expired. Refresh original state.');return}
    const hash=view.work.workspace.delivery.content_hash,current=++generation.current;working.current=true;setBusy(true);setView(null);setChecked(false);setError('');setMessage('')
    try {
      const csrf=decodeURIComponent(document.cookie.split('; ').find(cookie=>cookie.startsWith('csrf-token='))?.slice(11)||'')
      const response=await fetch(path+'/confirm',{method:'POST',credentials:'include',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({content_hash:hash})})
      if(current!==generation.current)return
      if(!response.ok)throw Error('The decision was not confirmed. Refresh the original delivery before continuing.')
      const result=await response.json();await load();setMessage(result.status==='settlement_processing'?'Original acceptance recorded; settlement is processing.':'Original command acknowledged. Inspect the recorded settlement status.')
    }catch{if(current===generation.current)setError('Response unavailable. Acceptance may have committed. Refresh original state; retain the exact delivery hash.')}
    finally{working.current=false;setBusy(false)}
  }
  const workspace=view?.work.workspace
  return <main className={`${styles.page} ${styles.workspace} ${workStyles.work}`}>
    <Link href="/dashboard?tab=trades">Trade history</Link><h1>Original listing work</h1>
    <p>Private original participants only. Review the agreed requirements and output before accepting its exact fingerprint.</p>
    <button disabled={busy} onClick={()=>void load()}>Refresh original state</button>
    {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
    {view&&workspace&&<>
      <section><h2>{workspace.reviewed_listing.title}</h2><p>{workspace.reviewed_listing.description}</p><p>Trade {id}</p>
        <p>Status: {workspace.trade.status} · Settlement: {workspace.trade.payout_status}</p>
        <h3>Agreed delivery</h3><pre>{JSON.stringify(workspace.reviewed_listing.requirements,null,2)}</pre>
        <p>Automatic confirmation is disabled. Structure and declared sources do not establish semantic accuracy or authorize payment.</p></section>
      {workspace.delivery?<section><h2>Original private delivery</h2><pre>{workspace.delivery.summary}</pre><pre>{JSON.stringify(workspace.delivery.artifact,null,2)}</pre>
        {workspace.delivery.delivery_url&&<p>Provider-declared URL, not retrieved: {workspace.delivery.delivery_url}</p>}
        <p>Exact delivery hash {workspace.delivery.content_hash}</p>
        {view.artifacts.map(item=><details key={item.id}><summary>{item.name} · digest checked</summary><pre>{item.text}</pre></details>)}
        <p>Recorded buyer acceptance: {workspace.acceptance.accepted?'accepted':'not accepted'}.</p><pre>{JSON.stringify(view.verification.categories,null,2)}</pre>
      </section>:<p>No original delivery is recorded.</p>}
      {view.work.viewer.is_buyer&&workspace.delivery&&workspace.trade.status==='pending_release'&&!workspace.acceptance.error_code&&!view.verification.acceptance.error_code&&<section aria-label="Explicit buyer acceptance">
        <label><input type="checkbox" checked={checked} disabled={busy} onChange={event=>setChecked(event.target.checked)}/>I reviewed this exact original delivery and authorize its settlement.</label>
        <button disabled={busy||!checked} onClick={()=>void accept()}>{workspace.acceptance.accepted?'Resume original settlement':'Accept exact delivery'}</button>
      </section>}
      {view.work.viewer.is_seller&&!workspace.delivery&&<p>Submit the agreed output using the original trade delivery endpoint or the finite listing provider client.</p>}
    </>}
  </main>
}
