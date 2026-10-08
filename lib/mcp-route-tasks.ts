import 'server-only';
import { NextRequest } from 'next/server';
import { and, desc, eq, isNull, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { CallToolResult, Task } from '@modelcontextprotocol/sdk/types.js';
import { TaskCreationParamsSchema } from '@modelcontextprotocol/sdk/types.js';
import { db } from './db';
import { mcp_route_tasks, mcp_result_streams } from './schema';
import { resolveRegisteredAgentBearer } from './registered-agent-auth';
import { hasAgentCredentialScope } from './agent-credential-scopes';
import { rateLimit } from './rate-limit';
import { A2ARouteError, a2aRouteTaskView, sendRouteTaskWork, cancelRouteTask, requireA2AWriter } from './a2a-route-tasks';

export const MCP_TASK_PROTOCOL = '2025-11-25';
export const MCP_TASK_TOOLS = new Set(['route_work', 'get_route_task', 'continue_route']);
export const MCP_TASK_CAPABILITIES = { tools: {}, tasks: { list: {}, cancel: {}, requests: { tools: { call: {} } } } };
const terminal = new Set(['completed', 'failed', 'cancelled']);
const taskIdSchema = z.uuid();
const reference = z.string().min(8).max(90).regex(/^[a-zA-Z0-9._:-]+$/);
const startSchema = z.union([
  z.object({ client_reference: reference, request: z.record(z.string(), z.unknown()) }).strict(),
  z.object({ client_reference: reference, route_id: z.uuid(), mandate_id: z.uuid() }).strict(),
]);
const continueSchema = z.object({ task_id: z.uuid(), client_reference: reference, mandate_id: z.uuid() }).strict();
const taskParams = z.object({ taskId: taskIdSchema, _meta: z.record(z.string(), z.unknown()).optional() }).strict();
type Row = typeof mcp_route_tasks.$inferSelect;
type Auth = Extract<Awaited<ReturnType<typeof resolveRegisteredAgentBearer>>, { kind: 'agent' }>;
type RpcId = string | number | null;
export class McpTaskError extends Error {
  constructor(public code: string, public status = 400, public rpcCode = -32602, public data?: Record<string, unknown>) { super(code); }
}
export function mcpTaskError(error: unknown): McpTaskError | null {
  if (error instanceof McpTaskError) return error;
  if (error instanceof A2ARouteError) return new McpTaskError(error.reason.replace(/^A2A_/, 'MCP_'), error.status, -32000,
    { ...(error.taskId ? { taskId: error.taskId } : {}), funds_state: error.fundsState, retryable: error.status >= 500 });
  return null;
}
const related = (id: string) => ({ 'io.modelcontextprotocol/related-task': { taskId: id } });
export async function authenticateMcpTask(req: NextRequest, write = false, quota = true) {
  const auth = await resolveRegisteredAgentBearer(req.headers.get('authorization'));
  if (auth.kind !== 'agent' || !hasAgentCredentialScope(auth.scopes, 'agent:read'))
    throw new McpTaskError('MCP_AGENT_READ_AUTH_REQUIRED', auth.kind === 'agent' || auth.kind === 'forbidden' ? 403 : 401, -32000);
  if (write) requireA2AWriter(auth);
  if (quota && !(await rateLimit(`mcp-tasks:${write ? 'write' : 'read'}:${auth.agentId}`, {
    interval: 60_000, maxRequests: write ? 10 : 60, failClosed: true,
  })).success) throw new McpTaskError('MCP_TASK_RATE_LIMIT', 429, -32000);
  return auth;
}
async function ownedRow(agentId: string, id: string): Promise<Row> {
  const [row] = await db.select().from(mcp_route_tasks).where(and(eq(mcp_route_tasks.id, id), eq(mcp_route_tasks.agent_id, agentId))).limit(1);
  if (!row) throw new McpTaskError('MCP_TASK_NOT_FOUND', 404, -32602);
  return row;
}
async function snapshot(agentId: string, id: string, includeArtifacts = false) {
  let row = await ownedRow(agentId, id);
  const view = await a2aRouteTaskView(row, 0, true, includeArtifacts);
  const data = view.artifacts![0].parts[0].data;
  const observed = ({ TASK_STATE_COMPLETED: 'completed', TASK_STATE_CANCELED: 'cancelled', TASK_STATE_FAILED: 'failed', TASK_STATE_INPUT_REQUIRED: 'input_required' } as Record<string, Task['status']>)[view.status.state] || 'working';
  if (!row.terminal_status && terminal.has(observed)) {
    await db.update(mcp_route_tasks).set({ terminal_status: observed as Row['terminal_status'], updated_at: Math.floor(Date.now() / 1000) })
      .where(and(eq(mcp_route_tasks.id, id), isNull(mcp_route_tasks.terminal_status)));
    row = await ownedRow(agentId, id);
  }
  const status = row.terminal_status || observed;
  const task: Task = { taskId: id, status, createdAt: new Date(row.created_at * 1000).toISOString(),
    lastUpdatedAt: row.terminal_status ? new Date(row.updated_at * 1000).toISOString() : view.status.timestamp,
    ttl: null, pollInterval: 2000,
    statusMessage: JSON.stringify({ route_id: row.route_id, next_action: row.terminal_status ? 'none' : data.next_action,
      funds_state: data.funds_state, error_code: row.last_error_code }),
  };
  // The terminal protocol status cannot reopen. Private output still requires CURRENT backing.
  if (status === 'completed' && observed !== 'completed') task.statusMessage = 'Financial backing cannot currently be verified; retry private route inspection.';
  return { task, data: includeArtifacts ? data : { ...data, result: null }, observed, row };
}
export async function getMcpTask(agentId: string, id: string) { return (await snapshot(agentId, id)).task; }
function toolResult(id: string, data: Record<string, unknown>, isError = false): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data, isError, _meta: related(id) };
}
export async function callMcpRouteTool(req: NextRequest, name: string, args: unknown, task: unknown) {
  const auth = await authenticateMcpTask(req, name !== 'get_route_task');
  if (name === 'route_work') {
    if (task === undefined) throw new McpTaskError('MCP_TASK_AUGMENTATION_REQUIRED', 400, -32601);
    if (!TaskCreationParamsSchema.safeParse(task).success)
      throw new McpTaskError('INVALID_MCP_TASK_AUGMENTATION');
    const parsed = startSchema.safeParse(args);
    if (!parsed.success) throw new McpTaskError('INVALID_MCP_ROUTE_REQUEST');
    const input = parsed.data;
    const data = 'request' in input ? { action: 'route_work', request: input.request } : { action: 'route_work', route_id: input.route_id, mandate_id: input.mandate_id };
    const view = await sendRouteTaskWork(req, auth, { role: 'ROLE_USER', messageId: `mcp:start:${input.client_reference}`,
      parts: [{ data, mediaType: 'application/json' }], metadata: { transport: 'mcp' } }, 'mcp');
    return { task: await getMcpTask(auth.agentId, view.id), _meta: related(view.id) };
  }
  if (task !== undefined) throw new McpTaskError('MCP_TOOL_TASKS_FORBIDDEN', 400, -32601);
  if (name === 'get_route_task') {
    const parsed = z.object({ task_id: taskIdSchema }).strict().safeParse(args);
    if (!parsed.success) throw new McpTaskError('INVALID_MCP_TASK_ID');
    const current = await snapshot(auth.agentId, parsed.data.task_id);
    return toolResult(current.task.taskId, { task: current.task, ...current.data });
  }
  const parsed = continueSchema.safeParse(args);
  if (!parsed.success) throw new McpTaskError('INVALID_MCP_TASK_CONTINUATION');
  const { task_id, mandate_id, client_reference } = parsed.data;
  const row = await ownedRow(auth.agentId, task_id);
  if (!row.route_id) throw new McpTaskError('MCP_REPLAY_ORIGINAL_REQUEST_REQUIRED', 409, -32602, { taskId: task_id });
  // The shared engine preserves exact continuation replay, pinned mandate and terminal guards.
  await sendRouteTaskWork(req, auth, { role: 'ROLE_USER', messageId: `mcp:continue:${client_reference}`, taskId: task_id, contextId: row.context_id,
    parts: [{ data: { action: 'route_work', route_id: row.route_id, mandate_id }, mediaType: 'application/json' }], metadata: { transport: 'mcp' } }, 'mcp');
  const current = await snapshot(auth.agentId, task_id);
  return toolResult(task_id, { task: current.task, ...current.data });
}
export async function handleMcpTaskMethod(req: NextRequest, method: string, params: unknown, id: RpcId): Promise<unknown | Response> {
  const auth = await authenticateMcpTask(req, method === 'tasks/cancel');
  if (method === 'tasks/list') {
    const parsed = z.object({ cursor: z.string().max(256).optional(), _meta: z.record(z.string(), z.unknown()).optional() }).strict().safeParse(params || {});
    if (!parsed.success) throw new McpTaskError('INVALID_MCP_TASK_CURSOR');
    let before: { time: number; id: string } | undefined;
    if (parsed.data.cursor) {
      try { before = JSON.parse(Buffer.from(parsed.data.cursor, 'base64url').toString('utf8')); } catch { throw new McpTaskError('INVALID_MCP_TASK_CURSOR'); }
      if (!before || !Number.isSafeInteger(before.time) || !taskIdSchema.safeParse(before.id).success) throw new McpTaskError('INVALID_MCP_TASK_CURSOR');
    }
    const rows = await db.select().from(mcp_route_tasks).where(and(eq(mcp_route_tasks.agent_id, auth.agentId),
      before ? sql`(${mcp_route_tasks.created_at} < ${before.time} OR (${mcp_route_tasks.created_at} = ${before.time} AND ${mcp_route_tasks.id} < ${before.id}))` : undefined))
      .orderBy(desc(mcp_route_tasks.created_at), desc(mcp_route_tasks.id)).limit(21);
    const page = rows.slice(0, 20), last = page.at(-1);
    return { tasks: await Promise.all(page.map(row => getMcpTask(auth.agentId, row.id))),
      ...(rows.length > 20 && last ? { nextCursor: Buffer.from(JSON.stringify({ time: last.created_at, id: last.id })).toString('base64url') } : {}) };
  }
  const parsed = taskParams.safeParse(params);
  if (!parsed.success) throw new McpTaskError('INVALID_MCP_TASK_ID');
  const taskId = parsed.data.taskId;
  const current = await snapshot(auth.agentId, taskId);
  if (method === 'tasks/get') return current.task;
  if (method === 'tasks/cancel') {
    if (terminal.has(current.task.status)) throw new McpTaskError('MCP_TASK_TERMINAL');
    // MCP cancellation MUST be terminal. A reserved checkout may still receive late funds.
    if (!current.row.route_id || current.data.lifecycle?.trade_id || current.data.route?.service_order_id)
      throw new McpTaskError('MCP_TASK_NOT_CANCELABLE', 409, -32602, { taskId, funds_state: current.data.funds_state });
    const cancelled = await cancelRouteTask(req, auth, taskId, 'mcp');
    if (cancelled.status.state !== 'TASK_STATE_CANCELED') throw new McpTaskError('MCP_TASK_NOT_CANCELABLE', 409, -32602, { taskId });
    return getMcpTask(auth.agentId, taskId);
  }
  if (method !== 'tasks/result') throw new McpTaskError('MCP_METHOD_NOT_FOUND', 400, -32601);
  if (terminal.has(current.task.status)) return finalResult(auth.agentId, taskId);
  await db.delete(mcp_result_streams).where(lt(mcp_result_streams.expires_at, Math.floor(Date.now() / 1000)));
  const [{ count }] = await db.select({ count: sql<number>`COUNT(*)` }).from(mcp_result_streams).where(eq(mcp_result_streams.agent_id, auth.agentId));
  if (Number(count) >= 100) throw new McpTaskError('MCP_RESULT_STREAM_LIMIT', 429, -32000);
  const now = Math.floor(Date.now() / 1000);
  const [stream] = await db.insert(mcp_result_streams).values({ agent_id: auth.agentId, task_id: taskId, rpc_id_json: JSON.stringify(id), created_at: now, expires_at: now + 900 }).returning();
  return resultStream(req, stream);
}
async function finalResult(agentId: string, id: string) {
  const current = await snapshot(agentId, id, true);
  if (!terminal.has(current.task.status)) return null;
  if (current.task.status === 'completed' && current.observed !== 'completed')
    throw new McpTaskError('MCP_RESULT_BACKING_UNAVAILABLE', 503, -32000, { taskId: id, retryable: true });
  return toolResult(id, { task: current.task, ...current.data }, current.task.status !== 'completed');
}
export async function resumeMcpResult(req: NextRequest) {
  const auth = await authenticateMcpTask(req);
  const match = /^([a-f0-9-]{36}):0$/i.exec(req.headers.get('last-event-id') || '');
  if (!match || !taskIdSchema.safeParse(match[1]).success) throw new McpTaskError('INVALID_MCP_RESULT_CURSOR');
  const [stream] = await db.select().from(mcp_result_streams).where(and(eq(mcp_result_streams.id, match[1]), eq(mcp_result_streams.agent_id, auth.agentId))).limit(1);
  if (!stream) throw new McpTaskError('MCP_RESULT_STREAM_NOT_FOUND', 404, -32602);
  if (stream.expires_at <= Math.floor(Date.now() / 1000)) throw new McpTaskError('MCP_RESULT_CURSOR_EXPIRED', 410, -32000, { taskId: stream.task_id, retryable: true });
  await ownedRow(auth.agentId, stream.task_id);
  return resultStream(req, stream);
}
function resultStream(req: NextRequest, row: typeof mcp_result_streams.$inferSelect) {
  let stopped = false;
  const encoder = new TextEncoder(), id = JSON.parse(row.rpc_id_json) as RpcId;
  const abort = () => { stopped = true; };
  req.signal.addEventListener('abort', abort, { once: true });
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (value: string) => { if (!stopped) controller.enqueue(encoder.encode(value)); };
      try {
        emit(`id: ${row.id}:0\nretry: 1000\ndata:\n\n`);
        const deadline = Date.now() + 15_000;
        while (!stopped && Date.now() < deadline) {
          // Revalidate revocation/scopes on every resumed connection and before each private result.
          const auth = await authenticateMcpTask(req, false, false);
          if (auth.agentId !== row.agent_id) throw new McpTaskError('MCP_RESULT_STREAM_NOT_FOUND', 404);
          const result = await finalResult(auth.agentId, row.task_id);
          if (result) { emit(`id: ${row.id}:1\ndata: ${JSON.stringify({ jsonrpc: '2.0', id, result })}\n\n`); break; }
          emit(': awaiting terminal task\n\n');
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        // No premature tool result: clients resume this exact request with its durable cursor.
        if (!stopped) { emit('retry: 1000\n\n'); controller.close(); }
      } catch (error) {
        const problem = mcpTaskError(error);
        if (problem && !stopped) {
          emit(`data: ${JSON.stringify({ jsonrpc: '2.0', id, error: { code: problem.rpcCode, message: problem.code, data: problem.data } })}\n\n`);
          controller.close();
        } else if (!stopped) controller.error(error);
      } finally { req.signal.removeEventListener('abort', abort); }
    },
    cancel() { stopped = true; req.signal.removeEventListener('abort', abort); },
  });
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'private, no-store', 'X-Accel-Buffering': 'no' } });
}
