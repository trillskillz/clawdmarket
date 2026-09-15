import { NextRequest, NextResponse } from 'next/server';
import { Mppx as ServerMppx, Transport, tempo } from 'mppx/server';
import { createClient, http } from 'viem';
import { tempo as tempoChain } from 'viem/chains';
import { AGENT_MCP_TOOLS } from '@/lib/agent-contract';
import { PATHUSD_ADDRESS, TEMPO_CHAIN_ID } from '@/lib/constants';
import { durableMppStore } from '@/lib/mpp-store';
import { getMppRecipientAddress, getMppSecretKey, getTempoRpcUrl } from '@/lib/payment-config';
import { reportInternalError } from '@/lib/api-error';
import { mcpPaymentRequiredResponse } from '@/lib/mcp-payment-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SERVER_INFO = {
  name: 'clawdmarket-mcp',
  version: '1.0.0',
};

const CAPABILITIES = {
  tools: {},
};

let _mcpPayment: any = null;
function getMcpPayment() {
  if (_mcpPayment !== null) return _mcpPayment;
  const recipient = getMppRecipientAddress();
  const rpcUrl = getTempoRpcUrl();
  const secretKey = getMppSecretKey();
  if (!recipient || !rpcUrl || !secretKey) {
    _mcpPayment = false;
    return _mcpPayment;
  }
  try {
    _mcpPayment = ServerMppx.create({
      methods: [
        tempo.charge({
          currency: PATHUSD_ADDRESS,
          chainId: TEMPO_CHAIN_ID,
          recipient,
          store: durableMppStore,
          waitForConfirmation: true,
          getClient: () => createClient({ chain: tempoChain, transport: http(rpcUrl) }),
        }),
      ],
      transport: Transport.mcp(),
      realm: process.env.MPP_REALM?.trim() || 'clawdmkt.com',
      secretKey,
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
  if (!payment) return Promise.resolve({ status: 503 });
  return payment.charge({ amount: '0.001' })(body);
}

const TOOLS = AGENT_MCP_TOOLS;

function withCors(res: Response | NextResponse): Response {
  const headers = new Headers(res.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Agent-API-Key, X-ClawdMarket-Agent-Key, X-CSRF-Token');
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
  const agentApiKey = req.headers.get('x-agent-api-key') || req.headers.get('x-clawdmarket-agent-key');

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
    if (agentApiKey) headers.set('X-Agent-API-Key', agentApiKey);

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
      const page = typeof args?.page === 'number' ? args.page : 1;
      const verified = typeof args?.verified === 'boolean' ? args.verified : undefined;

      const result = capability
        ? await callApi('GET', '/api/agents/search', { query: { q: capability, page, limit, verified } })
        : await callApi('GET', '/api/agents/list', { query: { page, limit, verified } });

      if (!result.ok) throw new Error(getErrorMessage(result.data, `list_agents failed (${result.status})`));
      return result.data;
    }

    case 'search_agents': {
      if (!args?.q || typeof args.q !== 'string') {
        throw new Error('q is required');
      }

      const page = typeof args?.page === 'number' ? args.page : 1;
      const limit = typeof args?.limit === 'number' ? args.limit : 20;
      const verified = typeof args?.verified === 'boolean' ? args.verified : undefined;
      const result = await callApi('GET', '/api/agents/search', { query: { q: args.q, page, limit, verified } });
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

      const paymentGate: any = await paidMcpToolCall(body as any);
      if (paymentGate.status === 402) {
        if (paymentGate.challenge) {
          return withCors(mcpPaymentRequiredResponse(paymentGate.challenge));
        }
        return withCors(NextResponse.json(
          { error: 'payment_required', message: 'MPP payment required for tools/call' },
          { status: 402, headers: { 'Cache-Control': 'no-store' } },
        ));
      }
      if (paymentGate.status !== 200 || typeof paymentGate.withReceipt !== 'function') {
        return withCors(NextResponse.json({ error: 'payment_service_unavailable', message: 'MPP payment verification is not configured' }, { status: 503 }));
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
        const errorId = reportInternalError('MCP tool execution failed', error, { tool: name });
        const errorResult = {
          jsonrpc: '2.0' as const,
          id: id ?? null,
          result: {
            content: [{ type: 'text', text: `Error: Tool execution failed (${errorId})` }],
            isError: true,
          },
        };

        return withCors(NextResponse.json(paymentGate.withReceipt(errorResult)));
      }
    }

    return withCors(jsonRpcError(id, -32601, `Method not found: ${method}`));
  } catch (error: any) {
    const errorId = reportInternalError('MCP request failed', error, { method });
    return withCors(jsonRpcError(id, -32000, 'Internal MCP error', { error_id: errorId }));
  }
}

export async function OPTIONS() {
  return withCors(new NextResponse(null, { status: 200 }));
}
