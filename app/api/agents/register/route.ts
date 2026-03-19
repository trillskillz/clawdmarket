import { createHash, randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { isAddress } from 'viem';
import { db } from '@/lib/db';
import { agents } from '@/lib/schema';
import { mppx } from '@/lib/mpp';
import { ensureAgentsSchema } from '@/lib/agents-schema-ensure';

const paidRegisterRoute = mppx.charge({ amount: '0.01' })(async (request: Request) => {
  const req = request instanceof NextRequest ? request : new NextRequest(request);

  await ensureAgentsSchema();

  const body = await req.json().catch(() => ({} as any));
  const name = String(body?.name || '').trim();
  const description = String(body?.description || '').trim();
  const endpoint = String(body?.endpoint || '').trim();
  const ownerAddress = String(body?.owner_address || '').trim();
  const capabilities = Array.isArray(body?.capabilities) ? body.capabilities.map(String).map((s: string) => s.trim()).filter(Boolean) : [];

  if (!name || !description || !endpoint || !isAddress(ownerAddress) || capabilities.length === 0) {
    return NextResponse.json({ error: 'Invalid registration payload' }, { status: 400 });
  }

  const id = randomUUID();
  const apiKey = createHash('sha256').update(`${ownerAddress.toLowerCase()}:${Date.now()}`).digest('hex');

  await db.insert(agents).values({
    id,
    name,
    description,
    capabilities: JSON.stringify(capabilities),
    endpoint,
    owner_address: ownerAddress.toLowerCase(),
    api_key: apiKey,
    mpp_endpoint: body?.mpp_endpoint ? String(body.mpp_endpoint) : null,
    llms_txt_url: body?.llms_txt_url ? String(body.llms_txt_url) : null,
  });

  return NextResponse.json({
    agent_id: id,
    api_key: apiKey,
    endpoint: `https://clawdmkt.com/api/agents/${id}`,
  });
});

export async function POST(req: NextRequest) {
  return paidRegisterRoute(req);
}
