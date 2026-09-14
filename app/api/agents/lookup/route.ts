import { isIP } from 'node:net'
import { NextRequest } from 'next/server'
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit'
import { safeExternalFetch } from '@/lib/webhook-url'
import { getRequestIp } from '@/lib/request-ip'

export const dynamic = 'force-dynamic'

const MAX_DISCOVERY_BYTES = 64 * 1024

function isValidDomain(domain: string): boolean {
 if (domain.length > 253 || !domain.includes('.') || isIP(domain)) return false
 return domain.split('.').every((label) => (
 label.length > 0
 && label.length <= 63
 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
 ))
}

async function readLimitedBody(response: Response): Promise<string> {
 if (!response.body) return ''
 const reader = response.body.getReader()
 const decoder = new TextDecoder()
 let total = 0
 let body = ''
 while (true) {
 const { done, value } = await reader.read()
 if (done) break
 total += value.byteLength
 if (total > MAX_DISCOVERY_BYTES) {
 await reader.cancel()
 throw new Error('response_too_large')
 }
 body += decoder.decode(value, { stream: true })
 }
 return body + decoder.decode()
}

export async function GET(request: NextRequest) {
 const ip = getRequestIp(request)
 const limit = await rateLimit(`agent-lookup:${ip}`, { interval: 60_000, maxRequests: 20, failClosed: true })
 if (!limit.success) {
 return Response.json({ error: 'rate_limit_exceeded' }, { status: 429, headers: getRateLimitHeaders(limit) })
 }

 const domain = request.nextUrl.searchParams.get('domain')

 if (!domain) {
 return Response.json({ error: 'domain required' }, { status: 400 })
 }

 const clean = domain.trim().toLowerCase().replace(/\.$/, '')
 if (!isValidDomain(clean)) return Response.json({ error: 'invalid domain' }, { status: 400 })

 const urls = [
 `https://${clean}/.well-known/agent.json`,
 `https://${clean}/llms.txt`,
 `https://${clean}/.well-known/mpp.json`,
 ]

 const results: Record<string, any> = { domain: clean, found: [], name: null }

 for (const url of urls) {
 try {
 const res = await safeExternalFetch(url, {
 headers: { 'User-Agent': 'ClawdMarket/1.0 agent-lookup' },
 signal: AbortSignal.timeout(5000),
 maxResponseBytes: MAX_DISCOVERY_BYTES,
 })
 if (res.ok) {
 const body = await readLimitedBody(res)
 const contentType = res.headers.get('content-type') || ''
 if (contentType.includes('json')) {
 const data = JSON.parse(body)
 const key = url.includes('agent.json') ? 'agent_card' : url.includes('mpp') ? 'mpp_descriptor' : 'data'
 results[key] = data

 if (key === 'agent_card') {
 const name = data?.name || data?.agent_name || data?.title || 'ClawdMarket'
 results.name = name
 }
 } else {
 results['llms_txt'] = body.slice(0, 500)
 }
 results.found.push(url)
 }
 } catch {}
 }

 return Response.json(results, {
 headers: { 'Cache-Control': 'public, max-age=300', ...getRateLimitHeaders(limit) }
 })
}
