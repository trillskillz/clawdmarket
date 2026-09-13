import assert from 'node:assert/strict'
import test from 'node:test'
import { getRequestIp } from '../../lib/request-ip'

function request(headers: Record<string, string>) {
  return { headers: new Headers(headers) } as Pick<Request, 'headers'>
}

test('request IP selects and normalizes the first valid forwarded address', () => {
  assert.equal(getRequestIp(request({ 'x-forwarded-for': '203.0.113.10, 10.0.0.4' })), '203.0.113.10')
  assert.equal(getRequestIp(request({ 'x-forwarded-for': '[2001:db8::1]:443' })), '2001:db8::1')
  assert.equal(getRequestIp(request({ 'x-real-ip': '198.51.100.20:8443' })), '198.51.100.20')
})

test('request IP rejects arbitrary header content', () => {
  assert.equal(getRequestIp(request({ 'x-forwarded-for': 'attacker-controlled-value' })), 'unknown')
  assert.equal(getRequestIp(request({})), 'unknown')
})
