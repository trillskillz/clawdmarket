import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { analytics_events } from '@/lib/schema';
import { authenticateRequest } from '@/lib/auth';
import { z } from 'zod';
import crypto from 'crypto';

const trackEventSchema = z.object({
  event_type: z.enum([
    'view_listing',
    'trade_init',
    'search',
    'add_favorite',
    'remove_favorite',
    'view_profile',
    'copy_install_cmd'
  ]),
  metadata: z.record(z.any()).optional(),
});

async function ensureAnalyticsTable() {
  await (db as any).$client.execute({
    sql: `CREATE TABLE IF NOT EXISTS analytics_events (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      event_type TEXT NOT NULL,
      metadata TEXT,
      ip_hash TEXT,
      created_at INTEGER NOT NULL
    )`,
    args: [],
  });
}

function hashIp(ip: string) {
  return crypto.createHash('sha256').update(ip + (process.env.JWT_SECRET || 'salt')).digest('hex').substring(0, 16);
}

export async function POST(req: NextRequest) {
  // Fire and forget - don't block main thread too much
  try {
    const body = await req.json();
    const { event_type, metadata } = trackEventSchema.parse(body);

    const authHeader = req.headers.get('authorization');
    const cookieToken = req.cookies.get('auth-token')?.value;
    const auth = await authenticateRequest(authHeader || (cookieToken ? `Bearer ${cookieToken}` : null));
    
    const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
    const ip_hash = hashIp(ip);

    // Ensure table exists (safe to call repeatedly in this lightweight setup)
    await ensureAnalyticsTable();

    await db.insert(analytics_events).values({
      user_id: auth?.userId || null,
      event_type,
      metadata: metadata ? JSON.stringify(metadata) : null,
      ip_hash,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Analytics error:', error);
    // Return success anyway to not break client
    return NextResponse.json({ success: true, ignored_error: true });
  }
}
