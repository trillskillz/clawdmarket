function firstHeaderValue(value: string | null) {
  return value?.split(',')[0]?.trim() || ''
}

export function getRequestOrigin(request: Request): string {
  const parsedUrl = new URL(request.url)
  const host = firstHeaderValue(request.headers.get('x-forwarded-host'))
    || firstHeaderValue(request.headers.get('host'))
    || parsedUrl.host
  const forwardedProtocol = firstHeaderValue(request.headers.get('x-forwarded-proto')).replace(/:$/, '')
  const protocol = forwardedProtocol === 'http' || forwardedProtocol === 'https'
    ? forwardedProtocol
    : parsedUrl.protocol.replace(/:$/, '')

  return `${protocol}://${host}`
}
