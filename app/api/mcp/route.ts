import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SERVER_INFO = {
  name: 'clawdmarket-mcp',
  version: '1.0.0',
};

const CAPABILITIES = {
  tools: {},
};

const TOOLS = [
  {
    name: 'list_services',
    description:
      'List all available AI agent services on ClawdMarket. Returns service IDs, names, descriptions, pricing, and accepted payment methods (KAS or BNKR).',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Optional category filter' },
        limit: { type: 'number', description: 'Max results to return, default 20' },
      },
    },
  },
  {
    name: 'get_service',
    description:
      'Get full details about a specific ClawdMarket agent service including capabilities, pricing, input schema, and invocation requirements.',
    inputSchema: {
      type: 'object',
      required: ['service_id'],
      properties: {
        service_id: { type: 'string', description: 'The unique service identifier' },
      },
    },
  },
  {
    name: 'invoke_service',
    description:
      'Hire and invoke a ClawdMarket agent service. Triggers the service with a payload and initiates payment via x402 protocol. Returns an invocation ID for status polling.',
    inputSchema: {
      type: 'object',
      required: ['service_id', 'payload', 'payment_currency'],
      properties: {
        service_id: { type: 'string' },
        payload: { type: 'object', description: 'Input data the service requires' },
        payment_currency: { type: 'string', enum: ['KAS', 'BNKR'], description: 'Currency to pay with' },
      },
    },
  },
  {
    name: 'get_invocation_status',
    description:
      'Poll the status of a previously invoked ClawdMarket service. Returns current status, progress, and result if completed.',
    inputSchema: {
      type: 'object',
      required: ['invocation_id'],
      properties: {
        invocation_id: { type: 'string' },
      },
    },
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

async function invokeExternalService(req: NextRequest, serviceId: string, payload: object, paymentCurrency: 'KAS' | 'BNKR') {
  const authHeader = req.headers.get('authorization');
  const cookieHeader = req.headers.get('cookie');
  const csrfHeader = req.headers.get('x-csrf-token');

  const headers = new Headers();
  headers.set('Accept', 'application/json');
  headers.set('Content-Type', 'application/json');
  if (authHeader) headers.set('Authorization', authHeader);
  if (cookieHeader) headers.set('Cookie', cookieHeader);
  if (csrfHeader) headers.set('X-CSRF-Token', csrfHeader);

  const res = await fetch(`https://api.clawdmkt.com/services/${encodeURIComponent(serviceId)}/invoke`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ payload, payment_currency: paymentCurrency }),
    cache: 'no-store',
  });

  let data: any;
  try {
    data = await res.json();
  } catch {
    data = { error: 'Non-JSON response from invoke endpoint' };
  }

  return { ok: res.ok, status: res.status, data };
}

async function executeTool(req: NextRequest, name: string, args: any) {
  const callApi = buildApiCaller(req);

  switch (name) {
    case 'list_services': {
      const category = typeof args?.category === 'string' ? args.category : undefined;
      const limit = typeof args?.limit === 'number' ? args.limit : 20;

      // Equivalent internal route: /api/listings
      const result = await callApi('GET', '/api/listings', {
        query: {
          status: 'active',
          category,
          limit,
        },
      });

      if (!result.ok) throw new Error(getErrorMessage(result.data, `list_services failed (${result.status})`));
      return result.data;
    }

    case 'get_service': {
      if (!args?.service_id || typeof args.service_id !== 'string') {
        throw new Error('service_id is required');
      }

      // Equivalent internal route: /api/listings/:id
      const result = await callApi('GET', `/api/listings/${encodeURIComponent(args.service_id)}`);
      if (!result.ok) throw new Error(getErrorMessage(result.data, `get_service failed (${result.status})`));
      return result.data;
    }

    case 'invoke_service': {
      if (!args?.service_id || typeof args.service_id !== 'string') {
        throw new Error('service_id is required');
      }
      if (!args?.payload || typeof args.payload !== 'object') {
        throw new Error('payload is required and must be an object');
      }
      if (!['KAS', 'BNKR'].includes(args?.payment_currency)) {
        throw new Error('payment_currency must be KAS or BNKR');
      }

      const result = await invokeExternalService(
        req,
        args.service_id,
        args.payload,
        args.payment_currency as 'KAS' | 'BNKR',
      );

      if (!result.ok) throw new Error(getErrorMessage(result.data, `invoke_service failed (${result.status})`));
      return result.data;
    }

    case 'get_invocation_status': {
      if (!args?.invocation_id || typeof args.invocation_id !== 'string') {
        throw new Error('invocation_id is required');
      }

      // Preferred route shape requested: /api/invocations/:id
      const preferred = await callApi('GET', `/api/invocations/${encodeURIComponent(args.invocation_id)}`);
      if (preferred.ok) return preferred.data;

      // Equivalent existing route fallback: /api/trades/:id
      const fallback = await callApi('GET', `/api/trades/${encodeURIComponent(args.invocation_id)}`);
      if (!fallback.ok) {
        throw new Error(getErrorMessage(fallback.data, `get_invocation_status failed (${fallback.status})`));
      }
      return fallback.data;
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

      try {
        const toolResult = await executeTool(req, name, args);
        return withCors(
          jsonRpcResult(id, {
            content: [{ type: 'text', text: JSON.stringify(toolResult) }],
          }),
        );
      } catch (error: any) {
        return withCors(
          jsonRpcResult(id, {
            content: [{ type: 'text', text: `Error: ${error?.message || 'Tool execution failed'}` }],
            isError: true,
          }),
        );
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
