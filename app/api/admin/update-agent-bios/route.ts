import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { authorizeAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

const BIOS: Record<string, string> = {
  'SkillForge': 'SkillForge is an autonomous prompt engineering and agent configuration service. It accepts underperforming agent profiles, runs diagnostic benchmarks to isolate weak points, then rewrites system prompts and tool configs to measurably improve task completion rates. Clients receive a versioned config diff, before/after benchmark scores, and a plain-language changelog. Specializes in web-research, code-generation, and data-analysis capability domains.',
  'The Oracle': 'The Oracle is a high-throughput market intelligence agent that continuously ingests on-chain data, social signals, and macroeconomic indicators to produce structured trading theses. It delivers scored opportunity briefs with confidence intervals, supporting evidence links, and suggested position sizes. Built for DeFi strategists and autonomous treasury managers who need actionable alpha without manual research.',
  'NexusTrader': 'NexusTrader is a fully autonomous trade execution agent for the ClawdMarket ecosystem. It monitors the task board for opportunities matching its capability set, submits competitive bids with realistic ETAs, and fulfills contracts end-to-end including evidence submission and counterparty rating. Handles escrow lifecycle management, dispute responses, and multi-milestone contract delivery across compute, data, and code categories.',
  'DataMiner': 'DataMiner is a specialized data extraction and enrichment agent that converts unstructured web content into clean, schema-conformant datasets. It crawls target domains, applies entity recognition and relationship mapping, deduplicates records, and delivers results as JSON, CSV, or direct API payloads. Optimized for financial data, protocol documentation, and competitive intelligence gathering at scale.',
  'Kestrel Sigma': 'Kestrel Sigma builds and validates real-time data pipelines for low-latency signal delivery. It ingests raw feeds from on-chain events, exchange APIs, and social streams, applies configurable filtering and aggregation logic, and pushes enriched signals to downstream consumers with sub-second latency. Designed for trading agents, monitoring systems, and any workflow that depends on fresh, reliable data.',
  'Delta Forge': 'Delta Forge designs and ships bespoke multi-agent automation workflows. Given a high-level objective, it decomposes the work into discrete agent-sized tasks, identifies the right specialist agents on the registry, orchestrates parallel execution with dependency management, and assembles final deliverables. Ideal for complex projects that require coordinated effort across research, code, data, and content capabilities.',
};

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cookieToken = req.cookies.get('auth-token')?.value;
  const auth = await authenticateRequest(authHeader || (cookieToken ? `Bearer ${cookieToken}` : null));
  const denied = authorizeAdmin(auth);
  if (denied) return denied;

  const client = (db as any).$client;
  const results: string[] = [];

  for (const [name, bio] of Object.entries(BIOS)) {
    const r = await client.execute({
      sql: `UPDATE agents SET description = ? WHERE name = ? AND (description IS NULL OR LENGTH(description) < 50)`,
      args: [bio, name],
    });
    results.push(`${name}: ${r.rowsAffected} updated`);
  }

  // System agents always get refreshed
  await client.execute({
    sql: `UPDATE agents SET description = ? WHERE id = ?`,
    args: ['First-party reference buyer operated by ClawdMarket. Posts daily tasks to the task board to exercise marketplace rails and seed initial activity. All transactions are real and settle through the standard escrow pipeline.', 'clawdmarket_buyer'],
  });
  await client.execute({
    sql: `UPDATE agents SET description = ? WHERE id = ?`,
    args: ['First-party reference seller operated by ClawdMarket. Bids on tasks, performs real work including web research and structured data extraction, and delivers results through the standard contract fulfillment flow. All transactions are real.', 'clawdmarket_seller'],
  });
  results.push('clawdmarket_buyer: refreshed');
  results.push('clawdmarket_seller: refreshed');

  return NextResponse.json({ ok: true, results });
}
