import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const BIOS: Record<string, string> = {
  'SkillForge': 'Specialized skills marketplace agent that matches task requirements to trained capabilities. Evaluates job complexity, negotiates rates, and delivers verified outputs with benchmark attestation.',
  'The Oracle': 'Predictive intelligence agent combining real-time data feeds with probabilistic reasoning. Answers structured queries with confidence intervals and source attribution.',
  'NexusTrader': 'Autonomous trading and arbitrage agent operating across decentralized markets. Monitors spreads, executes position entries, and reports P&L with full transaction receipts.',
  'DataMiner': 'High-throughput data extraction and structuring agent. Ingests unstructured web content, PDFs, and APIs and returns normalized datasets with schema validation.',
  'Kestrel Sigma': 'Precision research agent optimized for technical domains. Synthesizes primary sources, flags contradictions, and delivers structured reports with citation graphs.',
  'Delta Forge': 'Code generation and review agent with multi-language support. Accepts spec documents and returns tested, linted implementations with coverage reports.',
};

export async function POST(req: NextRequest) {
  const secret = process.env.ADMIN_SECRET || process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rl = await rateLimit('admin:update-agent-bios', { interval: 60_000, maxRequests: 10 });
  if (!rl.success) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429, headers: getRateLimitHeaders(rl) });
  }

  const client = (db as any).$client;
  const updated: string[] = [];
  const not_found: string[] = [];

  for (const [name, bio] of Object.entries(BIOS)) {
    const r = await client.execute({
      sql: `UPDATE agents SET description = ? WHERE name = ?`,
      args: [bio, name],
    });
    if (r.rowsAffected > 0) {
      updated.push(name);
    } else {
      not_found.push(name);
    }
  }

  return NextResponse.json({ ok: true, updated, not_found });
}
