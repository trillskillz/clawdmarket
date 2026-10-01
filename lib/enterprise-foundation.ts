import { z } from 'zod'

export const organizationInput = z.object({
  client_reference: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),
  name: z.string().trim().min(1).max(120),
}).strict()

export const assignmentInput = z.object({
  agent_id: z.string().min(1).max(200),
  cost_center: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/),
}).strict()

export function enterpriseFoundationEnabled() {
  return process.env.CLAWDMARKET_ENTERPRISE_FOUNDATION_ENABLED === 'true'
    || (process.env.NODE_ENV !== 'production' && process.env.CLAWDMARKET_ENTERPRISE_FOUNDATION_ENABLED !== 'false')
}

export function organizationDto(row: { id: string, name: string, created_at: Date, updated_at: Date }) {
  return { id: row.id, name: row.name, created_at: row.created_at.toISOString(), updated_at: row.updated_at.toISOString(),
    authority: 'accounting_only' as const }
}
