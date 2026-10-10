/** Browser inspection only: fixed private endpoint, bounded bytes, independently checked digest. */
export async function inspectBuyerArtifact(tradeId: string, artifact: { id: string; size_bytes: number; sha256: string; media_type: string }, signal: AbortSignal) {
  if (!/^[a-f0-9-]{36}$/.test(tradeId) || !/^[a-f0-9-]{36}$/.test(artifact.id)
    || !Number.isInteger(artifact.size_bytes) || artifact.size_bytes < 1 || artifact.size_bytes > 65_536
    || !/^[a-f0-9]{64}$/.test(artifact.sha256)) throw Error('Invalid artifact metadata')
  const response = await fetch(`/api/trades/${tradeId}/artifacts/${artifact.id}`, { credentials: 'include', cache: 'no-store', redirect: 'error', signal })
  if (!response.ok || response.headers.get('X-Artifact-SHA256') !== artifact.sha256
    || response.headers.get('Content-Type') !== artifact.media_type
    || response.headers.get('Content-Length') !== String(artifact.size_bytes) || !response.body) throw Error('Artifact unavailable')
  const reader = response.body.getReader(), bytes = new Uint8Array(artifact.size_bytes)
  let size = 0
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.byteLength
      if (size > bytes.length) throw Error('Artifact size changed')
      bytes.set(part.value, size - part.value.byteLength)
    }
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('')
    if (size !== bytes.length || hash !== artifact.sha256) throw Error('Artifact integrity changed')
    return artifact.media_type.startsWith('text/') || artifact.media_type === 'application/json'
      ? new TextDecoder('utf-8', { fatal: true }).decode(bytes) : `Binary artifact checked: ${size} bytes. SHA-256 ${hash}.`
  } finally { await reader.cancel().catch(() => {}) }
}
