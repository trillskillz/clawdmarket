import 'server-only'
import { z } from 'zod'
import { normalizeCapability } from './capabilities'
import { money } from './service-definitions'
import type { workflow_nodes, workflows } from './schema'

const capabilityList = z.array(z.string().trim().min(1).max(80)).min(1).max(20)
const workflowNodeInput = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/),
  objective: z.string().trim().min(10).max(2_000),
  required_capabilities: capabilityList,
  budget: z.object({ amount: money, currency: z.literal('USD') }).strict(),
  depends_on: z.array(z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/)).max(15).default([]),
  deadline_seconds: z.number().int().min(1).max(30 * 24 * 3600),
}).strict()

export const workflowPlanInput = z.object({
  client_reference: z.string().trim().min(8).max(200),
  objective: z.string().trim().min(10).max(2_000),
  max_budget: z.object({ amount: money, currency: z.literal('USD') }).strict(),
  deadline_seconds: z.number().int().min(1).max(30 * 24 * 3600),
  nodes: z.array(workflowNodeInput).min(1).max(16),
}).strict()

type Input = z.output<typeof workflowPlanInput>
export type NormalizedWorkflow = ReturnType<typeof normalizeWorkflow>

function minorAmount(value: number) {
  const amount = BigInt(value)
  return `${amount / 100n}.${String(amount % 100n).padStart(2, '0')}`
}

export class WorkflowPlanError extends Error {
  constructor(readonly code: string, message: string) { super(message) }
}

/** Deterministic DAG normalization; budgets are hard upper bounds, not prices or reservations. */
export function normalizeWorkflow(input: Input) {
  const byKey = new Map(input.nodes.map((node) => [node.key, node]))
  if (byKey.size !== input.nodes.length) throw new WorkflowPlanError('WORKFLOW_DUPLICATE_NODE', 'Node keys must be unique')
  const depthByKey = new Map<string, number>()
  const visiting = new Set<string>()
  const depth = (key: string): number => {
    if (visiting.has(key)) throw new WorkflowPlanError('WORKFLOW_CYCLE', 'Node dependencies must form an acyclic graph')
    const prior = depthByKey.get(key)
    if (prior !== undefined) return prior
    const node = byKey.get(key)
    if (!node) throw new WorkflowPlanError('WORKFLOW_UNKNOWN_DEPENDENCY', `Unknown dependency: ${key}`)
    visiting.add(key)
    const dependencies = new Set(node.depends_on)
    if (dependencies.size !== node.depends_on.length) throw new WorkflowPlanError('WORKFLOW_DUPLICATE_DEPENDENCY', 'Dependencies must be unique')
    const value = dependencies.size ? 1 + Math.max(...[...dependencies].map(depth)) : 0
    visiting.delete(key)
    if (value > 3) throw new WorkflowPlanError('WORKFLOW_DEPTH_LIMIT', 'Workflow depth cannot exceed three dependency edges')
    depthByKey.set(key, value)
    return value
  }
  let allocatedMinor = 0
  const nodes = input.nodes.map((node) => {
    const nodeDepth = depth(node.key)
    if (node.deadline_seconds > input.deadline_seconds) throw new WorkflowPlanError('WORKFLOW_DEADLINE_EXCEEDED', 'A node deadline exceeds the workflow deadline')
    if (node.depends_on.some((dependency) => {
      const prerequisite = byKey.get(dependency)
      return prerequisite && prerequisite.deadline_seconds > node.deadline_seconds
    })) throw new WorkflowPlanError('WORKFLOW_DEPENDENCY_DEADLINE', 'A prerequisite deadline exceeds its dependent node deadline')
    const capabilities = [...new Set(node.required_capabilities.map((item) => {
      const normalized = normalizeCapability(item)
      if (!normalized) throw new WorkflowPlanError('WORKFLOW_UNKNOWN_CAPABILITY', `Unknown capability: ${item}`)
      return normalized
    }))]
    allocatedMinor += node.budget.amount
    if (allocatedMinor > input.max_budget.amount) throw new WorkflowPlanError('WORKFLOW_BUDGET_EXCEEDED', 'Child budgets exceed the workflow maximum')
    return { key: node.key, objective: node.objective, required_capabilities: capabilities,
      budget_minor: node.budget.amount, depends_on: [...node.depends_on].sort(),
      deadline_seconds: node.deadline_seconds, depth: nodeDepth }
  }).sort((a, b) => a.key.localeCompare(b.key))
  return { objective: input.objective, max_budget_minor: input.max_budget.amount,
    deadline_seconds: input.deadline_seconds, nodes, allocated_minor: allocatedMinor }
}

export function workflowDto(workflow: typeof workflows.$inferSelect, nodes: Array<typeof workflow_nodes.$inferSelect>) {
  return {
    id: workflow.id, client_reference: workflow.client_reference, objective: workflow.objective,
    state: workflow.state, execution_available: false, funds_moved: false,
    max_budget: { amount: minorAmount(workflow.max_budget_minor), currency: workflow.currency },
    allocated_budget: { amount: minorAmount(nodes.reduce((sum, node) => sum + node.budget_minor, 0)), currency: workflow.currency },
    deadline_seconds: workflow.deadline_seconds,
    nodes: nodes.sort((a, b) => a.node_key.localeCompare(b.node_key)).map((node) => ({
      key: node.node_key, objective: node.objective, required_capabilities: JSON.parse(node.required_capabilities) as string[],
      budget: { amount: minorAmount(node.budget_minor), currency: workflow.currency },
      depends_on: JSON.parse(node.depends_on) as string[], deadline_seconds: node.deadline_seconds,
      depth: node.depth, state: node.state, route_id: node.route_id,
    })),
    created_at: workflow.created_at, updated_at: workflow.updated_at,
  }
}
