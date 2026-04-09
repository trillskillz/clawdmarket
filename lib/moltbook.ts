const MOLTBOOK_BASE = 'https://www.moltbook.com/api/v1'

type MoltbookResult<T> = (T & { success: true }) | { success: false; error: string }

export async function registerAgent(
  name: string,
  description: string
): Promise<MoltbookResult<{ api_key: string; claim_url: string }>> {
  try {
    const res = await fetch(`${MOLTBOOK_BASE}/agents/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description }),
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { success: false, error: `Moltbook register failed (${res.status}): ${text.slice(0, 200)}` }
    }
    const data = await res.json()
    return { success: true, api_key: data.api_key, claim_url: data.claim_url }
  } catch (err: any) {
    return { success: false, error: `Moltbook register error: ${err?.message || String(err)}` }
  }
}

export async function postToMoltbook(
  apiKey: string,
  title: string,
  content: string,
  submoltName: string
): Promise<MoltbookResult<{ post_id?: string }>> {
  try {
    const res = await fetch(`${MOLTBOOK_BASE}/posts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ submolt_name: submoltName, title, content }),
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { success: false, error: `Moltbook post failed (${res.status}): ${text.slice(0, 200)}` }
    }
    const data = await res.json()

    // Handle verification challenge
    if (data.verification_required && data.verification_code && data.challenge_text) {
      const answer = solveMathChallenge(data.challenge_text)
      if (answer === null) {
        return { success: false, error: `Could not solve verification challenge: ${data.challenge_text}` }
      }
      const verifyRes = await fetch(`${MOLTBOOK_BASE}/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          verification_code: data.verification_code,
          answer: answer.toFixed(2),
        }),
        signal: AbortSignal.timeout(10000),
      })
      if (!verifyRes.ok) {
        const vText = await verifyRes.text().catch(() => '')
        return { success: false, error: `Moltbook verify failed (${verifyRes.status}): ${vText.slice(0, 200)}` }
      }
      const verifyData = await verifyRes.json()
      return { success: true, post_id: verifyData.post_id || data.post_id }
    }

    return { success: true, post_id: data.post_id }
  } catch (err: any) {
    return { success: false, error: `Moltbook post error: ${err?.message || String(err)}` }
  }
}

export async function getAgentStatus(apiKey: string): Promise<MoltbookResult<{ status: string }>> {
  try {
    const res = await fetch(`${MOLTBOOK_BASE}/agents/status`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) {
      return { success: false, error: `Moltbook status failed (${res.status})` }
    }
    const data = await res.json()
    return { success: true, status: data.status || 'unknown' }
  } catch (err: any) {
    return { success: false, error: `Moltbook status error: ${err?.message || String(err)}` }
  }
}

function solveMathChallenge(challengeText: string): number | null {
  // Match patterns like "What is 123 + 456?", "123 * 456", "123 - 456", "123 / 456"
  const match = challengeText.match(/([\d.]+)\s*([+\-*/×÷])\s*([\d.]+)/)
  if (!match) return null
  const a = parseFloat(match[1])
  const b = parseFloat(match[3])
  const op = match[2]
  switch (op) {
    case '+': return a + b
    case '-': return a - b
    case '*': case '×': return a * b
    case '/': case '÷': return b !== 0 ? a / b : null
    default: return null
  }
}
