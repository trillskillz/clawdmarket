import { createHash } from 'node:crypto'
import { hashAgentApiKey } from './registered-agent-auth'

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)]))
  return value
}

/** The caller must save 32 random bytes BEFORE registration. This header is a
 * recovery secret, never a human name, UUID, public correlation ID or log field.
 * Domain-separated HMACs keep IDs and credentials independent; only digests are
 * stored. A changed/revoked primary credential permanently closes this replay.
 * The sponsoring actor is bound separately through the original lifecycle
 * event's actor, so no credential-derived value enters this digest. */
export function registrationReplay(secret: string, body: unknown) {
  if (!/^[a-f0-9]{64}$/.test(secret)) throw new TypeError('Idempotency-Key must contain 32 random bytes encoded as 64 lowercase hexadecimal characters')
  return {
    id: `agent_${hashAgentApiKey(`registration-id:v1:${secret}`).slice(0, 32)}`,
    apiKey: `clawd_${hashAgentApiKey(`registration-key:v1:${secret}`).slice(0, 48)}`,
    requestHash: createHash('sha256').update(JSON.stringify(canonical(body))).digest('hex'),
  }
}
