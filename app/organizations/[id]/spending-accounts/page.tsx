'use client'
import { use,useCallback,useEffect,useRef,useState } from 'react'
import Link from 'next/link'
import { formatUnits } from 'viem'
import { decimalGrantUnits,decodeOwnerGrantReview,encodeOwnerGrantReview,ownerGrantReviewMatches } from '@/lib/organization-spending-review.mjs'

type Assignment={agent_id:string;team_id:string|null;cost_center:string}
type Service={id:string;title:string;shareId:string|null;teamId:string|null}
type Payment={rail:'evm'|'mpp';chain_id:number;token_address:string;payer_address:string;treasury_address:string;minimum_token_reserve_units:string;minimum_native_reserve_wei?:string;max_gas_cost_wei?:string;max_lifetime_gas_cost_wei?:string;fee_token_address?:string;minimum_fee_token_reserve_units?:string;max_fee_token_cost_units?:string;max_lifetime_fee_token_cost_units?:string}
type Account={version:number;client_reference:string;token_decimals?:number;token_usd_price?:number;payment?:Payment;id:string;name:string;buyer_agent_id:string;team_id:string|null;cost_center:string;state:string;expires_at:string;max_purchase:string;max_daily:string;max_monthly:string;max_lifetime:string;credential_prefix:string;allowed_services:{service_id:string;provider_share_id:string|null}[]}
type Entry={account:Account;uses:{order_id:string;amount_minor:number}[]}
type Grant=Omit<Account,'id'|'state'|'credential_prefix'|'token_decimals'|'token_usd_price'> & {expected_token_decimals?:number;expected_token_usd_price?:number}
type Pending={version:1;organization_id:string;phase:'reviewed'|'request_started';grant:Grant}
type Config={new_payments_paused:boolean;erc20_configured:boolean;treasury_wallet:string|null;mpp_trade_enabled:boolean;mpp_recipient:string|null;accepted_tokens:{chain_id:number;chain_name:string;token_address:string;symbol:string;decimals:number;fixed_usd_price:number}[];trade_settlement:{mpp:{currency:string;chainId:number}}}
const walletLabels={payer:'Buyer payer address',tokenReserve:'Token reserve',nativeReserve:'Native ETH reserve',gas:'Gas ceiling per purchase (ETH)',gasLifetime:'Lifetime gas ceiling (ETH)',feeReserve:'Fee token reserve',fee:'Fee ceiling per purchase (pathUSD)',feeLifetime:'Lifetime fee ceiling (pathUSD)'}
type WalletDraft=Record<keyof typeof walletLabels,string>
const initialWallet:WalletDraft={payer:'',tokenReserve:'1',nativeReserve:'0.001',gas:'0.001',gasLifetime:'0.01',feeReserve:'1',fee:'0.01',feeLifetime:'0.10'}
export default function SpendingAccounts({params}:{params:Promise<{id:string}>}){
  const {id}=use(params),path=`/api/organizations/${encodeURIComponent(id)}/spending-accounts`,storageKey=`clawdmarket.owner-spending-review:${id}`
  const currentPath=useRef<string|null>(path)
  useEffect(()=>{currentPath.current=path;return()=>{currentPath.current=null}},[path])
  const generation=useRef(0),pending=useRef<Pending|null>(null)
  const [entries,setEntries]=useState<Entry[]>([]),[assignments,setAssignments]=useState<Assignment[]>([]),[services,setServices]=useState<Service[]>([])
  const [authorizedScope,setAuthorized]=useState<string|null>(null),[message,setMessage]=useState(''),[key,setKey]=useState(''),[busy,setBusy]=useState(false)
  const [buyer,setBuyer]=useState(''),[service,setService]=useState(''),[name,setName]=useState('Approved service purchasing')
  const [purchase,setPurchase]=useState('1.00'),[daily,setDaily]=useState('1.00'),[monthly,setMonthly]=useState('1.00'),[lifetime,setLifetime]=useState('1.00'),[hours,setHours]=useState('24')
  const [rail,setRail]=useState<'credit'|'evm'|'mpp'>('credit'),[token,setToken]=useState(''),[config,setConfig]=useState<Config|null>(null),[wallet,setWallet]=useState(initialWallet)
  const [review,setReview]=useState<Pending|null>(null),[consent,setConsent]=useState(false),[storageBlocked,setStorageBlocked]=useState(false)
  const authorized=authorizedScope===path
  function preserve(value:Pending){sessionStorage.setItem(storageKey,encodeOwnerGrantReview(id,value.grant,value.phase));pending.current=value;setReview(value)}
  function clearReview(){sessionStorage.removeItem(storageKey);pending.current=null;setReview(null);setConsent(false)}
  const load=useCallback(async(originalReference?:string)=>{
    const request=++generation.current,response=await fetch(originalReference?`${path}?client_reference=${encodeURIComponent(originalReference)}`:path,{cache:'no-store'}),value=await response.json()
    if(request!==generation.current||currentPath.current!==path)return false
    if(!response.ok){setAuthorized(null);setEntries([]);setAssignments([]);setServices([]);setKey('');setReview(null);setConsent(false);pending.current=null;setMessage('Sign in as the current organization owner to manage spending accounts.');return false}
    setAuthorized(path);setEntries(previous=>originalReference?[...value.spending_accounts,...previous.filter(entry=>!value.spending_accounts.some((original:Entry)=>original.account.id===entry.account.id))].slice(0,100):value.spending_accounts);return value.spending_accounts as Entry[]
  },[path])
  useEffect(()=>{
    let active=true;pending.current=null;setReview(null);setConsent(false);setKey('');setAuthorized(null);setEntries([]);setAssignments([]);setServices([]);setBuyer('');setService('');setRail('credit');setToken('');setWallet(initialWallet);setConfig(null);setStorageBlocked(false);setBusy(false);setMessage('')
    async function initialize(){
      if(!await load()||!active)return
      const [organization,publicServices,privateServices,payments]=await Promise.all([fetch(`/api/organizations/${encodeURIComponent(id)}`,{cache:'no-store'}),fetch('/api/services?limit=100',{cache:'no-store'}),fetch(`/api/organizations/${encodeURIComponent(id)}/providers`,{cache:'no-store'}),fetch('/api/payments/config',{cache:'no-store'})])
      if(!organization.ok||!active)return
      const org=await organization.json(),catalog=publicServices.ok?await publicServices.json():{services:[]},privateCatalog=privateServices.ok?await privateServices.json():{providers:[]},ready=payments.ok?await payments.json():null
      if(!active)return
      setAssignments(org.assignments||[]);setConfig(ready)
      setServices([...catalog.services.map((item:{id:string;title:string})=>({id:item.id,title:item.title,shareId:null,teamId:null})),...privateCatalog.providers.filter((item:{share:{state:string}})=>item.share.state==='active').map((item:{service:{id:string;title:string};share:{id:string;team_id:string|null}})=>({id:item.service.id,title:item.service.title,shareId:item.share.id,teamId:item.share.team_id}))])
      try{const saved=sessionStorage.getItem(storageKey);if(saved){const original=decodeOwnerGrantReview(saved,id) as Pending;pending.current=original;setReview(original);setRail(original.grant.version===3?'mpp':original.grant.version===2?'evm':'credit');setMessage('An original reviewed grant is saved. Inspect the inventory and recover that same grant before creating another.')}}catch{setStorageBlocked(true);setMessage('The original review could not be recovered. Preserve its browser state and inspect the inventory before creating another grant.')}
    }
    initialize().catch(()=>{if(active)setMessage('Unable to load account management. Refresh to inspect the original records.')})
    return()=>{active=false}
  },[id,path,storageKey,load])
  const selectedBuyer=assignments.find(item=>item.agent_id===buyer),selectedService=services.find(item=>`${item.id}:${item.shareId||''}`===service)
  const tokens=config?.accepted_tokens.filter(item=>[1,11155111].includes(item.chain_id))||[],selectedToken=tokens.find(item=>`${item.chain_id}:${item.token_address.toLowerCase()}`===token)
  const csrf=()=>decodeURIComponent(document.cookie.split('; ').find(value=>value.startsWith('csrf-token='))?.slice('csrf-token='.length)||'')
  async function issue(){
    const original=pending.current;if(!original||busy||!authorized||storageBlocked||original.grant.version>=2&&!consent)return
    setBusy(true);setKey('');setMessage('')
    try{
      preserve({...original,phase:'request_started'})
      const response=await fetch(path,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf()},body:JSON.stringify(original.grant)}),value=await response.json()
      if(currentPath.current!==path)return
      if(response.ok){const inventory=await load(original.grant.client_reference);if(inventory&&ownerGrantReviewMatches(original.grant,value.account)&&inventory.some(entry=>entry.account.id===value.account.id&&ownerGrantReviewMatches(original.grant,entry.account))){clearReview();setKey(value.api_key||'');setMessage(value.api_key?'Spending account created. Copy the key now; it is shown once.':'The original account already exists. Its key cannot be reissued; revoke it and explicitly create another grant if the key was lost.')}else if(inventory)setMessage('The original grant could not be verified. Preserve the saved review and inspect the inventory.')}
      else{const inventory=await load(original.grant.client_reference);if(inventory&&original.phase==='reviewed'&&value.error_code==='SPENDING_PAYMENT_METADATA_CHANGED'&&inventory.length===0){preserve({...original,phase:'reviewed'});setConsent(false)}if(currentPath.current===path)setMessage(`Grant unavailable: ${value.error_code||'REQUEST_UNCERTAIN'}. Preserve the original review and inspect the inventory before another grant.`)}
    }catch{if(currentPath.current===path)setMessage('The response was lost. Inspect the inventory or retry the same saved grant; its original reference will be preserved.')}
    finally{if(currentPath.current===path)setBusy(false)}
  }
  async function stage(event:React.FormEvent){
    event.preventDefault();if(busy||storageBlocked||!authorized)return
    if(pending.current){if(pending.current.grant.version===1)await issue();return}
    if(!selectedBuyer||!selectedService)return
    try{
      const grant:Grant={version:rail==='mpp'?3:rail==='evm'?2:1,client_reference:crypto.randomUUID(),name:name.trim(),buyer_agent_id:buyer,team_id:selectedBuyer.team_id,cost_center:selectedBuyer.cost_center,allowed_services:[{service_id:selectedService.id,provider_share_id:selectedService.shareId}],max_purchase:purchase,max_daily:daily,max_monthly:monthly,max_lifetime:lifetime,expires_at:new Date(Date.now()+Number(hours)*3600000).toISOString()}
      if(rail!=='credit'){
        if(!config||config.new_payments_paused||rail==='evm'&&(!config.erc20_configured||!selectedToken||!config.treasury_wallet)||rail==='mpp'&&(!config.mpp_trade_enabled||!config.mpp_recipient))throw Error('Wallet grants unavailable')
        const decimals=rail==='mpp'?6:selectedToken!.decimals
        grant.expected_token_decimals=decimals;grant.expected_token_usd_price=rail==='mpp'?1:selectedToken!.fixed_usd_price
        grant.payment={rail,chain_id:rail==='mpp'?4217:selectedToken!.chain_id,token_address:(rail==='mpp'?config.trade_settlement.mpp.currency:selectedToken!.token_address).toLowerCase(),payer_address:wallet.payer.toLowerCase(),treasury_address:(rail==='mpp'?config.mpp_recipient!:config.treasury_wallet!).toLowerCase(),minimum_token_reserve_units:decimalGrantUnits(wallet.tokenReserve,decimals),...(rail==='evm'?{minimum_native_reserve_wei:decimalGrantUnits(wallet.nativeReserve,18),max_gas_cost_wei:decimalGrantUnits(wallet.gas,18,true),max_lifetime_gas_cost_wei:decimalGrantUnits(wallet.gasLifetime,18,true)}:{fee_token_address:config.trade_settlement.mpp.currency.toLowerCase(),minimum_fee_token_reserve_units:decimalGrantUnits(wallet.feeReserve,6),max_fee_token_cost_units:decimalGrantUnits(wallet.fee,6,true),max_lifetime_fee_token_cost_units:decimalGrantUnits(wallet.feeLifetime,6,true)})}
      }
      preserve({version:1,organization_id:id,phase:'reviewed',grant});setConsent(false);setKey('');setMessage('')
      if(rail==='credit')await issue()
    }catch{setMessage('Unable to save the exact grant. Check the selected wallet rail, addresses and plain decimal limits, then try again.')}
  }
  async function recoverOriginal(){
    if(!pending.current||busy)return
    setBusy(true)
    try{
      const original=pending.current,request=++generation.current,response=await fetch(`${path}?client_reference=${encodeURIComponent(original.grant.client_reference)}`,{cache:'no-store'}),value=await response.json()
      if(currentPath.current!==path||request!==generation.current)return
      if(!response.ok){await load();return}
      const match=value.spending_accounts.find((entry:Entry)=>ownerGrantReviewMatches(original.grant,entry.account))
      if(!match){setMessage('The saved original grant was not found. Keep its review and retry only that same grant.');return}
      setEntries(previous=>[match,...previous.filter(entry=>entry.account.id!==match.account.id)].slice(0,100));clearReview();setKey('');setMessage('The original grant is recorded. Its key cannot be reissued. Revoke that original credential if its key was lost.')
    }catch{setMessage('Unable to inspect the original grant. Preserve the saved review and refresh.')}
    finally{setBusy(false)}
  }
  async function revoke(accountId:string){setBusy(true);setMessage('');try{
    const response=await fetch(path,{method:'DELETE',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf()},body:JSON.stringify({account_id:accountId})}),value=await response.json()
    if(currentPath.current!==path)return
    setKey('');if(await load())setMessage(response.ok?'Spending credential revoked. Original purchases remain available to their buyer and provider.':`Revocation unavailable: ${value.error_code||'REQUEST_UNCERTAIN'}. Inspect the original account.`)
  }catch{if(currentPath.current===path)setMessage('The response was lost. Refresh to inspect the account before retrying.')}
  finally{if(currentPath.current===path)setBusy(false)}}
  return <main className="mx-auto max-w-3xl px-5 py-12">
    <h1 className="mb-4 text-2xl font-semibold">Spending accounts</h1>
    <Link href={`/organizations/${id}`} className="mb-5 inline-block underline">Back to enterprise workspace</Link>
    <p className="mb-6">Authorize one assigned buyer to purchase selected services with deposited credit or a separately reviewed wallet grant. Each order needs an exact human approval. The buyer funds and reviews completed work separately.</p>
    {message&&<p role="status" className="mb-5 break-words">{message}</p>}
    {authorized&&key&&<section className="mb-6 rounded border p-4"><h2 className="font-semibold">Once-only spending key</h2><code data-testid="spending-key" className="mt-3 block break-all">{key}</code></section>}
    {authorized&&<>
      <form onSubmit={stage} className="mb-8 space-y-4 rounded border p-5">
        <h2 className="text-lg font-semibold">Grant bounded purchasing</h2>
        <fieldset disabled={busy||Boolean(review)||storageBlocked} className="space-y-4">
          <label className="block">Account name<input required value={name} onChange={event=>setName(event.target.value)} className="mt-1 block w-full rounded border bg-transparent p-2"/></label>
          <label className="block">Assigned buyer<select required value={buyer} onChange={event=>{setBuyer(event.target.value);setService('')}} className="mt-1 block w-full rounded border bg-neutral-950 p-2"><option value="">Select a buyer</option>{assignments.map(item=><option key={item.agent_id} value={item.agent_id}>{item.cost_center} · {item.agent_id}</option>)}</select></label>
          {selectedBuyer&&<p className="break-words text-sm">Cost center: {selectedBuyer.cost_center}. Department: {selectedBuyer.team_id||'No department'}.</p>}
          <label className="block">Approved service<select required value={service} onChange={event=>setService(event.target.value)} className="mt-1 block w-full rounded border bg-neutral-950 p-2"><option value="">Select a service</option>{services.filter(item=>!item.teamId||item.teamId===selectedBuyer?.team_id).map(item=><option key={`${item.id}:${item.shareId||''}`} value={`${item.id}:${item.shareId||''}`}>{item.title}{item.shareId?' · Private':''}</option>)}</select></label>
          <label className="block">Payment authority<select value={rail} onChange={event=>{setRail(event.target.value as typeof rail);setToken('')}} className="mt-1 block w-full rounded border bg-neutral-950 p-2"><option value="credit">Deposited account credit</option><option value="evm" disabled={!config?.erc20_configured||!tokens.length||config.new_payments_paused}>Reviewed Ethereum L1 wallet</option><option value="mpp" disabled={!config?.mpp_trade_enabled||config.new_payments_paused}>Reviewed Tempo wallet</option></select></label>
          {rail==='evm'&&<label className="block">Reviewed L1 asset<select required value={token} onChange={event=>setToken(event.target.value)} className="mt-1 block w-full rounded border bg-neutral-950 p-2"><option value="">Select a configured L1 asset</option>{tokens.map(item=><option key={`${item.chain_id}:${item.token_address}`} value={`${item.chain_id}:${item.token_address.toLowerCase()}`}>{item.chain_name} · {item.symbol}</option>)}</select></label>}
          {rail!=='credit'&&<>
            <p className="break-words text-sm">Fixed treasury: {rail==='mpp'?config?.mpp_recipient:config?.treasury_wallet}. {rail==='mpp'?'Tempo pathUSD, six decimal places.':selectedToken?`${selectedToken.symbol}, ${selectedToken.decimals} decimal places.`:''}</p>
            {(Object.keys(walletLabels) as (keyof WalletDraft)[]).filter(key=>rail==='evm'?!['feeReserve','fee','feeLifetime'].includes(key):!['nativeReserve','gas','gasLifetime'].includes(key)).map(field=><label key={field} className="block">{walletLabels[field]}{['tokenReserve','feeReserve'].includes(field)?rail==='mpp'?' (pathUSD)':` (${selectedToken?.symbol||'token'})`:''}<input required value={wallet[field]} onChange={event=>setWallet(previous=>({...previous,[field]:event.target.value}))} {...(field==='payer'?{type:'text',pattern:'0x[a-fA-F0-9]{40}'}:{type:'text',inputMode:'decimal' as const})} className="mt-1 block w-full rounded border bg-transparent p-2"/></label>)}
            <p className="text-sm">Reserve floors protect the buyer wallet. Lifetime fee exposure counts every original checkout, including cancelled or refunded orders.</p>
          </>}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{[['Per purchase',purchase,setPurchase],['UTC daily limit',daily,setDaily],['UTC monthly limit',monthly,setMonthly],['Lifetime limit',lifetime,setLifetime]].map(([label,value,setter])=><label key={label as string} className="block">{label as string} (USD including fee)<input required type="number" min="0.01" step="0.01" value={value as string} onChange={event=>(setter as (value:string)=>void)(event.target.value)} className="mt-1 block w-full rounded border bg-transparent p-2"/></label>)}</div>
          <label className="block">Expires after<select value={hours} onChange={event=>setHours(event.target.value)} className="mt-1 block w-full rounded border bg-neutral-950 p-2"><option value="1">1 hour</option><option value="24">24 hours</option><option value="168">7 days</option><option value="720">30 days</option></select></label>
        </fieldset>
        {!review&&<button disabled={busy||storageBlocked} className="rounded border px-4 py-2">{rail==='credit'?'Grant spending account':'Review wallet grant'}</button>}
      </form>
      {review&&<section aria-labelledby="review-grant-title" className="mb-8 space-y-4 break-words rounded border p-5">
        <h2 id="review-grant-title" className="text-lg font-semibold">Review original spending grant</h2>
        <p>{review.grant.name} · Buyer {review.grant.buyer_agent_id} · {review.grant.cost_center} · Department {review.grant.team_id||'No department'}</p>
        <p>Service {review.grant.allowed_services[0].service_id} · {review.grant.allowed_services[0].provider_share_id?'Exact private provider share '+review.grant.allowed_services[0].provider_share_id:'Public service'}</p>
        <p>Purchase ${review.grant.max_purchase} · Daily ${review.grant.max_daily} · Monthly ${review.grant.max_monthly} · Lifetime ${review.grant.max_lifetime} including marketplace fees.</p>
        <p>Expires {new Date(review.grant.expires_at).toLocaleString()}</p>
        {review.grant.payment&&<><p>{review.grant.payment.rail==='mpp'?'Tempo (4217)':review.grant.payment.chain_id===1?'Ethereum L1 (1)':'Sepolia (11155111)'} · Token {review.grant.payment.token_address}</p><p>Buyer payer {review.grant.payment.payer_address}</p><p>Fixed treasury {review.grant.payment.treasury_address}</p><p>{review.grant.payment.rail==='evm'?`Native reserve ${formatUnits(BigInt(review.grant.payment.minimum_native_reserve_wei!),18)} ETH.`:`Fee reserve ${formatUnits(BigInt(review.grant.payment.minimum_fee_token_reserve_units!),6)} pathUSD.`}</p><p>Token reserve {formatUnits(BigInt(review.grant.payment.minimum_token_reserve_units),review.grant.expected_token_decimals!)} tokens. {review.grant.payment.rail==='evm'?`Gas ceiling ${formatUnits(BigInt(review.grant.payment.max_gas_cost_wei!),18)} ETH per purchase; ${formatUnits(BigInt(review.grant.payment.max_lifetime_gas_cost_wei!),18)} ETH lifetime.`:`Fee ceiling ${formatUnits(BigInt(review.grant.payment.max_fee_token_cost_units!),6)} pathUSD per purchase; ${formatUnits(BigInt(review.grant.payment.max_lifetime_fee_token_cost_units!),6)} pathUSD lifetime.`}</p><details><summary>Exact wallet and fee terms</summary><dl className="space-y-2">{Object.entries(review.grant.payment).map(([field,value])=><div key={field}><dt className="capitalize">{field.replaceAll('_',' ')}</dt><dd>{String(value)}</dd></div>)}</dl></details></>}
        <p>This grants only bounded service purchasing. Funding still requires an exact approved order and the buyer-host signer. Delivery acceptance remains with the original buyer.</p>
        <label className="flex items-start gap-3"><input type="checkbox" checked={consent} disabled={busy} onChange={event=>setConsent(event.target.checked)} className="mt-1"/>I approve the exact buyer, service, wallet, reserves and original lifetime exposure shown above.</label>
        <div className="flex flex-wrap gap-3"><button type="button" disabled={busy||!consent} onClick={()=>void issue()} className="rounded border px-4 py-2">{review.phase==='request_started'?'Retry original reviewed grant':'Confirm reviewed grant'}</button><button type="button" disabled={busy} onClick={()=>void recoverOriginal()} className="rounded border px-4 py-2">Inspect original grant</button>{review.phase==='reviewed'&&<button type="button" disabled={busy} onClick={()=>{try{clearReview()}catch{setMessage('Unable to preserve the original review. Refresh to inspect it.')}}} className="rounded border px-4 py-2">Edit before granting</button>}</div>
      </section>}
      <div className="space-y-5">{entries.map(({account,uses})=><article key={account.id} className="break-words rounded border p-5">
        <h2 className="text-lg font-semibold">{account.name}</h2><p className="my-3">{account.state} · {account.credential_prefix}… · Expires {new Date(account.expires_at).toLocaleString()}</p>
        <p className="mb-3">Authority: {account.version===3?'Reviewed Tempo wallet service purchasing':account.version===2?'Reviewed external wallet service purchasing':'Deposited account credit purchasing'}</p>
        {account.payment&&<details className="mb-4"><summary>Reviewed wallet and fee terms</summary><p>Rail {account.payment.rail} · Chain {account.payment.chain_id}</p><p>Token {account.payment.token_address}</p><p>Payer {account.payment.payer_address}</p><p>Treasury {account.payment.treasury_address}</p><p>Token reserve {account.payment.minimum_token_reserve_units} base units</p>{account.payment.rail==='evm'?<><p>Native reserve {account.payment.minimum_native_reserve_wei} wei</p><p>Gas ceiling {account.payment.max_gas_cost_wei} wei per purchase · {account.payment.max_lifetime_gas_cost_wei} wei lifetime</p></>:<><p>Fee token {account.payment.fee_token_address}</p><p>Fee reserve {account.payment.minimum_fee_token_reserve_units} base units</p><p>Fee ceiling {account.payment.max_fee_token_cost_units} base units per purchase · {account.payment.max_lifetime_fee_token_cost_units} base units lifetime</p></>}</details>}
        <p className="text-sm">Buyer {account.buyer_agent_id} · {account.cost_center}</p>
        <p className="my-3">Purchase ${account.max_purchase} · Daily ${account.max_daily} · Monthly ${account.max_monthly} · Lifetime ${account.max_lifetime}</p>
        <details className="my-4"><summary>Original purchases shown ({uses.length}, up to 100)</summary>{uses.map(use=><p key={use.order_id} className="mt-2 text-sm">Order {use.order_id} · ${(use.amount_minor/100).toFixed(2)} including fee</p>)}</details>
        {account.state==='active'&&<button disabled={busy} onClick={()=>revoke(account.id)} className="rounded border px-4 py-2">Revoke spending credential</button>}
      </article>)}</div>
      <p className="mt-6 text-sm">Refunds do not restore these allowances. All existing buyer, organization and department limits still apply.</p>
    </>}
  </main>
}
