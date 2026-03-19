import { and, eq } from 'drizzle-orm';
import { Credential } from 'mppx';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ensureAgentsSchema } from '@/lib/agents-schema-ensure';
import { mppx } from '@/lib/mpp';
import { agents } from '@/lib/schema';

function addressFromSource(source?: string | null) {
  if (!source) return null;
  const match = source.match(/0x[a-fA-F0-9]{40}/);
  return match ? match[0].toLowerCase() : null;
}

const paidDeleteRoute = mppx.charge({ amount: '0.001' })(async (request: Request) => {
  const req = request instanceof NextRequest ? request : new NextRequest(request);
  await ensureAgentsSchema();

  const id = req.nextUrl.pathname.split('/').pop();
  if (!id) return NextResponse.json({ error: 'missing_id' }, { status: 400 });

  const [agent] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
  if (!agent) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  let payerAddress: string | null = null;
  try {
    const credential = Credential.fromRequest(req);
    payerAddress = addressFromSource(credential.source ?? null);
  } catch {
    // ignore parsing error
  }

  if (!payerAddress || payerAddress !== agent.owner_address.toLowerCase()) {
    return NextResponse.json({ error: 'forbidden', message: 'Payer must match agent owner_address.' }, { status: 403 });
  }

  await db
    .update(agents)
    .set({ status: 'inactive' })
    .where(and(eq(agents.id, id), eq(agents.owner_address, payerAddress)));

  return NextResponse.json({ ok: true });
});

export async function DELETE(req: NextRequest) {
  return paidDeleteRoute(req);
}
