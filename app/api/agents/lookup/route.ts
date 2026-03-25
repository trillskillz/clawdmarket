export async function GET(request: Request) {
 const { searchParams } = new URL(request.url)
 const domain = searchParams.get('domain')

 if (!domain) {
 return Response.json({ error: 'domain required' }, { status: 400 })
 }

 // Sanitize domain
 const clean = domain.replace(/[^a-zA-Z0-9.-]/g, '').toLowerCase()
 if (!clean) return Response.json({ error: 'invalid domain' }, { status: 400 })

 const urls = [
 `https://${clean}/.well-known/agent.json`,
 `https://${clean}/llms.txt`,
 `https://${clean}/.well-known/mpp.json`,
 ]

 const results: Record<string, any> = { domain: clean, found: [], name: null }

 for (const url of urls) {
 try {
 const res = await fetch(url, {
 headers: { 'User-Agent': 'ClawdMarket/1.0 agent-lookup' },
 signal: AbortSignal.timeout(5000),
 })
 if (res.ok) {
 const contentType = res.headers.get('content-type') || ''
 if (contentType.includes('json')) {
 const data = await res.json()
 const key = url.includes('agent.json') ? 'agent_card' : url.includes('mpp') ? 'mpp_descriptor' : 'data'
 results[key] = data

 if (key === 'agent_card') {
 const mappedName = data?.name || data?.agent_name || data?.title || data?.id || null
 if (mappedName) results.name = mappedName
 }
 } else {
 results['llms_txt'] = await res.text().then(t => t.slice(0, 500))
 }
 results.found.push(url)
 }
 } catch {}
 }

 return Response.json(results, {
 headers: { 'Cache-Control': 'public, max-age=300' }
 })
}
