import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { GET as getBriefing } from '@/app/api/agents/briefing/route'
import { hasAgentCredentialScope } from '@/lib/agent-credential-scopes'
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit'
import { resolveRegisteredAgentBearer } from '@/lib/registered-agent-auth'

const RETENTION_SECONDS = 7 * 24 * 60 * 60
const HEADERS = { 'Cache-Control': 'private, no-store', 'A2A-Version': '1.0' }
const TASK_STATES = new Set(['TASK_STATE_UNSPECIFIED', 'TASK_STATE_SUBMITTED', 'TASK_STATE_WORKING', 'TASK_STATE_COMPLETED', 'TASK_STATE_FAILED', 'TASK_STATE_CANCELED', 'TASK_STATE_INPUT_REQUIRED', 'TASK_STATE_REJECTED', 'TASK_STATE_AUTH_REQUIRED'])
type JsonObject = Record<string, unknown>
type RpcId = string | number | null

function object(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function response(id: RpcId, body: JsonObject, status = 200, headers?: Record<string, string>) {
  return NextResponse.json({ jsonrpc: '2.0', id, ...body }, { status, headers: { ...HEADERS, ...headers } })
}

function error(id: RpcId, code: number, message: string, status = 200, reason?: string) {
  return response(id, {
    error: {
      code, message,
      ...(reason ? { data: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason, domain: 'a2a-protocol.org' }] } : {}),
    },
  }, status)
}

function taskFromRow(row: JsonObject, historyLength = 1, includeArtifacts = true) {
  const requestMessage = JSON.parse(String(row.request_message))
  return {
    id: String(row.id),
    contextId: String(row.context_id),
    status: { state: 'TASK_STATE_COMPLETED', timestamp: new Date(Number(row.created_at) * 1000).toISOString() },
    ...(includeArtifacts ? { artifacts: [{ artifactId: 'briefing', name: 'Marketplace briefing', parts: [{ data: JSON.parse(String(row.artifact)), mediaType: 'application/json' }] }] } : {}),
    ...(historyLength > 0 ? { history: [requestMessage] } : {}),
  }
}

function parseBriefingMessage(value: unknown): { message: JsonObject; limit: number } | null {
  if (!object(value) || value.role !== 'ROLE_USER' || typeof value.messageId !== 'string' || value.messageId.length < 1 || value.messageId.length > 128 || !Array.isArray(value.parts) || value.parts.length !== 1) return null
  if (value.taskId != null || (value.contextId != null && (typeof value.contextId !== 'string' || value.contextId.length > 128 || !value.contextId))) return null
  const part = value.parts[0]
  if (!object(part)) return null
  if (['text', 'raw', 'url', 'data'].filter((field) => field in part).length !== 1) return null
  let limit = 20
  if (typeof part.text === 'string') {
    if (part.mediaType != null && part.mediaType !== 'text/plain') return null
    const match = /^(?:get (?:my )?)?(?:marketplace )?briefing(?: limit=(\d{1,2}))?$/i.exec(part.text.trim())
    if (!match) return null
    if (match[1]) limit = Number(match[1])
  } else if (object(part.data) && part.data.action === 'get_briefing') {
    if (part.mediaType != null && part.mediaType !== 'application/json') return null
    limit = part.data.limit == null ? 20 : Number(part.data.limit)
  } else return null
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) return null
  return { message: value, limit }
}

function taskQuery(params: unknown): { id: string; historyLength: number } | null {
  if (!object(params) || typeof params.id !== 'string' || params.id.length < 1 || params.id.length > 128) return null
  const historyLength = params.historyLength == null ? 1 : Number(params.historyLength)
  if (!Number.isInteger(historyLength) || historyLength < 0 || historyLength > 100) return null
  return { id: params.id, historyLength }
}

function decodeCursor(value: unknown): { createdAt: number; id: string } | null {
  if (value === undefined || value === '') return { createdAt: Number.MAX_SAFE_INTEGER, id: '\uffff' }
  if (typeof value !== 'string' || value.length > 512) return null
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (!object(parsed) || !Number.isSafeInteger(parsed.createdAt) || typeof parsed.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(parsed.id)) return null
    return { createdAt: parsed.createdAt as number, id: parsed.id }
  } catch { return null }
}

function encodeCursor(row: JsonObject): string {
  return Buffer.from(JSON.stringify({ createdAt: Number(row.created_at), id: String(row.id) })).toString('base64url')
}

export async function handleA2A(request: NextRequest) {
  let id: RpcId = null
  try {
    const version = request.headers.get('a2a-version')
    if (version && version !== '1.0') return error(null, -32009, 'A2A protocol version not supported; use 1.0.', 400, 'VERSION_NOT_SUPPORTED')
    const contentType = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
    if (contentType !== 'application/json') return error(null, -32600, 'Content-Type must be application/json.', 415)
    const bodyText = await request.text()
    if (bodyText.length > 16_384) return error(null, -32600, 'Request payload too large.', 413)
    let body: unknown
    try { body = JSON.parse(bodyText) } catch { return error(null, -32700, 'Invalid JSON payload.', 400) }
    if (!object(body) || body.jsonrpc !== '2.0' || typeof body.method !== 'string' || !('id' in body) || !(body.id === null || typeof body.id === 'string' || typeof body.id === 'number' && Number.isInteger(body.id))) {
      return error(null, -32600, 'Request payload validation error.', 400)
    }
    id = body.id as RpcId
    if (body.params != null && !object(body.params)) return error(id, -32602, 'Invalid parameters.', 400)

    // The public card advertises bearer authentication and agent:read only.
    const auth = await resolveRegisteredAgentBearer(request.headers.get('authorization'))
    if (auth.kind !== 'agent') {
      if (auth.kind === 'forbidden') return error(id, -32004, 'Credential lacks agent:read.', 403)
      const unauthorized = error(id, -32004, 'An active agent bearer key is required.', 401)
      unauthorized.headers.set('WWW-Authenticate', 'Bearer realm="ClawdMarket A2A"')
      return unauthorized
    }
    if (!hasAgentCredentialScope(auth.scopes, 'agent:read')) return error(id, -32004, 'Credential lacks agent:read.', 403)
    const isSend = body.method === 'SendMessage'
    const quota = await rateLimit(`a2a:${isSend ? 'send' : 'read'}:${auth.agentId}`, { interval: 60_000, maxRequests: isSend ? 10 : 60, failClosed: true })
    if (!quota.success) {
      const limited = error(id, -32004, 'Rate limit exceeded; retry later.', 429)
      limited.headers.set('Retry-After', String(Math.max(1, Math.ceil((quota.reset - Date.now()) / 1000))))
      return limited
    }
    const quotaHeaders = getRateLimitHeaders(quota)
    const params = body.params || {}
    if (isSend) {
      if (!object(params)) return error(id, -32602, 'Invalid parameters.', 400)
      if (params.tenant != null || params.configuration != null && !object(params.configuration)) return error(id, -32602, 'Invalid parameters.', 400)
      if (object(params.configuration)) {
        if (params.configuration.pushNotificationConfig != null) return error(id, -32003, 'Push notifications are not supported.', 400, 'PUSH_NOTIFICATION_NOT_SUPPORTED')
        if (params.configuration.acceptedOutputModes != null && (!Array.isArray(params.configuration.acceptedOutputModes) || !params.configuration.acceptedOutputModes.includes('application/json'))) return error(id, -32005, 'Only application/json output is supported.', 400, 'CONTENT_TYPE_NOT_SUPPORTED')
      }
      if (object(params.message) && params.message.taskId != null) {
        if (typeof params.message.taskId !== 'string' || !params.message.taskId) return error(id, -32602, 'Invalid task id.', 400)
        const prior = await db.$client.execute({ sql: 'SELECT id FROM a2a_tasks WHERE id = ? AND agent_id = ? AND created_at >= ? LIMIT 1', args: [params.message.taskId, auth.agentId, Math.floor(Date.now() / 1000) - RETENTION_SECONDS] })
        return prior.rows.length
          ? error(id, -32004, 'Completed tasks cannot accept further messages.', 400, 'UNSUPPORTED_OPERATION')
          : error(id, -32001, 'Task not found.', 404, 'TASK_NOT_FOUND')
      }
      const parsed = parseBriefingMessage(params.message)
      if (!parsed) return error(id, -32602, 'Supported input: text "briefing" or data {"action":"get_briefing","limit":20}; limit 1-50.', 400)
      const existing = await db.$client.execute({
        sql: 'SELECT * FROM a2a_tasks WHERE agent_id = ? AND message_id = ? AND created_at >= ? LIMIT 1',
        args: [auth.agentId, String(parsed.message.messageId), Math.floor(Date.now() / 1000) - RETENTION_SECONDS],
      })
      if (existing.rows.length) return response(id, { result: { task: taskFromRow(existing.rows[0] as JsonObject) } }, 200, quotaHeaders)
      const bearer = request.headers.get('authorization') || ''
      const briefingResponse = await getBriefing(new NextRequest(new URL(`/api/agents/briefing?limit=${parsed.limit}`, request.url), { headers: { Authorization: bearer } }))
      if (!briefingResponse.ok) return error(id, -32603, 'Marketplace briefing is temporarily unavailable; retry later.', 503)
      const briefing = await briefingResponse.json()
      const taskId = randomUUID()
      const contextId = typeof parsed.message.contextId === 'string' ? parsed.message.contextId : randomUUID()
      const now = Math.floor(Date.now() / 1000)
      await db.$client.execute({ sql: 'DELETE FROM a2a_tasks WHERE created_at < ?', args: [now - RETENTION_SECONDS] })
      await db.$client.execute({
        sql: 'INSERT INTO a2a_tasks (id, agent_id, context_id, message_id, request_message, artifact, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(agent_id, message_id) DO NOTHING',
        args: [taskId, auth.agentId, contextId, String(parsed.message.messageId), JSON.stringify(parsed.message), JSON.stringify(briefing), now],
      })
      const saved = await db.$client.execute({ sql: 'SELECT * FROM a2a_tasks WHERE agent_id = ? AND message_id = ? LIMIT 1', args: [auth.agentId, String(parsed.message.messageId)] })
      const task = taskFromRow(saved.rows[0] as JsonObject)
      return response(id, { result: { task } }, 200, quotaHeaders)
    }
    if (body.method === 'GetTask' || body.method === 'CancelTask') {
      const query = taskQuery(params)
      if (!query) return error(id, -32602, 'A valid task id and non-negative historyLength are required.', 400)
      const result = await db.$client.execute({
        sql: 'SELECT * FROM a2a_tasks WHERE id = ? AND agent_id = ? AND created_at >= ? LIMIT 1',
        args: [query.id, auth.agentId, Math.floor(Date.now() / 1000) - RETENTION_SECONDS],
      })
      if (!result.rows.length) return error(id, -32001, 'Task not found.', 404, 'TASK_NOT_FOUND')
      if (body.method === 'CancelTask') return error(id, -32002, 'Completed tasks cannot be canceled.', 400, 'TASK_NOT_CANCELABLE')
      return response(id, { result: taskFromRow(result.rows[0] as JsonObject, query.historyLength) }, 200, quotaHeaders)
    }
    if (body.method === 'ListTasks') {
      if (!object(params)) return error(id, -32602, 'Invalid parameters.', 400)
      const pageSize = params.pageSize == null ? 20 : Number(params.pageSize)
      const historyLength = params.historyLength == null ? 0 : Number(params.historyLength)
      const cursor = decodeCursor(params.pageToken)
      const after = params.statusTimestampAfter == null ? null : Date.parse(String(params.statusTimestampAfter))
      if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100 || !Number.isInteger(historyLength) || historyLength < 0 || historyLength > 100 || !cursor || params.contextId != null && (typeof params.contextId !== 'string' || params.contextId.length > 128) || params.status != null && !TASK_STATES.has(String(params.status)) || params.includeArtifacts != null && typeof params.includeArtifacts !== 'boolean' || params.statusTimestampAfter != null && (typeof params.statusTimestampAfter !== 'string' || !Number.isFinite(after) || !/Z$/.test(params.statusTimestampAfter))) return error(id, -32602, 'Invalid task list parameters.', 400)
      if (params.status && params.status !== 'TASK_STATE_COMPLETED') return response(id, { result: { tasks: [], totalSize: 0, pageSize, nextPageToken: '' } }, 200, quotaHeaders)
      const where = 'agent_id = ? AND created_at >= ?' + (params.contextId ? ' AND context_id = ?' : '') + (after != null ? ' AND created_at >= ?' : '')
      const args = [auth.agentId, Math.floor(Date.now() / 1000) - RETENTION_SECONDS, ...(params.contextId ? [params.contextId] : []), ...(after != null ? [Math.ceil(after / 1000)] : [])]
      const [count, rows] = await Promise.all([
        db.$client.execute({ sql: `SELECT COUNT(*) AS total FROM a2a_tasks WHERE ${where}`, args }),
        db.$client.execute({ sql: `SELECT * FROM a2a_tasks WHERE ${where} AND (created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC, id DESC LIMIT ?`, args: [...args, cursor.createdAt, cursor.createdAt, cursor.id, pageSize + 1] }),
      ])
      const totalSize = Number(count.rows[0]?.total || 0)
      const page = rows.rows.slice(0, pageSize)
      return response(id, { result: { tasks: page.map(row => taskFromRow(row as JsonObject, historyLength, params.includeArtifacts === true)), totalSize, pageSize, nextPageToken: rows.rows.length > pageSize ? encodeCursor(page[page.length - 1] as JsonObject) : '' } }, 200, quotaHeaders)
    }
    if (body.method === 'SendStreamingMessage' || body.method === 'SubscribeToTask' || body.method === 'GetExtendedAgentCard') return error(id, -32004, 'Operation not supported by this agent.', 400, 'UNSUPPORTED_OPERATION')
    if (['CreateTaskPushNotificationConfig', 'GetTaskPushNotificationConfig', 'ListTaskPushNotificationConfigs', 'DeleteTaskPushNotificationConfig'].includes(body.method)) return error(id, -32003, 'Push notifications are not supported.', 400, 'PUSH_NOTIFICATION_NOT_SUPPORTED')
    return error(id, -32601, 'Method not found.', 404)
  } catch (cause) {
    console.error('[a2a] request failed', cause)
    return error(id, -32603, 'Internal error.', 500)
  }
}
