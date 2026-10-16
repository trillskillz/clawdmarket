import { test, expect } from '@playwright/test'
import type { OrganizationContractAuthorization } from '../sdk/typescript/src/index'

const org = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', contract = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const api = `/api/organizations/${org}/contract-authorizations/${id}`, url = `/organizations/${org}/contract-authorizations/${id}`, key = `clawdmarket-contract-review:${org}:${id}`
function authorization(role: 'owner' | 'reviewer' = 'reviewer'): OrganizationContractAuthorization {
  return { id, organization_id: org, contract_id: contract, buyer_id: 'ORIGINAL_PRIVATE_BUYER', team_id: null, cost_center: 'ORIGINAL-COST-CENTER',
    client_reference: 'original-contract-proposal', authority_hash: 'a'.repeat(64), version: 1, state: 'pending', viewer_role: role, approved_at: null, revoked_at: null,
    decision: null, review_url: url, funding_available: false, funding_api_implemented: true, funding_requires_current_review: true,
    terms: { version: 1, explicit_buyer_acceptance: true, automatic_review_window_acceptance: false, expires_at: new Date(Date.now() + 600000).toISOString(),
      max_daily_minor: 105, max_monthly_minor: 105, max_lifetime_minor: 105,
      payment: { rail: 'credit', redeemable: false, seller_receives: 'nonwithdrawable_account_credit', upfront_fee_minor: 5, refundable_principal_minor: 100 },
      original: { contract_id: contract, buyer_id: 'ORIGINAL_PRIVATE_BUYER', seller_id: 'ORIGINAL_PRIVATE_SELLER', listing_id: null, total_minor: 100, fee_minor: 5, gross_minor: 105,
        expires_at: new Date(Date.now() + 1200000).toISOString(), creation: { client_reference: 'original-draft-reference', request_hash: 'b'.repeat(64) },
        milestones: [{ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', milestone_index: 0, title: 'Original finite report', amount_minor: 40, acceptance_spec: { required_artifacts: ['PRIVATE_REQUIRED_REPORT'] }, deadline_at: null, review_window_hours: 24 },
          { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', milestone_index: 1, title: 'Original final report', amount_minor: 60, acceptance_spec: { notes: 'PRIVATE_SCOPE_REQUIREMENT' }, deadline_at: null, review_window_hours: 12 }] } } }
}
for (const width of [1440, 390, 320]) test(`private original contract review and credit terms recover a lost decision at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 }); const a = authorization(); let original: any, posts = 0, denied = false
  await page.route(`**${api}**`, async route => {
    if (denied) return route.fulfill({ status: 404, json: { code: 'ORGANIZATION_CONTRACT_NOT_FOUND' } })
    if (route.request().method() === 'POST') {
      posts++; const body = route.request().postDataJSON()
      if (original) expect(body).toEqual(original); else original = body
      expect(body.authority_hash).toBe(a.authority_hash); expect(body.approve).toBe(true)
      a.state = 'approved'; a.decision = body
      if (posts === 1) return route.abort('failed')
    }
    return route.fulfill({ json: { authorization: a } })
  })
  await page.goto(url)
  await expect(page.getByRole('heading', { name: 'Original milestones', exact: true })).toBeVisible()
  await expect(page.getByText('ORIGINAL_PRIVATE_SELLER', { exact: true })).toBeVisible()
  await expect(page.getByText('$1.05 USD', { exact: true })).toBeVisible()
  await expect(page.getByText(/Prepaid credit is nonwithdrawable/)).toBeVisible()
  await expect(page.getByText(/Fresh funding rollout is disabled/)).toBeVisible()
  const approve = page.getByRole('button', { name: 'Approve original contract' }); await expect(approve).toBeDisabled()
  await page.getByRole('checkbox').check(); await approve.click()
  await expect(page.locator('main').getByRole('alert')).toContainText('Refresh')
  await expect(page.getByRole('heading', { name: 'Original milestones', exact: true })).toHaveCount(0)
  await page.reload(); await expect(page.getByText('Status: approved')).toBeVisible()
  const saved = await page.evaluate(key => sessionStorage.getItem(key), key)
  expect(JSON.parse(saved!)).toEqual(original)
  for (const secret of ['PRIVATE_REQUIRED_REPORT', 'PRIVATE_SCOPE_REQUIREMENT', 'ORIGINAL_PRIVATE_BUYER', 'ORIGINAL_PRIVATE_SELLER', 'artifact_bundle', 'api_key']) expect(saved).not.toContain(secret)
  a.state = 'pending'; await page.getByRole('button', { name: 'Refresh original review' }).click(); await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Approve original contract' }).click(); await expect(page.getByText('Status: approved')).toBeVisible(); expect(posts).toBe(2)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  denied = true; await page.getByRole('button', { name: 'Refresh original review' }).click()
  await expect(page.getByText('ORIGINAL_PRIVATE_SELLER', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Original milestones', exact: true })).toHaveCount(0)
})
test('contract owner can revoke fresh funding but cannot approve or inspect delivery through review authority', async ({ page }) => {
  const a = authorization('owner')
  await page.route(`**${api}**`, async route => { if (route.request().method() === 'DELETE') a.state = 'revoked'; return route.fulfill({ json: { authorization: a } }) })
  await page.goto(url); await expect(page.getByRole('button', { name: 'Approve original contract' })).toHaveCount(0)
  await expect(page.getByText('The selected organizational reviewer must approve this proposal.')).toBeVisible()
  await expect(page.getByText(/Seller output stays private to the original buyer and seller/)).toBeVisible()
  await page.getByRole('button', { name: 'Revoke fresh funding' }).click(); await expect(page.getByText('Status: revoked')).toBeVisible()
  await expect(page.getByRole('status')).toContainText('Original paid work, decisions, refunds and credit postings remain recoverable')
})
test('substituted saved contract decisions, expired scope and unavailable reads stop approval and clear private data', async ({ page }) => {
  const a = authorization(); let posts = 0, unavailable = false
  await page.route(`**${api}**`, async route => {
    if (route.request().method() === 'POST') posts++
    return route.fulfill({ status: unavailable ? 503 : 200, json: unavailable ? { error: 'busy' } : { authorization: a } })
  })
  await page.goto(url); await expect(page.getByRole('heading', { name: 'Original milestones', exact: true })).toBeVisible()
  await page.evaluate(key => sessionStorage.setItem(key, JSON.stringify({ version: 1, client_reference: 'saved-original-decision', authority_hash: 'b'.repeat(64), approve: true })), key)
  await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Approve original contract' }).click()
  await expect(page.locator('main').getByRole('alert')).toContainText('saved decision differs'); expect(posts).toBe(0)
  await page.getByRole('button', { name: 'Refresh original review' }).click(); await expect(page.getByText('ORIGINAL_PRIVATE_SELLER', { exact: true })).toBeVisible()
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await expect(page.getByText('ORIGINAL_PRIVATE_SELLER', { exact: true })).toHaveCount(0)
  a.terms.expires_at = new Date(Date.now() - 1000).toISOString()
  await page.getByRole('button', { name: 'Refresh original review' }).click()
  await expect(page.getByRole('button', { name: 'Approve original contract' })).toHaveCount(0)
  unavailable = true; await page.getByRole('button', { name: 'Refresh original review' }).click()
  await expect(page.getByText('ORIGINAL_PRIVATE_SELLER', { exact: true })).toHaveCount(0)
  await expect(page.locator('main').getByRole('alert')).toContainText('Inspection is unavailable'); expect(posts).toBe(0)
})
