import test from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { GET, POST } from '@/app/api/admin/moderation/route'
import { generateJWT } from '@/lib/auth'
import { db } from '@/lib/db'

const client = (db as any).$client

function request(method: 'GET' | 'POST', token: string, body?: unknown) {
  return new NextRequest('http://localhost/api/admin/moderation', {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
}

test('admin moderation lists and reverses durable user and IP bans', async (t) => {
  const priorAdminIds = process.env.ADMIN_USER_IDS
  const priorJwtSecret = process.env.JWT_SECRET
  const suffix = crypto.randomUUID()
  const adminId = `admin_${suffix}`
  const targetId = `target_${suffix}`
  const ip = '203.0.113.91'

  process.env.ADMIN_USER_IDS = adminId
  process.env.JWT_SECRET = 'admin-moderation-route-test-secret'
  t.after(async () => {
    await client.execute({ sql: 'DELETE FROM blacklisted_ips WHERE ip = ?', args: [ip] }).catch(() => {})
    await client.execute({ sql: 'DELETE FROM banned_users WHERE user_id IN (?, ?)', args: [adminId, targetId] }).catch(() => {})
    await client.execute({ sql: 'DELETE FROM users WHERE id IN (?, ?)', args: [adminId, targetId] }).catch(() => {})
    if (priorAdminIds === undefined) delete process.env.ADMIN_USER_IDS
    else process.env.ADMIN_USER_IDS = priorAdminIds
    if (priorJwtSecret === undefined) delete process.env.JWT_SECRET
    else process.env.JWT_SECRET = priorJwtSecret
  })

  const now = Date.now()
  await client.execute({
    sql: `INSERT INTO users (id, email, password_hash, name, role, is_banned, updated_at, created_at)
          VALUES (?, ?, ?, ?, 'human', 0, ?, ?), (?, ?, ?, ?, 'human', 0, ?, ?)`,
    args: [
      adminId, `admin.${suffix}@example.com`, 'test', 'Admin', now, now,
      targetId, `target.${suffix}@example.com`, 'test', 'Target', now, now,
    ],
  })
  await client.execute({
    sql: 'INSERT INTO blacklisted_ips (ip, reason, created_at) VALUES (?, ?, ?)',
    args: [ip, 'Automated moderation test', now],
  })

  const token = generateJWT({ userId: adminId, email: `admin.${suffix}@example.com`, role: 'human' })
  const ban = await POST(request('POST', token, { action: 'ban_user', user_id: targetId, reason: 'Policy violation' }))
  assert.equal(ban.status, 200)

  const banned = await client.execute({ sql: 'SELECT reason FROM banned_users WHERE user_id = ?', args: [targetId] })
  assert.equal(banned.rows[0]?.reason, 'Policy violation')
  const target = await client.execute({ sql: 'SELECT is_banned FROM users WHERE id = ?', args: [targetId] })
  assert.equal(Number(target.rows[0]?.is_banned), 1)

  const list = await GET(request('GET', token))
  assert.equal(list.status, 200)
  const listed = await list.json()
  assert.ok(listed.banned_users.some((row: any) => row.user_id === targetId))
  assert.ok(listed.blacklisted_ips.some((row: any) => row.ip === ip))

  const unban = await POST(request('POST', token, { action: 'unban_user', user_id: targetId }))
  assert.equal(unban.status, 200)
  const unblacklist = await POST(request('POST', token, { action: 'unblacklist_ip', ip }))
  assert.equal(unblacklist.status, 200)

  const after = await GET(request('GET', token))
  const afterBody = await after.json()
  assert.ok(!afterBody.banned_users.some((row: any) => row.user_id === targetId))
  assert.ok(!afterBody.blacklisted_ips.some((row: any) => row.ip === ip))
})

test('admin moderation rejects non-admin callers', async () => {
  const priorAdminIds = process.env.ADMIN_USER_IDS
  const priorJwtSecret = process.env.JWT_SECRET
  process.env.ADMIN_USER_IDS = 'a-different-admin'
  process.env.JWT_SECRET = 'admin-moderation-route-test-secret'
  try {
    const token = generateJWT({ userId: 'not-an-admin', email: 'viewer@example.com', role: 'human' })
    const response = await GET(request('GET', token))
    assert.equal(response.status, 403)
  } finally {
    if (priorAdminIds === undefined) delete process.env.ADMIN_USER_IDS
    else process.env.ADMIN_USER_IDS = priorAdminIds
    if (priorJwtSecret === undefined) delete process.env.JWT_SECRET
    else process.env.JWT_SECRET = priorJwtSecret
  }
})
