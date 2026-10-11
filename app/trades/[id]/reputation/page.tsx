'use client'
import { useEffect,useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
type Decision={id:string;client_reference:string;responsibility:string;status:string;reason:string;severity:string;supersedes_id:string|null;created_at:string}
type History={decisions:Decision[];permissions:{can_append_decision:boolean;can_appeal:boolean}}
export default function ReputationReview(){
 const {id}=useParams<{id:string}>(),[history,setHistory]=useState<History|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 const [responsibility,setResponsibility]=useState('unknown'),[status,setStatus]=useState('neutral'),[reason,setReason]=useState('insufficient_evidence'),[severity,setSeverity]=useState('ordinary')
 const key=`reputation-review-original:${id}`
 async function load(){const r=await fetch(`/api/trades/${encodeURIComponent(id)}/reputation`,{cache:'no-store',credentials:'include'});const d=await r.json();if(!r.ok)throw Error(d.error??d.error_code??'Private history is unavailable');setHistory(d);const saved=sessionStorage.getItem(key);if(saved){const original=JSON.parse(saved);if(d.decisions.some((x:Decision)=>x.client_reference===original.body.client_reference))sessionStorage.removeItem(key)}}
 useEffect(()=>{load().catch(e=>setError(e.message))},[id]) // eslint-disable-line react-hooks/exhaustive-deps
 const head=history?.decisions.find(d=>!history.decisions.some(next=>next.supersedes_id===d.id))
 async function send(method:'POST'|'PATCH'){
  setBusy(true);setError('')
  try{
   const saved=sessionStorage.getItem(key)
   const body=saved?JSON.parse(saved).body:method==='PATCH'?{version:1,client_reference:crypto.randomUUID(),finding_id:head?.id}:{version:1,client_reference:crypto.randomUUID(),responsibility,status,reason,severity,supersedes_id:head?.id??null}
   const originalMethod=saved?JSON.parse(saved).method:method
   sessionStorage.setItem(key,JSON.stringify({method:originalMethod,body}))
   const csrf=document.cookie.split('; ').find(v=>v.startsWith('csrf-token='))?.split('=')[1]??''
   const r=await fetch(`/api/trades/${encodeURIComponent(id)}/reputation`,{method:originalMethod,credentials:'include',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(body)})
   const d=await r.json();if(!r.ok){if([400,401,403,404].includes(r.status))sessionStorage.removeItem(key);throw Error(d.error_code??d.error??'Review could not be saved. Inspect the original history before retrying.')}
   await load();sessionStorage.removeItem(key)
  }catch(e){setError(e instanceof Error?e.message:'Review unavailable. The original request remains saved for inspection.')}finally{setBusy(false)}
 }
 return <main className="max-w-3xl mx-auto px-6 py-12"><Link href="/dashboard?tab=trades">Back to trades</Link><h1>Reputation finding review</h1>
 <p>Findings describe responsibility for this work. They do not change escrow, payouts or buyer acceptance. Appeals retain the original finding until an administrator reviews it.</p>
 {error&&<p role="alert">{error}</p>}<button disabled={busy} onClick={()=>load().then(()=>setError('')).catch(e=>setError(e.message))}>Inspect original history</button>
 {history&&<><ol>{history.decisions.map(d=><li key={d.id}><strong>{d.status.replaceAll('_',' ')} · {d.responsibility}</strong><p>{d.reason.replaceAll('_',' ')} · {d.severity} · {new Date(d.created_at).toISOString()} · {d.supersedes_id?'Correction or appeal':'Original finding'}</p></li>)}</ol>{history.decisions.length===0&&<p>No adjudicated findings. An allegation or refund alone does not establish provider fault.</p>}
 {history.permissions.can_appeal&&head?.status==='upheld'&&head.responsibility==='provider'&&<button disabled={busy} onClick={()=>send('PATCH')}>Appeal original finding</button>}
 {history.permissions.can_append_decision&&<form onSubmit={e=>{e.preventDefault();send('POST')}}><h2>Administrator decision</h2><p>Choose an attributable reason supported by the original evidence. This app does not let administrators enter a reputation score.</p>
 <label>Responsibility <select value={responsibility} onChange={e=>setResponsibility(e.target.value)}>{['provider','buyer','platform','external','shared','unknown'].map(x=><option key={x}>{x}</option>)}</select></label>
 <label>Finding <select value={status} onChange={e=>setStatus(e.target.value)}>{['neutral','upheld','overturned'].map(x=><option key={x}>{x}</option>)}</select></label>
 <label>Reason <select value={reason} onChange={e=>setReason(e.target.value)}>{['provider_nonperformance','provider_abandonment','buyer_cancellation','buyer_noncooperation','platform_outage','rail_delay','goodwill_refund','seller_favor','shared_fault','insufficient_evidence','finding_overturned'].map(x=><option value={x} key={x}>{x.replaceAll('_',' ')}</option>)}</select></label>
 <label>Severity <select value={severity} onChange={e=>setSeverity(e.target.value)}><option>ordinary</option><option>serious</option></select></label><button disabled={busy} type="submit">Append reviewed decision</button>
 </form>}</>}
 </main>
}
