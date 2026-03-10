#!/usr/bin/env node
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ClawdClient } from './api.js';

const baseUrl = process.env.MCP_CLAWDMKT_BASE_URL || 'https://clawdmkt.com';
const apiKey = process.env.MCP_CLAWDMKT_API_KEY;

const client = new ClawdClient({ baseUrl, apiKey });

const server = new McpServer({
  name: 'clawdmarket-mcp',
  version: '1.0.0',
});

server.tool(
  'search_agents',
  {
    query: z.string().default(''),
    filters: z.object({
      min_cdc: z.number().optional(),
      max_cdc: z.number().optional(),
      capability: z.string().optional(),
    }).optional(),
  },
  async ({ query, filters }) => {
    const data = await client.searchAgents();
    const q = query.toLowerCase();

    const agents = (data.agents || []).filter((a: any) => {
      const text = `${a.name || ''} ${a.description || ''} ${(a.capabilities || []).join(' ')}`.toLowerCase();
      if (q && !text.includes(q)) return false;
      if (filters?.capability && !(a.capabilities || []).some((c: string) => c.toLowerCase().includes(filters.capability!.toLowerCase()))) return false;
      if (filters?.min_cdc != null && Number(a?.pricing?.min_cdc || 0) < filters.min_cdc) return false;
      if (filters?.max_cdc != null && Number(a?.pricing?.max_cdc || 0) > filters.max_cdc) return false;
      return true;
    });

    return {
      content: [{ type: 'text', text: JSON.stringify({ count: agents.length, agents }, null, 2) }],
      structuredContent: { count: agents.length, agents },
    };
  }
);

server.tool(
  'get_agent',
  { id: z.string() },
  async ({ id }) => {
    const agent = await client.getAgent(id);
    return {
      content: [{ type: 'text', text: JSON.stringify(agent, null, 2) }],
      structuredContent: agent,
    };
  }
);

server.tool(
  'hire_agent',
  {
    agent_id: z.string(),
    task_description: z.string(),
    budget: z.number().positive(),
  },
  async ({ agent_id, task_description, budget }) => {
    const profile = await client.getAgent(agent_id);
    const listings = (profile?.listings || []).map((l: any) => ({ ...l, price_cdc: Number(l.price_cdc ?? l.price_bankr ?? 0) }));

    if (!listings.length) {
      throw new Error('Agent has no active listings to hire.');
    }

    const affordable = listings
      .filter((l: any) => l.price_cdc <= budget)
      .sort((a: any, b: any) => a.price_cdc - b.price_cdc);

    if (!affordable.length) {
      throw new Error(`No listing available within budget (${budget} CDC).`);
    }

    const chosen = affordable[0];
    const trade = await client.createTrade(chosen.id);

    return {
      content: [{ type: 'text', text: JSON.stringify({ task_description, chosen_listing: chosen, trade }, null, 2) }],
      structuredContent: { task_description, chosen_listing: chosen, trade },
    };
  }
);

server.tool(
  'list_transactions',
  { status: z.enum(['pending', 'completed', 'complete', 'disputed']).optional() },
  async ({ status }) => {
    const data = await client.listTransactions(status);
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      structuredContent: data,
    };
  }
);

server.tool(
  'register_as_agent',
  {
    name: z.string().min(2),
    capabilities: z.array(z.string()).min(1),
    pricing: z.union([z.string(), z.record(z.any())]),
  },
  async ({ name, capabilities, pricing }) => {
    const data = await client.registerAsAgent({ name, capabilities, pricing });
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      structuredContent: data,
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('MCP server failed to start:', err);
  process.exit(1);
});
