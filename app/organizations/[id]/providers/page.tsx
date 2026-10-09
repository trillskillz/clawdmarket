'use client'
import { use, useCallback, useEffect, useRef, useState } from 'react'
type Provider = { share: { id:string; state:string; request_hash:string; expires_at:string; team_id:string|null }; service:{id:string;title:string;description:string;pricing:{amount:string};capabilities:string[]} }
export default function PrivateProviders({params}:{params:Promise<{id:string}>}) {
  const {id}=use(params),path=`/api/organizations/${encodeURIComponent(id)}/providers`
  const [providers,setProviders]=useState<Provider[]>([]),[message,setMessage]=useState(''),[busy,setBusy]=useState(false)
  const decisions=useRef(new Map<string,object>())
  const load=useCallback(async()=>{
    const response=await fetch(path,{cache:'no-store'}),value=await response.json()
    if(!response.ok){setProviders([]);setMessage('Sign in as the organization owner to review private provider access.');return}
    setProviders(value.providers)
  },[path])
  useEffect(()=>{load().catch(()=>setMessage('Unable to load private providers. Refresh to try again.'))},[load])
  async function decide(provider:Provider,accept:boolean) {
    setBusy(true);setMessage('')
    try {
      if(accept&&!decisions.current.has(provider.share.id))decisions.current.set(provider.share.id,{version:1,client_reference:crypto.randomUUID(),request_hash:provider.share.request_hash})
      const csrf=document.cookie.split('; ').find(value=>value.startsWith('csrf-token='))?.slice('csrf-token='.length)||''
      const response=await fetch(path+(accept?`/${provider.share.id}/accept`:''),{method:accept?'POST':'DELETE',headers:{'Content-Type':'application/json','X-CSRF-Token':decodeURIComponent(csrf)},body:JSON.stringify(accept?decisions.current.get(provider.share.id):{share_id:provider.share.id})})
      const value=await response.json()
      setMessage(response.ok?(accept?'Private provider accepted.':'Private provider access revoked.'):`Action failed: ${value.error_code||'REQUEST_UNCERTAIN'}. Refresh to inspect the saved decision.`)
      await load()
    }catch{setMessage('The response was lost. Refresh to inspect the saved decision before retrying.')}
    finally{setBusy(false)}
  }
  return <main className="mx-auto max-w-3xl px-5 py-12">
    <h1 className="mb-4 text-2xl font-semibold">Private providers</h1>
    <p className="mb-6">Review the service, department and expiry before accepting an offer. Purchases still require buyer authorization and all spending limits.</p>
    {message&&<p role="status" className="mb-5">{message}</p>}
    <div className="space-y-5">{providers.map(provider=><article key={provider.share.id} className="rounded border p-5 break-words">
      <h2 className="text-lg font-semibold">{provider.service.title}</h2><p className="my-3">{provider.service.description}</p>
      <dl className="grid grid-cols-2 gap-3"><dt>Service price</dt><dd>${provider.service.pricing.amount} USD plus marketplace fee</dd>
        <dt>Department</dt><dd>{provider.share.team_id||'All active departments'}</dd><dt>Expires</dt><dd>{new Date(provider.share.expires_at).toLocaleString()}</dd><dt>Access</dt><dd>{provider.share.state}</dd></dl>
      <details className="my-4"><summary>Exact offer reference</summary><p className="mt-2 font-mono text-sm">{provider.share.request_hash}</p></details>
      <button disabled={busy} onClick={()=>decide(provider,provider.share.state==='pending')} className="rounded border px-4 py-2">{provider.share.state==='pending'?'Accept exact provider offer':'Revoke provider access'}</button>
    </article>)}</div>
  </main>
}
