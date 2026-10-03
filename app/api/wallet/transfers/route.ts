import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { fundOwnedAgent } from '@/lib/account-credit'
import { walletPrincipal, walletError } from '@/lib/wallet-api'
import { requireNewPaymentsOpen } from '@/lib/payment-control'
import { ensureSyntheticAgentUser } from '@/lib/registered-agent-auth'
import { accountOwnsAgent } from '@/lib/agent-owner-auth'
export const dynamic = 'force-dynamic'
const schema = z.object({ agent_id: z.string().min(1).max(200), amount_minor: z.number().int().min(1).max(100_000), client_reference: z.string().min(8).max(160) }).strict()
export async function POST(request: NextRequest) {
  try {
    const principal = await walletPrincipal(request, true)
    if (!principal) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const input = schema.safeParse(await request.json().catch(() => null))
    if (!input.success) return NextResponse.json({ error: 'Invalid agent credit transfer' }, { status: 400 })
    if (principal.kind !== 'account' || principal.agentId || !await accountOwnsAgent(principal.userId, input.data.agent_id)) return NextResponse.json({ error: 'Only the current account owner can fund this agent' }, { status: 403 })
    await requireNewPaymentsOpen()
    await ensureSyntheticAgentUser({ agentId: input.data.agent_id, name: input.data.agent_id, syntheticUserId: `user_agent_${input.data.agent_id}` })
    return NextResponse.json(await fundOwnedAgent(principal.userId, input.data.agent_id, input.data.amount_minor, input.data.client_reference))
  } catch (error) { return walletError(error) }
}
