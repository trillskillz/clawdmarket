import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { api_keys } from '@/lib/schema';
import { authenticateRequest, generateApiKey, hashApiKey, getKeyPrefix } from '@/lib/auth';
import { createApiKeySchema } from '@/lib/validation';
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit';
import { validateCsrf } from '@/lib/csrf';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cookieToken = req.cookies.get('auth-token')?.value;
  const auth = await authenticateRequest(authHeader || (cookieToken ? `Bearer ${cookieToken}` : null));

  if (!auth) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  // Validate CSRF for cookie-based auth (not for API keys)
  if (!req.headers.get('authorization') && !validateCsrf(req)) {
    return NextResponse.json(
      { error: 'CSRF validation failed' },
      { status: 403 }
    );
  }

  const rateLimitResult = rateLimit(`api-key:${auth.userId}`, { interval: 60 * 60 * 1000, maxRequests: 5 });

  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: 'Too many API key creation attempts. Please try again later.' },
      { 
        status: 429,
        headers: getRateLimitHeaders(rateLimitResult),
      }
    );
  }

  try {
    const body = await req.json();
    const validated = createApiKeySchema.parse(body);

    // Generate API key
    const apiKey = await generateApiKey();
    const keyHash = await hashApiKey(apiKey);
    const keyPrefix = getKeyPrefix(apiKey);

    // Store in database
    const [newApiKey] = await db
      .insert(api_keys)
      .values({
        user_id: auth.userId,
        key_hash: keyHash,
        key_prefix: keyPrefix,
        name: validated.name,
      })
      .returning();

    return NextResponse.json(
      {
        message: 'API key created successfully',
        api_key: apiKey, // Return the plain key ONCE
        key_info: {
          id: newApiKey.id,
          name: newApiKey.name,
          created_at: newApiKey.created_at,
        },
        warning: 'Save this key now. You won\'t be able to see it again.',
      },
      { 
        status: 201,
        headers: getRateLimitHeaders(rateLimitResult),
      }
    );
  } catch (error: any) {
    if (error.errors) {
      return NextResponse.json(
        { error: 'Validation failed', details: error.errors },
        { status: 400 }
      );
    }
    console.error('API key creation error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cookieToken = req.cookies.get('auth-token')?.value;
  const auth = await authenticateRequest(authHeader || (cookieToken ? `Bearer ${cookieToken}` : null));

  if (!auth) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  try {
    const keys = await db
      .select({
        id: api_keys.id,
        name: api_keys.name,
        last_used: api_keys.last_used,
        created_at: api_keys.created_at,
      })
      .from(api_keys)
      .where(eq(api_keys.user_id, auth.userId));

    return NextResponse.json({ keys });
  } catch (error) {
    console.error('API keys fetch error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
