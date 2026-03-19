import { NextRequest, NextResponse } from 'next/server';
import { Mppx as ServerMppx, Transport, tempo } from 'mppx/server';
import { PATHUSD_ADDRESS, TEMPO_CHAIN_ID } from '@/lib/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SERVER_INFO = {
  name: 'clawdmarket-mcp',
  version: '1.0.0',
};

const CAPABILITIES = {
  tools: {},
};

const MPP_RECIPIENT_ADDRESS = process.env.MPP_RECIPIENT_ADDRESS as `0x${string}` | undefined;

const mcpPayment = MPP_RECIPIENT_ADDRESS
  ? ServerMppx.create({
      methods: [
        tempo({
          currency: PATHUSD_ADDRESS,
          chainId: TEMPO_CHAIN_ID,
          recipient: MPP_RECIPIENT_ADDRESS,
        }),
      ],
      transport: Transport.mcp(),
      secretKey: process.env.MPP_SECRET_KEY || process.env.JWT_SECRET || 'clawdmarket-mpp-dev-secret',
    })
  : null;

const paidMcpToolCall = mcpPayment ? mcpPayment.charge({ amount: '0.001' }) : async () => ({ status: 200, withReceipt: (x: any) => x });

const TOOLS = [
  {
    name: 'list_agents',
    description: 'Browse registered agents by capability, price, or name.',
    inputSchema: { type: 'object', properties: { capability: { type: 'string' }, limit: { type: 'number', default: 20 } } },
  },
  {
    name: 'get_agent',
    description: 'Get details for a specific agent by ID.',
    inputSchema: { type: 'object', properties: { agent_id: { type: 'string' } }, required: ['agent_id'] },
  },
  {
    name: 'hire_agent',
    description: 'Create a trade/hire request for an agent.',
    inputSchema: {
      type: 'object',
      properties: { agent_id: { type: 'string' }, task: { type: 'string' }, budget_usd: { type: 'number' } },
      required: ['agent_id', 'task'],
    },
  },
  {
    name: 'get_trade_status',
    description: 'Check status of an existing trade.',
    inputSchema: { type: 'object', properties: { trade_id: { type: 'string' } }, required: ['trade_id'] },
  },
  {
    name: 'get_marketplace_stats',
    description: 'Get marketplace stats: agent count, volume, fees.',
    inputSchema: { type: 'object', properties: {} },
  },
] as const;

function withCors(res: Response | NextResponse): Response {
  const headers = new Headers(res.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return new Response(res.body, { status: res.status, headers });
}

function jsonRpcResult(id: unknown, result: unknown) {
  return NextResponse.json({ jsonrpc: '2.0', id: id ?? null, result });
}

function jsonRpcError(id: unknown, code: number, message: string, data?: unknown) {
  return NextResponse.json(
    {
      jsonrpc: '2.0',
      id: id ?? null,
      error: {
        code,
        message,
        ...(data !== undefined ? { data } : {}),
      },
    },
    { status: 400 },
  );
}

function buildApiCaller(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cookieHeader = req.headers.get('cookie');
  const csrfHeader = req.headers.get('x-csrf-token');

  return async function callApi(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    opts?: {
      query?: Record<string, string | number | boolean | undefined | null>;
      body?: unknown;
    },
  ) {
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
      data,
    };
  };
}

function getErrorMessage(data: any, fallback: string) {
  return data?.error || data?.message || fallback;
}

async function executeTool(req: NextRequest, name: string, args: any) {
  const callApi = buildApiCaller(req);

  switch (name) {
    case 'list_agents': {
      const capability = typeof args?.capability === 'string' ? args.capability : undefined;
      const limit = typeof args?.limit === 'number' ? args.limit : 20;

      const result = await callApi('GET', '/api/listings', {
        query: {
          status: 'active',
          category: capability,
          limit,
          q: capability,
        },
      });

      if (!result.ok) throw new Error(getErrorMessage(result.data, `list_agents failed (${result.status})`));
      return result.data;
    }

    case 'get_agent': {
      if (!args?.agent_id || typeof args.agent_id !== 'string') {
        throw new Error('agent_id is required');
      }

      const result = await callApi('GET', `/api/listings/${encodeURIComponent(args.agent_id)}`);
      if (!result.ok) throw new Error(getErrorMessage(result.data, `get_agent failed (${result.status})`));
      return result.data;
    }

    case 'hire_agent': {
      if (!args?.agent_id || typeof args.agent_id !== 'string') {
        throw new Error('agent_id is required');
      }
      if (!args?.task || typeof args.task !== 'string') {
        throw new Error('task is required');
      }

      const result = await callApi('POST', '/api/trades', {
        body: {
          listing_id: args.agent_id,
          task: args.task,
        },
      });

      if (!result.ok) throw new Error(getErrorMessage(result.data, `hire_agent failed (${result.status})`));
      return result.data;
    }

    case 'get_trade_status': {
      if (!args?.trade_id || typeof args.trade_id !== 'string') {
        throw new Error('trade_id is required');
      }

      const result = await callApi('GET', `/api/trades/${encodeURIComponent(args.trade_id)}`);
      if (!result.ok) throw new Error(getErrorMessage(result.data, `get_trade_status failed (${result.status})`));
      return result.data;
    }

    case 'get_marketplace_stats': {
      const result = await callApi('GET', '/api/stats');
      if (!result.ok) throw new Error(getErrorMessage(result.data, `get_marketplace_stats failed (${result.status})`));
      return result.data;
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export async function GET() {
  return withCors(
    NextResponse.json({
      server: SERVER_INFO,
      capabilities: CAPABILITIES,
      transport: {
        kind: 'http',
        methods: ['GET', 'POST'],
      },
    }),
  );
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
    return withCors(jsonRpcError(null, -32600, 'Invalid Request'));
  }

  const { id, method, params } = body;

  try {
    if (method === 'initialize') {
      return withCors(
        jsonRpcResult(id, {
          protocolVersion: '2024-11-05',
          serverInfo: SERVER_INFO,
          capabilities: CAPABILITIES,
        }),
      );
    }

    if (method === 'tools/list') {
      return withCors(jsonRpcResult(id, { tools: TOOLS }));
    }

    if (method === 'tools/call') {
      const name = params?.name;
      const args = params?.arguments ?? {};
      if (!name || typeof name !== 'string') {
        return withCors(
          jsonRpcResult(id, {
            content: [{ type: 'text', text: 'Error: tool name is required' }],
            isError: true,
          }),
        );
      }

      const paymentGate = await paidMcpToolCall(body as any);
      if (paymentGate.status === 402) {
        return withCors(NextResponse.json(paymentGate.challenge));
      }

      try {
        const toolResult = await executeTool(req, name, args);
        const baseResult = {
          jsonrpc: '2.0' as const,
          id: id ?? null,
          result: {
            content: [{ type: 'text', text: JSON.stringify(toolResult) }],
          },
        };

        return withCors(NextResponse.json(paymentGate.withReceipt(baseResult)));
      } catch (error: any) {
        const errorResult = {
          jsonrpc: '2.0' as const,
          id: id ?? null,
          result: {
            content: [{ type: 'text', text: `Error: ${error?.message || 'Tool execution failed'}` }],
            isError: true,
          },
        };

        return withCors(NextResponse.json(paymentGate.withReceipt(errorResult)));
      }
    }

    return withCors(jsonRpcError(id, -32601, `Method not found: ${method}`));
  } catch (error: any) {
    return withCors(jsonRpcError(id, -32000, error?.message || 'Internal MCP error'));
  }
}

export async function OPTIONS() {
  return withCors(new NextResponse(null, { status: 200 }));
}
