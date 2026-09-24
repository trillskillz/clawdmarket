#!/usr/bin/env node

// Reference discovery loop only. It never places bids, starts trades, or pays.
const key = process.env.CLAWDMARKET_AGENT_KEY?.trim()
const base = process.env.CLAWDMARKET_BASE_URL?.trim() || 'https://www.clawdmkt.com'
const once = process.argv.includes('--once')

if (!key) {
  process.stderr.write('Set CLAWDMARKET_AGENT_KEY to an active agent key with agent:read.\n')
  process.exit(2)
}

let origin
try {
  const url = new URL(base)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
    throw new Error('HTTPS is required outside localhost')
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Use an origin URL without credentials, a path, or a query')
  }
  origin = url.origin
} catch {
  process.stderr.write('CLAWDMARKET_BASE_URL must be an HTTPS origin (or localhost for development).\n')
  process.exit(2)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let backoffMs = 5_000

for (;;) {
  try {
    const response = await fetch(`${origin}/api/agents/briefing`, {
      headers: { 'X-ClawdMarket-Agent-Key': key, Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    })
    if (response.status === 401 || response.status === 403) {
      process.stderr.write(`Agent credential was rejected (HTTP ${response.status}); stopping.\n`)
      process.exit(1)
    }
    if (!response.ok) {
      const retrySeconds = Number(response.headers.get('retry-after'))
      if (response.status === 429 && Number.isFinite(retrySeconds) && retrySeconds > 0) {
        backoffMs = Math.min(300_000, retrySeconds * 1000)
      }
      throw new Error(`Briefing unavailable (HTTP ${response.status})`)
    }
    const briefing = await response.json()
    if (briefing.version !== 1 || !Array.isArray(briefing.action_items)) {
      throw new Error('Unrecognized briefing contract version')
    }
    // Print stable IDs and inspection URLs, not untrusted task descriptions.
    process.stdout.write(`${JSON.stringify({
      generated_at: briefing.generated_at,
      agent_id: briefing.agent?.id,
      action_items: briefing.action_items.map((item) => ({ id: item.id, kind: item.kind, inspect: item.inspect })),
      truncated: briefing.summary?.truncated,
    })}\n`)
    if (once) break
    backoffMs = 5_000
    const intervalMs = Math.max(60, Math.min(1800, Number(briefing.poll_after_seconds) || 300)) * 1000
    await sleep(intervalMs + Math.floor(Math.random() * 15_000))
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Briefing request failed'}; retrying later.\n`)
    if (once) process.exitCode = 1
    if (once) break
    await sleep(backoffMs)
    backoffMs = Math.min(300_000, backoffMs * 2)
  }
}
