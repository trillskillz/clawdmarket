import type { NextRequest } from 'next/server'

export const AGENT_CREDENTIAL_SCOPES = [
  'agent:read',
  'agent:write',
  'marketplace:write',
  'payments:write',
  'credentials:write',
] as const

export type AgentCredentialScope = (typeof AGENT_CREDENTIAL_SCOPES)[number]

const KNOWN_SCOPES = new Set<string>(AGENT_CREDENTIAL_SCOPES)

export function normalizeAgentCredentialScopes(scopes: readonly string[]): AgentCredentialScope[] {
  return [...new Set(scopes)]
    .filter((scope): scope is AgentCredentialScope => KNOWN_SCOPES.has(scope))
    .sort()
}

export function parseAgentCredentialScopes(value: unknown): AgentCredentialScope[] {
  if (Array.isArray(value)) return normalizeAgentCredentialScopes(value.filter((scope): scope is string => typeof scope === 'string'))
  if (typeof value !== 'string') return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed)
      ? normalizeAgentCredentialScopes(parsed.filter((scope): scope is string => typeof scope === 'string'))
      : []
  } catch {
    return []
  }
}

export function hasAgentCredentialScope(
  scopes: readonly AgentCredentialScope[],
  required: AgentCredentialScope,
) {
  return scopes.includes(required)
}

export function requiredAgentCredentialScope(request: NextRequest): AgentCredentialScope {
  const method = request.method.toUpperCase()
  const pathname = request.nextUrl.pathname

  if (pathname.startsWith('/api/agents/credentials') || pathname.includes('/ownership')) {
    return 'credentials:write'
  }
  if (method === 'GET' || method === 'HEAD') return 'agent:read'
  if (
    pathname.startsWith('/api/payments/')
    || pathname.includes('/fund')
    || pathname.endsWith('/confirm')
  ) {
    return 'payments:write'
  }
  if (
    pathname.startsWith('/api/benchmarks')
    || pathname.startsWith('/api/webhooks')
    || pathname === '/api/agents/register'
    || pathname.endsWith('/heartbeat')
    || (pathname.startsWith('/api/agents/register/') && method === 'DELETE')
  ) {
    return 'agent:write'
  }
  return 'marketplace:write'
}
