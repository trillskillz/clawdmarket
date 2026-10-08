import 'server-only';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from './db';
import { a2a_message_claims, a2a_route_tasks, mcp_route_tasks, route_plans } from './schema';
import { canonicalContract } from './structured-verification';
import { withKeyedWriteLock } from './service-reservation-lock';
import { routePlanInput } from './route-planning';
import { RouteMandateError, validateRouteMandate } from './route-payment-mandate';
import { inspectOwnedRoute } from './route-inspection';
import { inspectRouteLifecycle, inspectOwnedRouteResult } from './route-lifecycle';
import { hasAgentCredentialScope } from './agent-credential-scopes';
import type { RegisteredAgentAuth } from './registered-agent-auth';
import { POST as planRoute } from '@/app/api/routes/plan/route';
import { POST as executeRoute } from '@/app/api/routes/[id]/execute/route';
import { DELETE as cancelRoute } from '@/app/api/routes/[id]/route';
type Auth = Extract<RegisteredAgentAuth, {
  kind: 'agent';
}>;
type TaskRow = typeof a2a_route_tasks.$inferSelect;
export type RouteTaskTransport = 'a2a' | 'mcp';
const taskTable = (transport: RouteTaskTransport) => transport === 'mcp' ? mcp_route_tasks : a2a_route_tasks;
const maxTasks = 100;
export class A2ARouteError extends Error {
  constructor(public reason: string, public status = 409, public taskId?: string, public fundsState = 'unknown', public rpcCode?: number) { super(reason); }
}
export const a2aRoutingWritesEnabled = () => process.env.NODE_ENV !== 'production' || process.env.CLAWDMARKET_A2A_ROUTING_WRITES_ENABLED === 'true';
export function requireA2AWriter(auth: Auth) {
  for (const scope of ['agent:read', 'marketplace:write', 'payments:write'] as const)
    if (!hasAgentCredentialScope(auth.scopes, scope))
      throw new A2ARouteError('A2A_ROUTING_SCOPE_REQUIRED', 403);
}
async function write<T>(key: string, operation: () => Promise<T>): Promise<T> {
  return withKeyedWriteLock(key, async () => {
    for (let attempt = 0;; attempt++) {
      try {
        return await operation();
      }
      catch (error) {
        let cause: unknown = error, busy = false;
        for (let depth = 0; cause && typeof cause === 'object' && depth < 6; depth++) {
          const e = cause as {
            message?: string;
            cause?: unknown;
          };
          busy ||= /SQLITE_BUSY|database is locked/i.test(e.message || '');
          cause = e.cause;
        }
        if (!busy || attempt >= 5)
          throw error;
        await new Promise(resolve => setTimeout(resolve, 20 * 2 ** attempt));
      }
    }
  });
}
/** A single durable namespace prevents same-message collisions between read and write skills. */
export async function claimA2AMessage(agentId: string, message: Record<string, unknown>) {
  const id = String(message.messageId), requestJson = canonicalContract(message);
  return write(`a2a-message:${agentId}:${id}`, () => db.transaction(async (tx) => {
    const legacy = await tx.all<{
      request_message: string;
    }>(sql `SELECT request_message FROM a2a_tasks WHERE agent_id = ${agentId} AND message_id = ${id} LIMIT 1`);
    if (legacy[0] && canonicalContract(JSON.parse(legacy[0].request_message)) !== requestJson)
      throw new A2ARouteError('A2A_MESSAGE_CONFLICT');
    const prior = await tx.select({ message_id: a2a_message_claims.message_id }).from(a2a_message_claims).where(and(eq(a2a_message_claims.agent_id, agentId), eq(a2a_message_claims.message_id, id))).limit(1);
    await tx.insert(a2a_message_claims).values({ agent_id: agentId, message_id: id, request_json: requestJson, created_at: Math.floor(Date.now() / 1000) }).onConflictDoNothing();
    const [saved] = await tx.select().from(a2a_message_claims).where(and(eq(a2a_message_claims.agent_id, agentId), eq(a2a_message_claims.message_id, id))).limit(1);
    if (!saved || saved.request_json !== requestJson)
      throw new A2ARouteError('A2A_MESSAGE_CONFLICT');
    return prior.length > 0;
  }));
}
const actionSchema = z.union([
  z.object({ action: z.literal('route_work'), request: z.record(z.string(), z.unknown()) }).strict(),
  z.object({ action: z.literal('route_work'), route_id: z.uuid(), mandate_id: z.uuid() }).strict(),
  z.object({ action: z.literal('cancel_route'), route_id: z.uuid() }).strict(),
]);
export function parseA2ARouteMessage(message: unknown) {
  const parsed = z.object({ role: z.literal('ROLE_USER'), messageId: z.string().min(1).max(128), taskId: z.uuid().optional(), contextId: z.string().min(1).max(128).optional(),
    parts: z.array(z.object({ data: actionSchema, mediaType: z.literal('application/json').optional() }).strict()).length(1), metadata: z.record(z.string(), z.unknown()).optional(),
  }).strict().safeParse(message);
  if (!parsed.success)
    throw new A2ARouteError('INVALID_A2A_ROUTING_MESSAGE', 400);
  const data = parsed.data.parts[0].data;
  if ('request' in data) {
    if (parsed.data.taskId || 'client_reference' in data.request || !routePlanInput.safeParse({ ...data.request, client_reference: 'a2a-validated-request' }).success)
      throw new A2ARouteError('INVALID_A2A_ROUTING_MESSAGE', 400);
  }
  return { message: parsed.data, data };
}
function internalRequest(request: NextRequest, method: string, path: string, body?: unknown) {
  return new NextRequest(new URL(path, request.url), { method, headers: { Authorization: request.headers.get('authorization') || '', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(request.headers.get('X-ClawdMarket-Run-Kind') ? { 'X-ClawdMarket-Run-Kind': request.headers.get('X-ClawdMarket-Run-Kind')! } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function routeTask(agentId: string, id: string, transport: RouteTaskTransport = 'a2a') {
  const table = taskTable(transport);
  const [row] = await db.select().from(table).where(and(eq(table.id, id), eq(table.agent_id, agentId))).limit(1);
  return row || null;
}
async function saveError(task: TaskRow, body: Record<string, unknown>, status: number, rpcCode?: number, transport: RouteTaskTransport = 'a2a'): Promise<never> {
  const table = taskTable(transport);
  const code = typeof body.error_code === 'string' ? body.error_code : 'ROUTING_OPERATION_UNAVAILABLE';
  await db.update(table).set({ last_error_code: code, updated_at: Math.floor(Date.now() / 1000) }).where(eq(table.id, task.id));
  const lifecycle = task.route_id ? await inspectRouteLifecycle(task.route_id, `user_agent_${task.agent_id}`).catch(() => null) : null;
  throw new A2ARouteError(code, status, task.id, String(body.funds_state || lifecycle?.funds_state || (task.route_id ? 'unknown' : 'no_funds_moved')), rpcCode);
}
const terminalStates = new Set(['TASK_STATE_COMPLETED', 'TASK_STATE_CANCELED', 'TASK_STATE_FAILED']);
export async function a2aRouteTaskView(row: TaskRow, historyLength = 1, includeArtifacts = true, includePrivateResult = true) {
  const buyerId = `user_agent_${row.agent_id}`;
  const snapshot = row.route_id ? await inspectOwnedRoute(row.route_id, buyerId) : null;
  if (row.route_id && !snapshot)
    throw new A2ARouteError('TASK_NOT_FOUND', 404);
  const lifecycle = row.route_id ? await inspectRouteLifecycle(row.route_id, buyerId) : null;
  let state = 'TASK_STATE_SUBMITTED';
  if (snapshot && lifecycle) {
    const phase = lifecycle.phase;
    if (phase === 'completed' && lifecycle.receipt)
      state = 'TASK_STATE_COMPLETED';
    else if (phase === 'refunded' || snapshot.route.state === 'cancelled' && !lifecycle.trade_id)
      state = 'TASK_STATE_CANCELED';
    else if (snapshot.route.state === 'failed' && !lifecycle.trade_id)
      state = 'TASK_STATE_FAILED';
    else if (['planned', 'awaiting_funding', 'awaiting_buyer', 'verification_failed', 'disputed', 'financial_uncertainty', 'cancelled', 'resolved'].includes(phase))
      state = 'TASK_STATE_INPUT_REQUIRED';
    else
      state = 'TASK_STATE_WORKING';
  }
  const [clock] = row.route_id ? await db.select({ updated: route_plans.updated_at }).from(route_plans).where(and(eq(route_plans.id, row.route_id), eq(route_plans.buyer_id, buyerId))).limit(1) : [];
  const content = includeArtifacts && includePrivateResult && state === 'TASK_STATE_COMPLETED' && row.route_id ? await inspectOwnedRouteResult(row.route_id, buyerId) : null;
  const data = { kind: row.action, task_id: row.id, route_id: row.route_id, mandate_id: row.mandate_id, last_error_code: row.last_error_code,
    ...(snapshot || {}), lifecycle, result: content,
    next_action: terminalStates.has(state) ? 'none' : !row.route_id ? 'replay_original_message' : snapshot?.route.state === 'planned' && !row.mandate_id ? 'owner_authorize_then_continue' : lifecycle?.next_action || 'inspect_route',
    funds_state: lifecycle?.funds_state || 'unknown' };
  return { id: row.id, contextId: row.context_id, status: { state, timestamp: new Date(Math.max(row.updated_at, clock?.updated.getTime() / 1000 || 0) * 1000).toISOString() },
    ...(includeArtifacts ? { artifacts: [{ artifactId: row.action, name: 'Buyer-authorized routing task', parts: [{ data, mediaType: 'application/json' }] }] } : {}),
    ...(historyLength > 0 ? { history: [JSON.parse(row.initial_message)] } : {}) };
}
export async function getA2ARouteTask(agentId: string, id: string, historyLength = 1, includeArtifacts = true, transport: RouteTaskTransport = 'a2a') {
  const row = await routeTask(agentId, id, transport);
  return row ? await a2aRouteTaskView(row, historyLength, includeArtifacts) : null;
}
async function bindMandate(task: TaskRow, mandateId: string, transport: RouteTaskTransport) {
  const table = taskTable(transport);
  const [updated] = await db.update(table).set({ mandate_id: mandateId, updated_at: Math.floor(Date.now() / 1000) }).where(and(eq(table.id, task.id), sql `(${table.mandate_id} IS NULL OR ${table.mandate_id} = ${mandateId})`)).returning();
  if (!updated)
    throw new A2ARouteError('A2A_MANDATE_CONFLICT', 409, task.id);
  return updated;
}
export async function sendRouteTaskWork(request: NextRequest, auth: Auth, value: unknown, transport: RouteTaskTransport = 'a2a') {
  const table = taskTable(transport);
  requireA2AWriter(auth);
  const { message, data } = parseA2ARouteMessage(value);
  const replay = await claimA2AMessage(auth.agentId, message);
  return write(`route-task:${transport}:${auth.agentId}`, async () => {
    let task = message.taskId ? await routeTask(auth.agentId, message.taskId, transport) :
      (await db.select().from(table).where(and(eq(table.agent_id, auth.agentId), eq(table.first_message_id, message.messageId))).limit(1))[0] || null;
    if (message.taskId && !task)
      throw new A2ARouteError('TASK_NOT_FOUND', 404);
    if (task && !message.taskId && canonicalContract(JSON.parse(task.initial_message)) !== canonicalContract(message))
      throw new A2ARouteError('A2A_MESSAGE_CONFLICT');
    if (task && message.taskId) {
      if (!('route_id' in data) || data.route_id !== task.route_id || message.contextId !== undefined && message.contextId !== task.context_id)
        throw new A2ARouteError('A2A_TASK_BINDING_CONFLICT', 409, task.id);
      const current = await a2aRouteTaskView(task, 0, false);
      if ('mandate_id' in data && task.mandate_id && data.mandate_id !== task.mandate_id)
        throw new A2ARouteError('A2A_MANDATE_CONFLICT', 409, task.id);
      if (terminalStates.has(current.status.state)) {
        if (replay)
          return a2aRouteTaskView(task);
        throw new A2ARouteError('TASK_TERMINAL', 409, task.id);
      }
    }
    const priorSnapshot = task?.route_id ? await inspectOwnedRoute(task.route_id, auth.syntheticUserId) : null;
    if (task && !message.taskId) {
      const current = await a2aRouteTaskView(task, 0, false);
      if (terminalStates.has(current.status.state) || 'request' in data && task.route_id && !task.mandate_id || data.action === 'route_work' && task.mandate_id && priorSnapshot?.route.service_order_id)
        return a2aRouteTaskView(task);
    }
    if (data.action === 'route_work' && !priorSnapshot?.route.service_order_id) {
      if (!(transport === 'mcp' ? process.env.NODE_ENV !== 'production' || process.env.CLAWDMARKET_MCP_ROUTING_WRITES_ENABLED === 'true' : a2aRoutingWritesEnabled()))
        throw new A2ARouteError('A2A_ROUTING_WRITES_DISABLED', 503, task?.id);
    }
    if ('route_id' in data && !await inspectOwnedRoute(data.route_id, auth.syntheticUserId))
      throw new A2ARouteError('ROUTE_NOT_FOUND', 404);
    if (!task) {
      task = await db.transaction(async (tx) => {
        const [existing] = await tx.select().from(table).where(and(eq(table.agent_id, auth.agentId), eq(table.first_message_id, message.messageId))).limit(1);
        if (existing)
          return existing;
        const [{ count }] = await tx.select({ count: sql<number> `COUNT(*)` }).from(table).where(eq(table.agent_id, auth.agentId));
        if (Number(count) >= maxTasks)
          throw new A2ARouteError('A2A_ROUTE_TASK_LIMIT', 429);
        const [created] = await tx.insert(table).values({ agent_id: auth.agentId, context_id: message.contextId || randomUUID(), first_message_id: message.messageId,
          initial_message: JSON.stringify(message), action: data.action, route_id: 'route_id' in data ? data.route_id : null, created_at: Math.floor(Date.now() / 1000), updated_at: Math.floor(Date.now() / 1000) }).onConflictDoNothing().returning();
        if (created)
          return created;
        const [raced] = await tx.select().from(table).where(and(eq(table.agent_id, auth.agentId), eq(table.first_message_id, message.messageId))).limit(1);
        if (!raced || canonicalContract(JSON.parse(raced.initial_message)) !== canonicalContract(message))
          throw new A2ARouteError('A2A_MESSAGE_CONFLICT');
        return raced;
      });
    }
    if (!task.route_id && 'request' in data) {
      const reference = `${transport}:${task.id}`;
      const planned = await planRoute(internalRequest(request, 'POST', '/api/routes/plan', { ...data.request, client_reference: reference }));
      const body = await planned.json();
      if (!planned.ok)
        return saveError(task, body, planned.status, undefined, transport);
      const routeId = String(body.route.id);
      const [bound] = await db.update(table).set({ route_id: routeId, last_error_code: null, updated_at: Math.floor(Date.now() / 1000) }).where(and(eq(table.id, task.id), sql `(${table.route_id} IS NULL OR ${table.route_id} = ${routeId})`)).returning();
      if (!bound)
        throw new A2ARouteError('A2A_TASK_BINDING_CONFLICT', 409, task.id);
      task = bound;
    }
    if (data.action === 'cancel_route')
      return cancelRouteTask(request, auth, task.id, transport);
    if ('mandate_id' in data) {
      // Validate through the canonical endpoint BEFORE pinning the first authority to the task.
      const [plan] = await db.select().from(route_plans).where(and(eq(route_plans.id, task.route_id!), eq(route_plans.buyer_id, auth.syntheticUserId))).limit(1);
      if (!plan)
        throw new A2ARouteError('ROUTE_NOT_FOUND', 404, task.id);
      try {
        await validateRouteMandate(data.mandate_id, plan);
      }
      catch (cause) {
        if (cause instanceof RouteMandateError)
          return saveError(task, { error_code: cause.code }, cause.status, undefined, transport);
        throw cause;
      }
      task = await bindMandate(task, data.mandate_id, transport);
    }
    if (task.mandate_id && task.route_id) {
      // Global routing/admission, current buyer/agent/org policy and mandate budgets remain authoritative.
      const executed = await executeRoute(internalRequest(request, 'POST', `/api/routes/${task.route_id}/execute`, { mandate_id: task.mandate_id }), { params: Promise.resolve({ id: task.route_id }) });
      const body = await executed.json();
      if (!executed.ok)
        return saveError(task, body, executed.status, undefined, transport);
      await db.update(table).set({ last_error_code: null, updated_at: Math.floor(Date.now() / 1000) }).where(eq(table.id, task.id));
    }
    return a2aRouteTaskView((await routeTask(auth.agentId, task.id, transport))!);
  });
}
export async function cancelRouteTask(request: NextRequest, auth: Auth, id: string, transport: RouteTaskTransport = 'a2a') {
  const table = taskTable(transport);
  requireA2AWriter(auth);
  const task = await routeTask(auth.agentId, id, transport);
  if (!task)
    throw new A2ARouteError('TASK_NOT_FOUND', 404);
  if (!task.route_id)
    throw new A2ARouteError('TASK_NOT_CANCELABLE', 409, task.id, 'unknown', -32002);
  const current = await a2aRouteTaskView(task, 0, false);
  if (current.status.state === 'TASK_STATE_CANCELED')
    return a2aRouteTaskView(task);
  if (terminalStates.has(current.status.state))
    throw new A2ARouteError('TASK_NOT_CANCELABLE', 409, task.id, 'unknown', -32002);
  const canceled = await cancelRoute(internalRequest(request, 'DELETE', `/api/routes/${task.route_id}`), { params: Promise.resolve({ id: task.route_id }) });
  const body = await canceled.json();
  if (!canceled.ok)
    return saveError(task, body, canceled.status, -32002, transport);
  await db.update(table).set({ last_error_code: null, updated_at: Math.floor(Date.now() / 1000) }).where(eq(table.id, task.id));
  return a2aRouteTaskView((await routeTask(auth.agentId, task.id, transport))!);
}
/** Route tasks are retained and capped at 100 per agent in this first rollout. */
export async function listA2ARouteTaskRows(agentId: string, transport: RouteTaskTransport = 'a2a') {
  const table = taskTable(transport);
  return db.select().from(table).where(eq(table.agent_id, agentId)).limit(maxTasks + 1);
}

// Existing A2A callers retain their public API and namespace.
export const sendA2ARouteWork = sendRouteTaskWork;
export const cancelA2ARouteTask = cancelRouteTask;
