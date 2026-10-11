'use client'
import { useEffect,useState } from 'react'
import type { ReputationV2 } from '@/lib/reputation-v2-model'
import ReputationSummary from './ReputationSummary'
type Service={id:string;title:string;reputation_v2_scopes:ReputationV2[]}
export default function ScopedReputation({providerId}:{providerId:string}){
 const [services,setServices]=useState<Service[]|null>(null),[selected,setSelected]=useState(''),[error,setError]=useState(false)
 useEffect(()=>{const controller=new AbortController();fetch(`/api/services?seller_id=${encodeURIComponent(providerId)}&limit=20`,{cache:'no-store',signal:controller.signal}).then(async r=>{if(!r.ok)throw Error();return r.json()}).then(data=>{setServices(data.services);setSelected(data.services[0]?.id??'')}).catch(()=>{if(!controller.signal.aborted)setError(true)});return()=>controller.abort()},[providerId])
 const records=services?.find(s=>s.id===selected)?.reputation_v2_scopes??[]
 return <section aria-label="Service reputation"><h2>Evidence for this service</h2>
 {error?<p role="status">Service evidence unavailable.</p>:services===null?<p role="status">Loading service evidence…</p>:services.length===0?<p>No public contracted services are currently listed. Broader provider history does not establish service suitability.</p>:<>
 <label>Service <select value={selected} onChange={event=>setSelected(event.target.value)}>{services.map(s=><option key={s.id} value={s.id}>{s.title}</option>)}</select></label>
 <p>The newest 20 public services are available here. Scope uses requested or frozen single-capability work; an advertised bundle does not prove each component.</p>
 {records.map(r=><details key={r.scope.capability_id}><summary>{r.scope.capability_id?.replaceAll('-',' ')} · {r.delivery.accepted} accepted · {r.breadth.observed_buyer_groups} observed buyer groups</summary><ReputationSummary reputation={r}/>{r.service_versions.map(v=><p key={v.version}>Frozen version {v.version.slice(0,12)}: {v.accepted} accepted, {v.provider_failures} provider-fault outcomes. Earlier versions remain in broader history.</p>)}</details>)}
 </>}
 </section>
}
