#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import express from 'express';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { ClawdClient } from './api.js';

const baseUrl = process.env.MCP_CLAWDMKT_BASE_URL || 'https://clawdmkt.com';
const apiKey = process.env.MCP_CLAWDMKT_API_KEY;
const transportMode = (process.env.MCP_TRANSPORT || 'stdio').toLowerCase();
const port = Number(process.env.MCP_PORT || 3334);

const client = new ClawdClient({ baseUrl, apiKey });

function buildServer() {
  const server = new McpServer({
    name: 'clawdmarket-mcp',
    version: '1.1.0',
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

  server.tool('get_agent', { id: z.string() }, async ({ id }) => {
    const agent = await client.getAgent(id);
    return {
      content: [{ type: 'text', text: JSON.stringify(agent, null, 2) }],
      structuredContent: agent,
    };
  });

  server.tool(
    'hire_agent',
    {
      agent_id: z.string(),
      task_description: z.string(),
      budget: z.number().positive(),
    },
    async ({ agent_id, task_description, budget }) => {
      const job = await client.createJob({ agent_id, task_description, budget });
      return {
        content: [{ type: 'text', text: JSON.stringify(job, null, 2) }],
        structuredContent: job,
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

  return server;
}

async function startStdio() {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function startHttp() {
  const app = express();
  app.use(express.json());

  const transports: Record<string, StreamableHTTPServerTransport> = {};

  app.post('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    try {
      let transport: StreamableHTTPServerTransport;

      if (sessionId && transports[sessionId]) {
        transport = transports[sessionId];
      } else if (!sessionId && isInitializeRequest(req.body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            transports[sid] = transport;
          },
        });

        transport.onclose = () => {
          if (transport.sessionId) delete transports[transport.sessionId];
        };

        const server = buildServer();
        await server.connect(transport);
      } else {
        res.status(400).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Bad Request: No valid session ID provided' }, id: null });
        return;
      }

      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('MCP POST error:', err);
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
      }
    }
  });

  app.get('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send('Invalid or missing session ID');
      return;
    }
    await transports[sessionId].handleRequest(req, res);
  });

  app.delete('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send('Invalid or missing session ID');
      return;
    }
    await transports[sessionId].handleRequest(req, res);
  });

  app.listen(port, () => {
    console.log(`ClawdMarket MCP HTTP server listening on :${port}/mcp`);
  });
}

async function main() {
  if (transportMode === 'http') {
    await startHttp();
    return;
  }
  await startStdio();
}

main().catch((err) => {
  console.error('MCP server failed to start:', err);
  process.exit(1);
});
