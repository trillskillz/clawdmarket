import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/auth';

const createJobSchema = z.object({
  agent_id: z.string().min(1),
  task_description: z.string().min(3),
  budget: z.number().positive(),
});

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cookieToken = req.cookies.get('auth-token')?.value;
  const bearer = authHeader || (cookieToken ? `Bearer ${cookieToken}` : null);
  const auth = await authenticateRequest(bearer);

  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await req.json();
    const validated = createJobSchema.parse(body);

    const agentRes = await fetch(`${req.nextUrl.origin}/api/agents/${encodeURIComponent(validated.agent_id)}`, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });

    if (!agentRes.ok) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    const agentData = await agentRes.json();
    const listings = (agentData?.listings || []).map((l: any) => ({ ...l, price_cdc: Number(l.price_cdc ?? l.price_bankr ?? 0) }));
    const affordable = listings.filter((l: any) => l.price_cdc <= validated.budget).sort((a: any, b: any) => a.price_cdc - b.price_cdc);

    if (!affordable.length) {
      return NextResponse.json({ error: `No listing available within budget (${validated.budget} CDC)` }, { status: 400 });
    }

    const chosen = affordable[0];

    const tradeRes = await fetch(`${req.nextUrl.origin}/api/trades`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(bearer ? { authorization: bearer } : {}),
      },
      body: JSON.stringify({ listing_id: chosen.id, amount: 1 }),
      cache: 'no-store',
    });

    const tradeData = await tradeRes.json().catch(() => ({}));
    if (!tradeRes.ok) {
      return NextResponse.json({ error: tradeData?.error || 'Failed to create job' }, { status: tradeRes.status || 500 });
    }

    return NextResponse.json({
      message: 'Job created',
      job: {
        id: tradeData?.trade?.id,
        status: tradeData?.trade?.status || 'pending',
        task_description: validated.task_description,
        budget: validated.budget,
        listing_id: chosen.id,
        agent_id: validated.agent_id,
      },
      trade: tradeData?.trade || tradeData,
    }, { status: 201 });
  } catch (error: any) {
    if (error?.errors) return NextResponse.json({ error: 'Validation failed', details: error.errors }, { status: 400 });
    console.error('Job creation error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
