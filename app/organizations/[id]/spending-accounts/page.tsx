'use client'
import { use,useCallback,useEffect,useRef,useState } from 'react'
import Link from 'next/link'
type Assignment={agent_id:string;team_id:string|null;cost_center:string}
type Service={id:string;title:string;shareId:string|null;teamId:string|null}
type Account={id:string;name:string;buyer_agent_id:string;team_id:string|null;cost_center:string;state:string;expires_at:string;max_purchase:string;max_daily:string;max_monthly:string;max_lifetime:string;credential_prefix:string;allowed_services:{service_id:string;provider_share_id:string|null}[]}
type Entry={account:Account;uses:{order_id:string;amount_minor:number}[]}
export default function SpendingAccounts({params}:{params:Promise<{id:string}>}){
  const {id}=use(params),path=`/api/organizations/${encodeURIComponent(id)}/spending-accounts`
  const [entries,setEntries]=useState<Entry[]>([]),[assignments,setAssignments]=useState<Assignment[]>([]),[services,setServices]=useState<Service[]>([])
  const [authorized,setAuthorized]=useState(false),[message,setMessage]=useState(''),[key,setKey]=useState(''),[busy,setBusy]=useState(false)
  const [buyer,setBuyer]=useState(''),[service,setService]=useState(''),[name,setName]=useState('Approved service purchasing')
  const [purchase,setPurchase]=useState('1.00'),[daily,setDaily]=useState('1.00'),[monthly,setMonthly]=useState('1.00'),[lifetime,setLifetime]=useState('1.00'),[hours,setHours]=useState('24')
  const pending=useRef<object|null>(null)
  const [pendingGrant,setPendingGrant]=useState(false)
  const load=useCallback(async()=>{
    const response=await fetch(path,{cache:'no-store'}),value=await response.json()
    if(!response.ok){setAuthorized(false);setEntries([]);setKey('');setMessage('Sign in as the current organization owner to manage spending accounts.');return}
    setAuthorized(true);setEntries(value.spending_accounts)
  },[path])
  useEffect(()=>{
    let active=true
    async function initialize(){
      await load()
      const [organization,publicServices,privateServices]=await Promise.all([
        fetch(`/api/organizations/${encodeURIComponent(id)}`,{cache:'no-store'}),fetch('/api/services?limit=100',{cache:'no-store'}),fetch(`/api/organizations/${encodeURIComponent(id)}/providers`,{cache:'no-store'})])
      if(!organization.ok)return
      const org=await organization.json(),catalog=publicServices.ok?await publicServices.json():{services:[]},privateCatalog=privateServices.ok?await privateServices.json():{providers:[]}
      if(!active)return
      setAssignments(org.assignments||[])
      setServices([...catalog.services.map((item:{id:string;title:string})=>({id:item.id,title:item.title,shareId:null,teamId:null})),
        ...privateCatalog.providers.filter((item:{share:{state:string}})=>item.share.state==='active').map((item:{service:{id:string;title:string};share:{id:string;team_id:string|null}})=>({id:item.service.id,title:item.service.title,shareId:item.share.id,teamId:item.share.team_id}))])
    }
    initialize().catch(()=>setMessage('Unable to load account management. Refresh to inspect the original records.'))
    return()=>{active=false}
  },[id,load])
  const selectedBuyer=assignments.find(item=>item.agent_id===buyer),selectedService=services.find(item=>`${item.id}:${item.shareId||''}`===service)
  const csrf=()=>decodeURIComponent(document.cookie.split('; ').find(value=>value.startsWith('csrf-token='))?.slice('csrf-token='.length)||'')
  async function grant(event:React.FormEvent){
    event.preventDefault();if(!selectedBuyer||!selectedService)return
    setBusy(true);setKey('');setMessage('')
    if(!pending.current)pending.current={version:1,client_reference:crypto.randomUUID(),name,buyer_agent_id:buyer,team_id:selectedBuyer.team_id,cost_center:selectedBuyer.cost_center,
      allowed_services:[{service_id:selectedService.id,provider_share_id:selectedService.shareId}],max_purchase:purchase,max_daily:daily,max_monthly:monthly,max_lifetime:lifetime,expires_at:new Date(Date.now()+Number(hours)*3600_000).toISOString()}
    setPendingGrant(true)
    try{
      const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf()},body:JSON.stringify(pending.current)}),value=await response.json()
      if(!response.ok){setMessage(`Grant failed: ${value.error_code||'REQUEST_UNCERTAIN'}. Inspect the original records before creating another grant.`);if(response.status<500){pending.current=null;setPendingGrant(false)}}
      else{setKey(value.api_key||'');setMessage(value.api_key?'Spending account created. Copy the key now; it is shown once.':'The original account already exists. Its key cannot be reissued; revoke it and explicitly create another grant if the key was lost.');pending.current=null;setPendingGrant(false)}
      await load()
    }catch{setMessage('The response was lost. Refresh the inventory before retrying the same grant or creating another account.')}
    finally{setBusy(false)}
  }
  async function revoke(accountId:string){setBusy(true);setMessage('');try{
    const response=await fetch(path,{method:'DELETE',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf()},body:JSON.stringify({account_id:accountId})}),value=await response.json()
    setMessage(response.ok?'Spending credential revoked. Original purchases remain available to their buyer and provider.':`Revocation failed: ${value.error_code||'REQUEST_UNCERTAIN'}. Refresh to inspect the account.`)
    setKey('');await load()
  }catch{setMessage('The response was lost. Refresh to inspect the account before retrying.')}
  finally{setBusy(false)}}
  return <main className="mx-auto max-w-3xl px-5 py-12">
    <h1 className="mb-4 text-2xl font-semibold">Spending accounts</h1>
    <Link href={`/organizations/${id}`} className="mb-5 inline-block underline">Back to enterprise workspace</Link>
    <p className="mb-6">Authorize one assigned buyer to purchase selected services from its deposited account balance. Every purchase needs an exact human approval. The buyer reviews completed work separately.</p>
    {message&&<p role="status" className="mb-5 break-words">{message}</p>}
    {key&&<section className="mb-6 rounded border p-4"><h2 className="font-semibold">Once-only spending key</h2><code data-testid="spending-key" className="mt-3 block break-all">{key}</code></section>}
    {authorized&&<>
      <form onSubmit={grant} className="mb-8 space-y-4 rounded border p-5">
        <h2 className="text-lg font-semibold">Grant bounded purchasing</h2>
        <fieldset disabled={busy||pendingGrant} className="space-y-4">
          <label className="block">Account name<input required value={name} onChange={event=>setName(event.target.value)} className="mt-1 block w-full rounded border bg-transparent p-2"/></label>
          <label className="block">Assigned buyer<select required value={buyer} onChange={event=>{setBuyer(event.target.value);setService('')}} className="mt-1 block w-full rounded border bg-neutral-950 p-2"><option value="">Select a buyer</option>{assignments.map(item=><option key={item.agent_id} value={item.agent_id}>{item.cost_center} · {item.agent_id}</option>)}</select></label>
          {selectedBuyer&&<p className="break-words text-sm">Cost center: {selectedBuyer.cost_center}. Department: {selectedBuyer.team_id||'No department'}.</p>}
          <label className="block">Approved service<select required value={service} onChange={event=>setService(event.target.value)} className="mt-1 block w-full rounded border bg-neutral-950 p-2"><option value="">Select a service</option>{services.filter(item=>!item.teamId||item.teamId===selectedBuyer?.team_id).map(item=><option key={`${item.id}:${item.shareId||''}`} value={`${item.id}:${item.shareId||''}`}>{item.title}{item.shareId?' · Private':''}</option>)}</select></label>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{[['Per purchase',purchase,setPurchase],['UTC daily limit',daily,setDaily],['UTC monthly limit',monthly,setMonthly],['Lifetime limit',lifetime,setLifetime]].map(([label,value,setter])=><label key={label as string} className="block">{label as string} (USD including fee)<input required type="number" min="0.01" step="0.01" value={value as string} onChange={event=>(setter as (value:string)=>void)(event.target.value)} className="mt-1 block w-full rounded border bg-transparent p-2"/></label>)}</div>
          <label className="block">Expires after<select value={hours} onChange={event=>setHours(event.target.value)} className="mt-1 block w-full rounded border bg-neutral-950 p-2"><option value="1">1 hour</option><option value="24">24 hours</option><option value="168">7 days</option><option value="720">30 days</option></select></label>
        </fieldset>
        <button disabled={busy} className="rounded border px-4 py-2">Grant spending account</button>
      </form>
      <div className="space-y-5">{entries.map(({account,uses})=><article key={account.id} className="break-words rounded border p-5">
        <h2 className="text-lg font-semibold">{account.name}</h2><p className="my-3">{account.state} · {account.credential_prefix}… · Expires {new Date(account.expires_at).toLocaleString()}</p>
        <p className="text-sm">Buyer {account.buyer_agent_id} · {account.cost_center}</p>
        <p className="my-3">Purchase ${account.max_purchase} · Daily ${account.max_daily} · Monthly ${account.max_monthly} · Lifetime ${account.max_lifetime}</p>
        <details className="my-4"><summary>Original purchases shown ({uses.length}, up to 100)</summary>{uses.map(use=><p key={use.order_id} className="mt-2 text-sm">Order {use.order_id} · ${(use.amount_minor/100).toFixed(2)} including fee</p>)}</details>
        {account.state==='active'&&<button disabled={busy} onClick={()=>revoke(account.id)} className="rounded border px-4 py-2">Revoke spending credential</button>}
      </article>)}</div>
      <p className="mt-6 text-sm">Refunds do not restore these allowances. All existing buyer, organization and department limits still apply.</p>
    </>}
  </main>
}
