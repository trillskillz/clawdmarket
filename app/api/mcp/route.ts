import { NextRequest, NextResponse } from 'next/server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function withCors(res: Response | NextResponse): Response {
  const headers = new Headers(res.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id, Last-Event-ID, X-CSRF-Token');
  return new Response(res.body, { status: res.status, headers });
}

function buildApiCaller(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cookieHeader = req.headers.get('cookie');
  const csrfHeader = req.headers.get('x-csrf-token');

  return async function callApi<T = unknown>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    opts?: {
      query?: Record<string, string | number | boolean | undefined | null>;
      body?: unknown;
    },
  ): Promise<{ ok: boolean; status: number; data: T }> {
    const url = new URL(path, req.nextUrl.origin);

    if (opts?.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v !== undefined && v !== null && `${v}`.length > 0) {
          url.searchParams.set(k, String(v));
        }
      }
    }

    const headers = new Headers();
    headers.set('Accept', 'application/json');
    if (authHeader) headers.set('Authorization', authHeader);
    if (cookieHeader) headers.set('Cookie', cookieHeader);
    if (csrfHeader) headers.set('X-CSRF-Token', csrfHeader);

    let body: string | undefined;
    if (opts?.body !== undefined) {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(opts.body);
    }

    const res = await fetch(url.toString(), {
      method,
      headers,
      body,
      cache: 'no-store',
    });

    let data: unknown;
    try {
      data = await res.json();
    } catch {
      data = { error: 'Non-JSON response from upstream API' };
    }

    return {
      ok: res.ok,
      status: res.status,
      data: data as T,
    };
  };
}

function createMcpServer(req: NextRequest) {
  const server = new McpServer(
    {
      name: 'clawdmarket-mcp',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  const callApi = buildApiCaller(req);

  server.registerTool(
    'clawdmarket_search_services',
    {
      title: 'Search ClawdMarket services',
      description: 'Search available service listings on ClawdMarket.',
      inputSchema: {
        search: z.string().optional().describe('Free-text search query.'),
        category: z.enum(['compute', 'skills', 'data', 'bounties', 'other']).optional(),
        page: z.number().int().positive().optional().default(1),
        limit: z.number().int().positive().max(100).optional().default(20),
        min_price: z.number().positive().optional(),
        max_price: z.number().positive().optional(),
      },
    },
    async ({ search, category, page = 1, limit = 20, min_price, max_price }) => {
      const result = await callApi('GET', '/api/listings', {
        query: {
          status: 'active',
          search,
          category,
          page,
          limit,
          min_price,
          max_price,
        },
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result.data, null, 2),
          },
        ],
        structuredContent: {
          ok: result.ok,
          status: result.status,
          data: result.data,
        },
      };
    },
  );

  server.registerTool(
    'clawdmarket_get_service',
    {
      title: 'Get a ClawdMarket service listing',
      description: 'Fetch details for a specific listing by id.',
      inputSchema: {
        id: z.string().describe('Listing ID (UUID or fallback id).'),
      },
    },
    async ({ id }) => {
      const result = await callApi('GET', `/api/listings/${encodeURIComponent(id)}`);

      return {
        content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }],
        structuredContent: {
          ok: result.ok,
          status: result.status,
          data: result.data,
        },
      };
    },
  );

  server.registerTool(
    'clawdmarket_create_service',
    {
      title: 'Create a ClawdMarket service listing',
      description: 'Create a new listing. Requires auth that matches existing API rules.',
      inputSchema: {
        category: z.enum(['compute', 'skills', 'data', 'bounties', 'other']),
        title: z.string().min(5).max(100),
        description: z.string().min(20).max(1000),
        price_bankr: z.number().min(1).max(1_000_000_000),
      },
    },
    async (input) => {
      const result = await callApi('POST', '/api/listings', {
        body: input,
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }],
        structuredContent: {
          ok: result.ok,
          status: result.status,
          data: result.data,
        },
      };
    },
  );

  server.registerTool(
    'clawdmarket_hire_service',
    {
      title: 'Hire a ClawdMarket service',
      description: 'Create a trade for a listing. Requires auth that matches existing API rules.',
      inputSchema: {
        listing_id: z.string().describe('Listing ID to purchase.'),
        amount: z.number().positive().default(1),
        allow_partial_fill: z.boolean().optional().default(false),
      },
    },
    async ({ listing_id, amount = 1, allow_partial_fill = false }) => {
      const result = await callApi('POST', '/api/trades', {
        body: {
          listing_id,
          amount,
          allow_partial_fill,
        },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }],
        structuredContent: {
          ok: result.ok,
          status: result.status,
          data: result.data,
        },
      };
    },
  );

  server.registerTool(
    'clawdmarket_get_trade',
    {
      title: 'Get trade details',
      description: 'Fetch details for a specific trade by id. Requires auth.',
      inputSchema: {
        id: z.string().describe('Trade ID.'),
      },
    },
    async ({ id }) => {
      const result = await callApi('GET', `/api/trades/${encodeURIComponent(id)}`);

      return {
        content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }],
        structuredContent: {
          ok: result.ok,
          status: result.status,
          data: result.data,
        },
      };
    },
  );

  server.registerTool(
    'clawdmarket_get_wallet',
    {
      title: 'Get authenticated wallet state',
      description: 'Return wallet balance and recent transactions for the authenticated user.',
      inputSchema: {},
    },
    async () => {
      const result = await callApi('GET', '/api/wallet');

      return {
        content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }],
        structuredContent: {
          ok: result.ok,
          status: result.status,
          data: result.data,
        },
      };
    },
  );

  return server;
}

async function handleMcp(req: NextRequest) {
  // Stateless mode for serverless routing (new transport per request).
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  const server = createMcpServer(req);
  await server.connect(transport);

  if (req.method === 'POST') {
    const body = await req.clone().json().catch(() => null);
    if (!body || !isInitializeRequest(body)) {
      // In stateless mode we still allow non-initialize requests, but this hint helps debugging
      // clients that assume stateful sessions.
    }
  }

  const response = await transport.handleRequest(req);
  await server.close();
  return withCors(response);
}

export async function POST(req: NextRequest) {
  return handleMcp(req);
}

export async function GET(req: NextRequest) {
  return handleMcp(req);
}

export async function DELETE(req: NextRequest) {
  return handleMcp(req);
}

export async function OPTIONS() {
  return withCors(new NextResponse(null, { status: 204 }));
}
