import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { users, api_keys, agent_profiles } from '@/lib/schema';
import { agentSelfRegistrationSchema } from '@/lib/validation';
import { ensureUsersSchema } from '@/lib/users-schema-ensure';
import { ensureAgentProfilesSchema } from '@/lib/agent-profiles-schema-ensure';
import { generateApiKey, getKeyPrefix, hashApiKey, hashPassword } from '@/lib/auth';
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit';
import { fireWebhook } from '@/lib/webhooks';

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
  const rateLimitResult = rateLimit(`agent-register:${ip}`, { interval: 60 * 1000, maxRequests: 10 });

  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: 'Too many registration attempts. Please try again later.' },
      {
        status: 429,
        headers: getRateLimitHeaders(rateLimitResult),
      }
    );
  }

  try {
    await ensureUsersSchema();
    await ensureAgentProfilesSchema();

    const body = await req.json();
    const validated = agentSelfRegistrationSchema.parse(body);

    const fallbackEmail = `agent-${crypto.randomUUID()}@agents.clawdmkt.local`;
    const syntheticPassword = `A1x${crypto.randomUUID()}!`;
    const password_hash = await hashPassword(syntheticPassword);

    const [newAgent] = await db
      .insert(users)
      .values({
        email: fallbackEmail,
        password_hash,
        name: validated.name,
        role: 'agent',
        bio: validated.description,
        wallet: validated.wallet_address ?? null,
      })
      .returning();

    const agentApiKey = await generateApiKey();
    const keyHash = await hashApiKey(agentApiKey);
    const keyPrefix = getKeyPrefix(agentApiKey);

    await db.insert(api_keys).values({
      user_id: newAgent.id,
      key_hash: keyHash,
      key_prefix: keyPrefix,
      name: 'agent-self-registration',
    });

    await db.insert(agent_profiles).values({
      user_id: newAgent.id,
      capabilities_json: JSON.stringify(validated.capabilities),
      pricing_model_json: JSON.stringify(validated.pricing_model),
      callback_url: validated.callback_url,
      metadata_json: validated.metadata ? JSON.stringify(validated.metadata) : null,
      identity_type: validated.wallet_address ? 'wallet' : 'api_key',
      identity_value: validated.wallet_address || validated.identity_api_key || '',
    });

    await fireWebhook(newAgent.id, 'agent.registered', {
      agent: {
        id: newAgent.id,
        name: newAgent.name,
      },
      capabilities: validated.capabilities,
      pricing_model: validated.pricing_model,
    });

    return NextResponse.json(
      {
        message: 'Agent registered successfully',
        agent: {
          id: newAgent.id,
          name: newAgent.name,
          description: newAgent.bio || '',
          capabilities: validated.capabilities,
          pricing_model: validated.pricing_model,
          callback_url: validated.callback_url,
          metadata: validated.metadata || {},
          identity: validated.wallet_address
            ? { type: 'wallet', wallet_address: validated.wallet_address }
            : { type: 'api_key' },
        },
        api_key: agentApiKey,
        warning: 'Save this API key now. It will not be shown again.',
      },
      {
        status: 201,
        headers: getRateLimitHeaders(rateLimitResult),
      }
    );
  } catch (error: any) {
    if (error?.errors) {
      return NextResponse.json(
        { error: 'Validation failed', details: error.errors },
        { status: 400, headers: getRateLimitHeaders(rateLimitResult) }
      );
    }

    console.error('Agent self-registration error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: getRateLimitHeaders(rateLimitResult) }
    );
  }
}
