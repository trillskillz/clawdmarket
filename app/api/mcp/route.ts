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
import { resolveRegisteredAgentBearer } from '@/lib/registered-agent-auth';
import { hasAgentCredentialScope } from '@/lib/agent-credential-scopes';
import { routePlanInput } from '@/lib/route-planning';
import { previewRoute } from '@/lib/route-preview';
import { inspectOwnedRoute } from '@/lib/route-inspection';
import { routePlanningEnabled } from '@/lib/routing-feature-flags';
import { rateLimit } from '@/lib/rate-limit';
import { ArtifactError, readBoundedJson } from '@/lib/private-artifacts';
import { MCP_TASK_PROTOCOL, MCP_TASK_CAPABILITIES, MCP_TASK_TOOLS, callMcpRouteTool, handleMcpTaskMethod, resumeMcpResult, mcpTaskError } from '@/lib/mcp-route-tasks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;
const PROTOCOLS = new Set(['2024-11-05', '2025-03-26', '2025-06-18', MCP_TASK_PROTOCOL]);

const SERVER_INFO = {
  name: 'clawdmarket-mcp',
  version: '1.1.0',
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
const FREE_ROUTING_TOOLS = new Set(['plan_work', 'get_route']);

class McpToolError extends Error {
  constructor(public readonly code: string) { super(code); }
}

async function readAgentForRouting(req: NextRequest, tool: 'plan_work' | 'get_route') {
  const auth = await resolveRegisteredAgentBearer(req.headers.get('authorization'));
  if (auth.kind !== 'agent' || !hasAgentCredentialScope(auth.scopes, 'agent:read')) throw new McpToolError('AGENT_READ_AUTH_REQUIRED');
  const quota = await rateLimit(`mcp-routing:${tool}:${auth.agentId}`, { interval: 60_000, maxRequests: tool === 'plan_work' ? 10 : 60, failClosed: true });
  if (!quota.success) throw new McpToolError('MCP_ROUTING_RATE_LIMIT');
  return auth;
}

function withCors(res: Response | NextResponse): Response {
  const headers = new Headers(res.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Agent-API-Key, X-ClawdMarket-Agent-Key, X-CSRF-Token, MCP-Protocol-Version, Last-Event-ID');
  headers.set('Cache-Control', 'private, no-store');
  return new Response(res.body, { status: res.status, headers });
}

function originAllowed(req?: NextRequest) {
  const origin = req?.headers.get('origin');
  if (!origin) return true;
  const allowed = new Set(['https://clawdmkt.com', 'https://www.clawdmkt.com']);
  for (const configured of (process.env.CLAWDMARKET_MCP_ALLOWED_ORIGINS || '').split(',')) {
    try { const url = new URL(configured.trim()); if (url.protocol === 'https:') allowed.add(url.origin); } catch { /* invalid configuration grants no origin */ }
  }
  if (req && ['localhost', '127.0.0.1', '[::1]'].includes(req.nextUrl.hostname)) allowed.add(req.nextUrl.origin);
  return allowed.has(origin);
}

function taskFailure(id: unknown, error: unknown): Response | null {
  const problem = mcpTaskError(error);
  if (!problem) return null;
  const response = jsonRpcError(id, problem.rpcCode, problem.code, problem.data);
  const headers = new Headers(response.headers);
  if (problem.status === 401) headers.set('WWW-Authenticate', 'Bearer realm="ClawdMarket MCP"');
  if (problem.status === 429) headers.set('Retry-After', '60');
  return withCors(new Response(response.body, { status: problem.status, headers }));
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
    case 'plan_work': {
      const auth = await readAgentForRouting(req, 'plan_work');
      if (!routePlanningEnabled()) throw new McpToolError('ROUTE_PLANNING_DISABLED');
      const parsed = routePlanInput.safeParse(args);
      if (!parsed.success) throw new McpToolError('INVALID_ROUTE_REQUEST');
      return previewRoute(parsed.data, auth.syntheticUserId);
    }

    case 'get_route': {
      const auth = await readAgentForRouting(req, 'get_route');
      if (!args || typeof args.route_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(args.route_id)) throw new McpToolError('INVALID_ROUTE_ID');
      const snapshot = await inspectOwnedRoute(args.route_id, auth.syntheticUserId);
      if (!snapshot) throw new McpToolError('ROUTE_NOT_FOUND');
      return snapshot;
    }

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

export async function GET(req: NextRequest) {
  if (!originAllowed(req)) return new Response('Forbidden origin', { status: 403 });
  const protocol = req?.headers.get('mcp-protocol-version');
  if (protocol && !PROTOCOLS.has(protocol)) return withCors(jsonRpcError(null, -32600, 'Unsupported MCP protocol version'));
  if (req?.headers.get('accept')?.includes('text/event-stream')) {
    if (!req.headers.get('last-event-id')) return withCors(new Response(null, { status: 405, headers: { Allow: 'POST, OPTIONS' } }));
    if (protocol !== MCP_TASK_PROTOCOL) return withCors(jsonRpcError(null, -32600, 'MCP Tasks require protocol 2025-11-25'));
    try { return withCors(await resumeMcpResult(req)); } catch (error) {
      const response = taskFailure(null, error);
      if (response) return response;
      const errorId = reportInternalError('MCP result resumption failed', error);
      return withCors(jsonRpcError(null, -32000, 'Internal MCP error', { error_id: errorId }));
    }
  }
  return withCors(
    NextResponse.json({
      server: SERVER_INFO,
      capabilities: MCP_TASK_CAPABILITIES,
      transport: {
        kind: 'streamable-http',
        methods: ['GET', 'POST'],
        protocolVersion: MCP_TASK_PROTOCOL,
        stateless: true,
        resumableTaskResults: true,
      },
    }),
  );
}

export async function POST(req: NextRequest) {
  if (!originAllowed(req)) return new Response('Forbidden origin', { status: 403 });
  const protocol = req.headers.get('mcp-protocol-version') || '2025-03-26';
  if (!PROTOCOLS.has(protocol)) return withCors(jsonRpcError(null, -32600, 'Unsupported MCP protocol version'));
  if (req.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json')
    return withCors(new Response('Content-Type must be application/json', { status: 415 }));
  if (protocol === MCP_TASK_PROTOCOL && (!req.headers.get('accept')?.includes('application/json') || !req.headers.get('accept')?.includes('text/event-stream')))
    return withCors(new Response('Accept must include application/json and text/event-stream', { status: 406 }));
  let body;
  try { body = await readBoundedJson(req, 16_384); } catch (error) {
    if (error instanceof ArtifactError) return withCors(new Response(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: error.status === 413 ? -32600 : -32700, message: error.code } }), { status: error.status, headers: { 'Content-Type': 'application/json' } }));
    throw error;
  }
  if (!body || body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
    return withCors(jsonRpcError(null, -32600, 'Invalid Request'));
  }

  const { id, method, params } = body;
  if (params != null && (typeof params !== 'object' || Array.isArray(params))) return withCors(jsonRpcError(id, -32602, 'Invalid parameters'));
  if (!('id' in body)) {
    if (['notifications/initialized', 'notifications/cancelled'].includes(method)) return withCors(new Response(null, { status: 202 }));
    return withCors(jsonRpcError(null, -32600, 'Invalid notification'));
  }
  if (!(id === null || typeof id === 'string' || typeof id === 'number' && Number.isSafeInteger(id))) return withCors(jsonRpcError(null, -32600, 'Invalid request ID'));

  try {
    if (method === 'initialize') {
      const negotiated = PROTOCOLS.has(params?.protocolVersion) ? params.protocolVersion : MCP_TASK_PROTOCOL;
      return withCors(
        jsonRpcResult(id, {
          protocolVersion: negotiated,
          serverInfo: SERVER_INFO,
          capabilities: negotiated === MCP_TASK_PROTOCOL ? MCP_TASK_CAPABILITIES : CAPABILITIES,
        }),
      );
    }

    if (method === 'tools/list') {
      return withCors(jsonRpcResult(id, { tools: protocol === MCP_TASK_PROTOCOL ? TOOLS : TOOLS.filter(tool => !MCP_TASK_TOOLS.has(tool.name)) }));
    }

    if (method === 'ping') return withCors(jsonRpcResult(id, {}));
    if (method.startsWith('tasks/')) {
      if (protocol !== MCP_TASK_PROTOCOL) return withCors(jsonRpcError(id, -32601, 'MCP Tasks require protocol 2025-11-25'));
      const result = await handleMcpTaskMethod(req, method, params, id);
      return withCors(result instanceof Response ? result : jsonRpcResult(id, result));
    }

    if (method === 'tools/call') {
      const name = params?.name;
      const args = params?.arguments ?? {};
      if (typeof name === 'string' && MCP_TASK_TOOLS.has(name)) {
        if (protocol !== MCP_TASK_PROTOCOL) return withCors(jsonRpcError(id, -32601, 'MCP Tasks require protocol 2025-11-25'));
        return withCors(jsonRpcResult(id, await callMcpRouteTool(req, name, args, params?.task)));
      }
      if (protocol === MCP_TASK_PROTOCOL && params?.task !== undefined) return withCors(jsonRpcError(id, -32601, 'This tool forbids task augmentation'));
      if (!name || typeof name !== 'string') {
        return withCors(
          jsonRpcResult(id, {
            content: [{ type: 'text', text: 'Error: tool name is required' }],
            isError: true,
          }),
        );
      }

      const paymentGate: any = FREE_ROUTING_TOOLS.has(name)
        ? { status: 200, withReceipt: (payload: unknown) => payload }
        : await paidMcpToolCall(body as any);
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
        const errorId = error instanceof McpToolError ? error.code : reportInternalError('MCP tool execution failed', error, { tool: name });
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
    const taskError = taskFailure(id, error);
    if (taskError) return taskError;
    const errorId = reportInternalError('MCP request failed', error, { method });
    return withCors(jsonRpcError(id, -32000, 'Internal MCP error', { error_id: errorId }));
  }
}

export async function OPTIONS(req: NextRequest) {
  if (!originAllowed(req)) return new Response('Forbidden origin', { status: 403 });
  return withCors(new NextResponse(null, { status: 200 }));
}
