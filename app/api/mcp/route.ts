import { NextRequest, NextResponse } from 'next/server';
import { Mppx as ServerMppx, Transport, tempo } from 'mppx/server';
import { AGENT_MCP_TOOLS } from '@/lib/agent-contract';
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

let _mcpPayment: any = null;
function getMcpPayment() {
  if (_mcpPayment !== null) return _mcpPayment;
  if (!MPP_RECIPIENT_ADDRESS) {
    _mcpPayment = false;
    return _mcpPayment;
  }
  try {
    _mcpPayment = ServerMppx.create({
      methods: [
        tempo({
          currency: PATHUSD_ADDRESS,
          chainId: TEMPO_CHAIN_ID,
          recipient: MPP_RECIPIENT_ADDRESS,
        }),
      ],
      transport: Transport.mcp(),
      secretKey: process.env.MPP_SECRET_KEY || process.env.JWT_SECRET || 'clawdmarket-mpp-dev-secret',
    });
  } catch {
    _mcpPayment = false;
  }
  return _mcpPayment;
}

function paidMcpToolCall(body: any) {
  if (process.env.CLAWDMARKET_MCP_TEST_PAYMENT === 'true') {
    return Promise.resolve({
      status: 200,
      headers: {},
      withReceipt: (payload: any) => ({
        ...payload,
        mpp_receipt: {
          id: 'test_mpp_receipt',
          amount: '0.001',
          payer: 'test-agent',
          body_hash: typeof body?.id === 'undefined' ? null : String(body.id),
        },
      }),
    });
  }

  const payment = getMcpPayment();
  if (!payment) return Promise.resolve({ status: 402, headers: {}, withReceipt: (x: any) => x });
  return payment.charge({ amount: '0.001' })(body);
}

const TOOLS = AGENT_MCP_TOOLS;

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

      const result = capability
        ? await callApi('GET', '/api/agents/search', { query: { q: capability } })
        : await callApi('GET', '/api/agents/list', { query: { limit } });

      if (!result.ok) throw new Error(getErrorMessage(result.data, `list_agents failed (${result.status})`));
      return result.data;
    }

    case 'search_agents': {
      if (!args?.q || typeof args.q !== 'string') {
        throw new Error('q is required');
      }

      const result = await callApi('GET', '/api/agents/search', { query: { q: args.q } });
      if (!result.ok) throw new Error(getErrorMessage(result.data, `search_agents failed (${result.status})`));
      return result.data;
    }

    case 'get_agent': {
      if (!args?.agent_id || typeof args.agent_id !== 'string') {
        throw new Error('agent_id is required');
      }

      const result = await callApi('GET', `/api/agents/${encodeURIComponent(args.agent_id)}`);
      if (!result.ok) throw new Error(getErrorMessage(result.data, `get_agent failed (${result.status})`));
      return result.data;
    }

    case 'browse_tasks': {
      const status = typeof args?.status === 'string' ? args.status : 'open';
      const result = await callApi('GET', '/api/tasks', { query: { status } });
      if (!result.ok) throw new Error(getErrorMessage(result.data, `browse_tasks failed (${result.status})`));
      return result.data;
    }

    case 'bid_task': {
      if (!args?.task_id || typeof args.task_id !== 'string') throw new Error('task_id is required');
      if (typeof args?.price_usd !== 'number') throw new Error('price_usd is required');

      const result = await callApi('POST', `/api/tasks/${encodeURIComponent(args.task_id)}/bid`, {
        body: {
          price_usd: args.price_usd,
          message: typeof args?.message === 'string' ? args.message : undefined,
          eta_seconds: typeof args?.eta_seconds === 'number' ? args.eta_seconds : undefined,
        },
      });
      if (!result.ok) throw new Error(getErrorMessage(result.data, `bid_task failed (${result.status})`));
      return result.data;
    }

    case 'hire_agent': {
      const sellerAgentId = typeof args?.seller_agent_id === 'string' ? args.seller_agent_id : undefined;
      const listingId = typeof args?.listing_id === 'string' ? args.listing_id : undefined;
      const description = typeof args?.description === 'string' ? args.description : 'MCP hire request';

      const resolvedListingId = listingId || (sellerAgentId ? `listing_${sellerAgentId}` : undefined);
      if (!resolvedListingId) throw new Error('listing_id or seller_agent_id is required');

      const result = await callApi('POST', '/api/trades', {
        body: {
          listing_id: resolvedListingId,
          amount: typeof args?.amount === 'number' ? args.amount : 1,
          description,
        },
      });

      if (!result.ok) throw new Error(getErrorMessage(result.data, `hire_agent failed (${result.status})`));
      return result.data;
    }

    case 'get_capabilities': {
      const result = await callApi('GET', '/api/capabilities');
      if (!result.ok) throw new Error(getErrorMessage(result.data, `get_capabilities failed (${result.status})`));
      return result.data;
    }

    case 'resolve_capabilities': {
      if (!args?.q || typeof args.q !== 'string') throw new Error('q is required');
      const result = await callApi('GET', '/api/capabilities/resolve', { query: { q: args.q } });
      if (!result.ok) throw new Error(getErrorMessage(result.data, `resolve_capabilities failed (${result.status})`));
      return result.data;
    }

    case 'get_leaderboard': {
      const metric = typeof args?.metric === 'string' ? args.metric : undefined;
      const limit = typeof args?.limit === 'number' ? args.limit : undefined;
      const result = await callApi('GET', '/api/leaderboard', { query: { metric, limit } });
      if (!result.ok) throw new Error(getErrorMessage(result.data, `get_leaderboard failed (${result.status})`));
      return result.data;
    }

    case 'register_agent': {
      const result = await callApi('POST', '/api/agents/register', { body: args || {} });
      if (!result.ok) throw new Error(getErrorMessage(result.data, `register_agent failed (${result.status})`));
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

      const auth = req.headers.get('authorization') || '';
      if (!auth.toLowerCase().startsWith('payment ')) {
        return withCors(NextResponse.json({ error: 'payment_required', message: 'MPP payment required for tools/call' }, { status: 402 }));
      }

      const paymentGate: any = await paidMcpToolCall(body as any);
      if (paymentGate.status === 402) {
        if (paymentGate.challenge) {
          return withCors(NextResponse.json(paymentGate.challenge, { status: 402 }));
        }
        return withCors(NextResponse.json({ error: 'payment_required', message: 'MPP payment required for tools/call' }, { status: 402 }));
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
