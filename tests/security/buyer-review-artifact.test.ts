import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { inspectBuyerArtifact } from '../../lib/buyer-review-artifact'
const trade = '11111111-1111-4111-8111-111111111111', id = '22222222-2222-4222-8222-222222222222'
const bytes = new TextEncoder().encode('<script>globalThis.exfiltrate()</script>')
const artifact = { id, size_bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), media_type: 'text/plain' }
const headers = { 'Content-Type': artifact.media_type, 'Content-Length': String(bytes.length), 'X-Artifact-SHA256': artifact.sha256 }
test('private inspection uses a fixed endpoint and inert text, never a provider URL or redirect', async () => {
  const original = globalThis.fetch
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, `/api/trades/${trade}/artifacts/${id}`); assert.equal(options?.redirect,'error'); assert.equal(options?.cache,'no-store'); assert.equal(options?.credentials,'include')
      return new Response(bytes, {headers})
    }
    assert.equal(await inspectBuyerArtifact(trade,artifact,new AbortController().signal),new TextDecoder().decode(bytes))
    await assert.rejects(inspectBuyerArtifact('https://untrusted.invalid',artifact,new AbortController().signal))
  } finally { globalThis.fetch = original }
})
test('headers cannot hide corrupt, short or oversized private artifact streams', async () => {
  const original = globalThis.fetch
  try {
    for (const payload of [new Uint8Array(bytes.length), bytes.slice(1), new Uint8Array(bytes.length + 1)]) {
      globalThis.fetch = async () => new Response(payload,{headers})
      await assert.rejects(inspectBuyerArtifact(trade,artifact,new AbortController().signal))
    }
    globalThis.fetch = async () => new Response(bytes,{headers:{...headers,'X-Artifact-SHA256':'0'.repeat(64)}})
    await assert.rejects(inspectBuyerArtifact(trade,artifact,new AbortController().signal))
    await assert.rejects(inspectBuyerArtifact(trade,{...artifact,size_bytes:65_537},new AbortController().signal))
  } finally { globalThis.fetch = original }
})
