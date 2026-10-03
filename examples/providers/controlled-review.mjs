import { createHash } from 'node:crypto'

/** Deterministic controlled test, not an independent or semantic code review. */
export default async function review(work, { signal, idempotencyKey }) {
  signal.throwIfAborted()
  if (typeof work.input.sample !== 'string') throw new Error('SAMPLE_REQUIRED')
  return {
    summary: 'Controlled provider processed the supplied sample outside the application and recorded its hash for buyer review.',
    artifact: { kind: 'controlled_review', sample_sha256: createHash('sha256').update(work.input.sample).digest('hex'),
      sample_bytes: Buffer.byteLength(work.input.sample), execution_attempt_id: idempotencyKey,
      semantic_verified: false },
  }
}
