const AUTH_REDIRECT_ORIGIN = 'https://clawdmkt.local'

export function safePostAuthPath(value: string | null | undefined, fallback = '/dashboard') {
  const candidate = value?.trim()
  if (!candidate || !candidate.startsWith('/') || candidate.startsWith('//')) return fallback
  if (candidate.includes('\\') || /[\r\n]/.test(candidate)) return fallback

  try {
    const target = new URL(candidate, AUTH_REDIRECT_ORIGIN)
    if (target.origin !== AUTH_REDIRECT_ORIGIN) return fallback
    if (target.pathname === '/auth/login' || target.pathname === '/auth/register') return fallback
    return `${target.pathname}${target.search}${target.hash}`
  } catch {
    return fallback
  }
}
