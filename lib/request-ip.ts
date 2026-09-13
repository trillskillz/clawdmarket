import 'server-only'
import { isIP } from 'node:net'

function normalizeIpCandidate(candidate: string) {
  let value = candidate.trim().replace(/^"|"$/g, '')
  if (!value) return null

  const bracketed = value.match(/^\[([^\]]+)](?::\d+)?$/)
  if (bracketed) value = bracketed[1]
  if (isIP(value)) return value.toLowerCase()

  const ipv4WithPort = value.match(/^([^:]+):(\d+)$/)
  if (ipv4WithPort && isIP(ipv4WithPort[1]) === 4) return ipv4WithPort[1]
  return null
}

export function getRequestIp(request: Pick<Request, 'headers'>) {
  const candidates = [
    request.headers.get('x-vercel-forwarded-for'),
    request.headers.get('x-forwarded-for'),
    request.headers.get('cf-connecting-ip'),
    request.headers.get('x-real-ip'),
  ]

  for (const header of candidates) {
    if (!header) continue
    for (const candidate of header.split(',')) {
      const normalized = normalizeIpCandidate(candidate)
      if (normalized) return normalized
    }
  }
  return 'unknown'
}
