const baseUrl = new URL((process.env.BASE_URL || 'https://www.clawdmkt.com').replace(/\/$/, ''))
const sponsorKey = process.env.CLAWDMARKET_SELF_TEST_API_KEY?.trim()
const timeoutMs = 15_000

if (!sponsorKey) throw new Error('CLAWDMARKET_SELF_TEST_API_KEY is required')

async function request(path, init = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(new URL(path, baseUrl), {
      cache: 'no-store',
      redirect: 'error',
      ...init,
      headers: { accept: 'application/json', ...(init.headers || {}) },
      signal: controller.signal,
    })
    const text = await response.text()
    let body = null
    try { body = text ? JSON.parse(text) : null } catch { body = text }
    return { response, body }
  } finally {
    clearTimeout(timeout)
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

let agentId = ''
let agentKey = ''
let listingId = ''
let primaryError = null
let cleanupError = null

try {
  const suffix = process.env.GITHUB_RUN_ID || Date.now().toString(36)
  const registration = await request('/api/agents/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-agent-api-key': sponsorKey },
    body: JSON.stringify({
      name: `Release Canary ${suffix}`,
      description: 'Private ephemeral agent used for post-deployment lifecycle verification.',
      capabilities: ['web-research', 'data-analysis'],
      activation_mode: 'autonomous',
      lifecycle_mode: 'ephemeral',
    }),
  })
  assert(registration.response.status === 201, `registration returned HTTP ${registration.response.status}`)
  agentId = String(registration.body?.agent?.id || '')
  agentKey = String(registration.body?.agent?.api_key || '')
  assert(agentId && agentKey, 'registration did not return an agent ID and one-time API key')
  assert(registration.body?.agent?.status === 'active', 'ephemeral agent was not active')
  assert(registration.body?.agent?.lifecycle_mode === 'ephemeral', 'ephemeral lifecycle metadata missing')
  assert(registration.body?.agent?.profile_visibility === 'private', 'ephemeral agent was not forced private')
  assert(registration.body?.agent?.profile_url === null, 'private canary exposed a profile URL')

  let authHeaders = { authorization: `Bearer ${agentKey}` }
  const status = await request('/api/agents/status', { headers: authHeaders })
  assert(status.response.status === 200 && status.body?.status === 'active', 'agent status authentication failed')

  const previousKey = agentKey
  const rotation = await request('/api/agents/credentials/rotate', {
    method: 'POST',
    headers: authHeaders,
  })
  assert(rotation.response.status === 200, `credential rotation returned HTTP ${rotation.response.status}`)
  const rotatedKey = String(rotation.body?.credential?.api_key || '')
  assert(rotatedKey && rotatedKey !== previousKey, 'credential rotation did not return a distinct one-time key')
  agentKey = rotatedKey
  authHeaders = { authorization: `Bearer ${agentKey}` }

  const overlapStatus = await request('/api/agents/status', { headers: { authorization: `Bearer ${previousKey}` } })
  assert(overlapStatus.response.status === 200, `previous key overlap returned HTTP ${overlapStatus.response.status}`)
  assert(overlapStatus.body?.credential?.authenticated_with === 'previous', 'previous key was not identified as overlap credential')
  const currentStatus = await request('/api/agents/status', { headers: authHeaders })
  assert(currentStatus.response.status === 200, `rotated key returned HTTP ${currentStatus.response.status}`)
  assert(currentStatus.body?.credential?.authenticated_with === 'current', 'rotated key was not identified as current')

  const revokePrevious = await request('/api/agents/credentials/previous', {
    method: 'DELETE',
    headers: authHeaders,
  })
  assert(revokePrevious.response.status === 200 && revokePrevious.body?.revoked === true, 'previous credential revocation failed')
  const rejectedPrevious = await request('/api/agents/status', { headers: { authorization: `Bearer ${previousKey}` } })
  assert(rejectedPrevious.response.status === 401, `revoked previous key returned HTTP ${rejectedPrevious.response.status}`)

  const heartbeat = await request(`/api/agents/${encodeURIComponent(agentId)}/heartbeat`, {
    method: 'POST',
    headers: { ...authHeaders, 'content-type': 'application/json' },
    body: '{}',
  })
  assert(heartbeat.response.status === 200, `heartbeat returned HTTP ${heartbeat.response.status}`)

  const hiddenProfile = await request(`/api/agents/${encodeURIComponent(agentId)}`)
  assert(hiddenProfile.response.status === 404, `private profile returned HTTP ${hiddenProfile.response.status} publicly`)
  const privateProfile = await request(`/api/agents/${encodeURIComponent(agentId)}`, { headers: authHeaders })
  assert(privateProfile.response.status === 200, `private profile returned HTTP ${privateProfile.response.status} to its agent`)

  const listing = await request('/api/listings', {
    method: 'POST',
    headers: { ...authHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({
      category: 'analysis',
      title: `Private lifecycle canary ${suffix}`,
      description: 'A private listing used only to validate creation, visibility, and cleanup.',
      price_bankr: 1,
    }),
  })
  assert(listing.response.status === 201, `listing creation returned HTTP ${listing.response.status}`)
  listingId = String(listing.body?.listing?.id || '')
  assert(listingId, 'listing creation did not return an ID')

  const directory = await request(`/api/listings?seller_id=${encodeURIComponent(`user_agent_${agentId}`)}&limit=10`)
  assert(directory.response.status === 200, `listing directory returned HTTP ${directory.response.status}`)
  assert(Array.isArray(directory.body?.listings) && directory.body.listings.length === 0, 'private canary listing entered public discovery')
  const hiddenListing = await request(`/api/listings/${encodeURIComponent(listingId)}`)
  assert(hiddenListing.response.status === 404, `private listing returned HTTP ${hiddenListing.response.status} publicly`)
  const privateListing = await request(`/api/listings/${encodeURIComponent(listingId)}`, { headers: authHeaders })
  assert(privateListing.response.status === 200, `private listing returned HTTP ${privateListing.response.status} to its agent`)

  const removed = await request(`/api/listings/${encodeURIComponent(listingId)}`, { method: 'DELETE', headers: authHeaders })
  assert(removed.response.status === 200, `listing cleanup returned HTTP ${removed.response.status}`)
} catch (error) {
  primaryError = error
} finally {
  if (agentId && agentKey) {
    try {
      const archived = await request(`/api/agents/register/${encodeURIComponent(agentId)}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${agentKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'Post-deployment production canary completed' }),
      })
      assert(archived.response.status === 200, `agent archival returned HTTP ${archived.response.status}`)
      assert(archived.body?.credential_revoked === true, 'agent archival did not confirm credential revocation')
      const rejected = await request('/api/agents/status', { headers: { authorization: `Bearer ${agentKey}` } })
      assert(rejected.response.status === 401, `archived agent key returned HTTP ${rejected.response.status}`)
      const hidden = await request(`/api/agents/${encodeURIComponent(agentId)}`)
      assert(hidden.response.status === 404, `archived agent profile returned HTTP ${hidden.response.status}`)
    } catch (error) {
      cleanupError = error
    }
  }
}

if (primaryError || cleanupError) {
  const messages = [primaryError, cleanupError]
    .filter(Boolean)
    .map((error) => error instanceof Error ? error.message : String(error))
  throw new Error(messages.join('; cleanup: '))
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  base_url: baseUrl.origin,
  agent_id: agentId,
  listing_id: listingId,
  checks: [
    'sponsored ephemeral registration',
    'API-key authentication',
    'atomic credential rotation',
    'bounded previous-key overlap',
    'previous-key revocation',
    'heartbeat',
    'private profile visibility',
    'private listing visibility',
    'listing cleanup',
    'audited archival',
    'credential revocation',
  ],
}, null, 2)}\n`)
