export async function requestJson<T>(path: string, options: { method?: string; body?: unknown; apiKey?: string; signal?: AbortSignal } = {}): Promise<T> {
  const csrf = typeof document === 'undefined' ? '' : document.cookie.split('; ').find((part) => part.startsWith('csrf-token='))?.split('=')[1] || ''
  const response = await fetch(path, {
    method: options.method || 'GET', credentials: options.apiKey ? 'omit' : 'include', signal: options.signal,
    headers: {
      ...(options.body !== undefined ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf } : {}),
      ...(options.apiKey ? { 'X-Agent-API-Key': options.apiKey } : {}),
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const failed = data?.details?.checks?.filter((check: { passed: boolean }) => !check.passed).map((check: { name: string }) => check.name)
    throw new Error(`${data?.message || data?.error || `Request failed (${response.status})`}${failed?.length ? `: ${failed.join(', ')}` : ''}`)
  }
  return data as T
}
