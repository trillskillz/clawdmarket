import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
 const { searchParams } = new URL(request.url)
 const domain = searchParams.get('domain')

 if (!domain) {
 return NextResponse.json({ error: 'domain required' }, { status: 400 })
 }

 const clean = domain.replace(/[^a-zA-Z0-9.-]/g, '').toLowerCase()
 if (!clean) {
 return NextResponse.json({ error: 'invalid domain' }, { status: 400 })
 }

 const results: Record<string, any> = { domain: clean, found: [] }

 const urls = [
 `https://${clean}/.well-known/agent.json`,
 `https://${clean}/llms.txt`,
 `https://${clean}/.well-known/mpp.json`,
 ]

 for (const url of urls) {
 try {
 const res = await fetch(url, {
 headers: { 'User-Agent': 'ClawdMarket/1.0 agent-lookup' },
 signal: AbortSignal.timeout(5000),
 })
 if (res.ok) {
 const ct = res.headers.get('content-type') || ''
 if (ct.includes('json')) {
 const key = url.includes('agent.json') ? 'agent_card' : url.includes('mpp') ? 'mpp_descriptor' : 'data'
 results[key] = await res.json()
 } else {
 results['llms_txt'] = await res.text().then(t => t.slice(0, 500))
 }
 results.found.push(url)
 }
 } catch {}
 }

 return NextResponse.json(results, {
 headers: { 'Cache-Control': 'public, max-age=300' }
 })
}
