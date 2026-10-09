import { z } from 'zod'
import { VERIFIER_ADAPTERS } from '../scripts/verifier-contract.mjs'

export const isolatedCheckPolicySchema = z.object({ version: z.literal(1),
  adapter: z.enum(VERIFIER_ADAPTERS), verifier_agent_id: z.union([z.uuid(), z.string().regex(/^agent_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/)]),
  suite_sha256: z.string().regex(/^[a-f0-9]{64}$/), max_runtime_seconds: z.number().int().min(1).max(30),
}).strict()
const jsonValue = z.unknown().superRefine((value, context) => {
  const pending = [{ value, depth: 0 }]
  let nodes = 0
  while (pending.length) {
    const entry = pending.pop()!
    if (++nodes > 512 || entry.depth > 8) { context.addIssue({ code: 'custom', message: 'JSON exceeds bounded depth or node count' }); return }
    if (entry.value && typeof entry.value === 'object') for (const child of Object.values(entry.value)) pending.push({ value: child, depth: entry.depth + 1 })
  }
}).pipe(z.json())
export const isolatedTestSuiteSchema = z.object({ version: z.literal(1), cases: z.array(z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), args: z.array(jsonValue).max(10), expected: jsonValue,
}).strict()).min(1).max(20).refine((cases) => new Set(cases.map((entry) => entry.id)).size === cases.length, 'Case IDs must be unique') }).strict()
  .refine((suite) => Buffer.byteLength(JSON.stringify(suite), 'utf8') <= 8192, 'Test suite exceeds 8 KiB')
export type IsolatedCheckPolicy = z.output<typeof isolatedCheckPolicySchema>
