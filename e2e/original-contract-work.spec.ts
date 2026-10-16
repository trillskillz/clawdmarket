import { test, expect, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { canonicalJSON } from '../scripts/verifier-contract.mjs'

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', milestone = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', submission = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const acceptance = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', release = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const debit = '11111111-1111-4111-8111-111111111111', sale = '22222222-2222-4222-8222-222222222222'
const buyer = 'ORIGINAL_BUYER', seller = 'ORIGINAL_SELLER', url = `/contracts/${id}/work`, api = `/api/contracts/${id}`
const sha = (value: unknown) => createHash('sha256').update(canonicalJSON(value)).digest('hex')
async function fixture(page: Page, role: 'buyer' | 'seller' = 'buyer', keyOnly = false) {
  let contractState = role === 'buyer' ? 'AWAITING_REVIEW' : 'FUNDED', state = role === 'buyer' ? 'AWAITING_BUYER_REVIEW' : 'PENDING'
  let bundle: any = role === 'buyer' ? { report: 'PRIVATE_SELECTED_ORIGINAL_REPORT' } : null
  let content = bundle ? sha({ kind: 'reviewed-contract-submission-v1', contract_id: id, milestone_id: milestone, seller_id: seller, artifact_bundle: bundle }) : ''
  let decision: any = null, posting: any = null, lose = true, beforeAccept = false, denied = false, readOnly = false, acceptPosts = 0, releasePosts = 0, outputPosts = 0, firstAccept: any = null
  const key = 'cmk_PRIVATE_SESSION_ONLY_KEY', requests: Array<{ method: string; key: string | undefined }> = []
  const terms = { rail: 'credit', redeemable: false, seller_receives: 'nonwithdrawable_account_credit', upfront_fee_minor: 5, refundable_principal_minor: 100 }
  const decisionView = () => ({ decision, selected_submission_id: submission, applies_to_current_submission: true, current_milestone_state: state, credit_remaining_principal_minor: posting ? 0 : 100, financial_release_performed: false, semantic_accuracy: 'unmeasured' })
  const postingView = () => ({ release: posting, selected_submission_id: submission, current_milestone_state: state, credit_remaining_principal_minor: 0, financial_posting_confirmed: true })
  await page.route(`**${api}**`, async route => {
    const req = route.request(), u = new URL(req.url()), method = req.method(), auth = req.headers().authorization
    requests.push({ method, key: auth })
    if (auth) expect(req.headers().cookie).toBeUndefined()
    if (denied || keyOnly && auth !== `Bearer ${key}` || readOnly && method !== 'GET') return route.fulfill({ status: 403, json: { error: 'Original access required' } })
    if (u.pathname === api) {
      if (method === 'PATCH') { expect(req.postDataJSON()).toEqual({ action: 'start' }); contractState = 'IN_PROGRESS'; state = 'ACTIVE' }
      return route.fulfill({ json: { contract: { id, buyer_id: buyer, seller_id: seller, reviewed_contract: true, state: contractState, payment_rail: 'credit', total_amount: 1, fee_amount: .05, escrow_amount: 1.05 },
        viewer: { is_buyer: role === 'buyer', is_seller: role === 'seller' }, milestones: [{ id: milestone, state, submission_id: bundle ? submission : null }] } })
    }
    if (method === 'GET' && u.searchParams.has('acceptance_reference')) return route.fulfill({ status: decision && u.searchParams.get('acceptance_reference') === decision.client_reference ? 200 : 404,
      json: decision && u.searchParams.get('acceptance_reference') === decision.client_reference ? decisionView() : { code: 'CONTRACT_ACCEPTANCE_NOT_FOUND' } })
    if (method === 'GET' && u.searchParams.has('release_reference')) return route.fulfill({ status: posting && u.searchParams.get('release_reference') === posting.client_reference ? 200 : 404,
      json: posting && u.searchParams.get('release_reference') === posting.client_reference ? postingView() : { code: 'CONTRACT_RELEASE_NOT_FOUND' } })
    if (method === 'PATCH') {
      acceptPosts++; const b = req.postDataJSON(); expect(b.submission_id).toBe(submission); expect(b.content_hash).toBe(content); expect(b.approve).toBe(true)
      if (firstAccept) expect(b).toEqual(firstAccept); else firstAccept = b
      if (beforeAccept) { beforeAccept = false; return route.abort('failed') }
      decision = { id: acceptance, kind: 'explicit_buyer_acceptance', contract_id: id, milestone_id: milestone, buyer_id: buyer, submission_id: submission, content_hash: content, client_reference: b.client_reference }
      state = 'APPROVED'
      if (lose) return route.abort('failed')
      return route.fulfill({ status: 201, json: decisionView() })
    }
    if (method === 'POST' && u.pathname.endsWith('/release')) {
      releasePosts++; const b = req.postDataJSON(); expect(b.acceptance_id).toBe(acceptance); expect(b.submission_id).toBe(submission); expect(b.content_hash).toBe(content)
      posting = { id: release, contract_id: id, milestone_id: milestone, acceptance_id: acceptance, submission_id: submission, content_hash: content, client_reference: b.client_reference,
        amount_minor: 100, settlement_entry_id: debit, sale_entry_id: sale, rail: 'credit', basis: 'explicit_buyer_acceptance', seller_receives: 'nonwithdrawable_account_credit' }
      state = 'PAID'; contractState = 'COMPLETED'
      if (lose) return route.abort('failed')
      return route.fulfill({ status: 201, json: postingView() })
    }
    if (method === 'POST' && u.pathname.endsWith('/submissions')) {
      outputPosts++; const b = req.postDataJSON(); bundle = b.artifact_bundle
      content = sha({ kind: 'reviewed-contract-submission-v1', contract_id: id, milestone_id: milestone, seller_id: seller, artifact_bundle: bundle })
      state = 'AWAITING_BUYER_REVIEW'; contractState = 'AWAITING_REVIEW'
      if (lose) return route.abort('failed')
      return route.fulfill({ status: 201, json: { submission: { id: submission, content_hash: content, client_reference: b.client_reference, authorizes_payment: false } } })
    }
    return route.fulfill({ json: { contract_id: id, contract_state: contractState, milestone_id: milestone, milestone_state: state, selected_submission_id: bundle ? submission : null,
      credit_remaining_principal_minor: posting ? 0 : 100, superseded: false, settlement_terms: terms, original_requirements: { id: milestone, title: 'Original bounded report', amount_minor: 100, acceptance_spec: { required_artifacts: ['report'] } },
      submission: bundle ? { id: submission, content_hash: content, artifact_bundle: bundle, auto_check_result: 'pass', authorizes_payment: false, semantic_accuracy: 'unmeasured', remote_execution_observed: false } : null } })
  })
  return { key, requests, counters: () => ({ acceptPosts, releasePosts, outputPosts }), setDenied: () => denied = true, setReadOnly: () => readOnly = true,
    allowReplies: () => lose = false, loseReplies: () => lose = true, failBeforeAcceptance: () => beforeAccept = true }
}
for (const width of [1440, 390, 320]) test(`original buyer reviews private output and recovers separate lost acceptance/release at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 }); const f = await fixture(page)
  await page.goto(url); await expect(page.getByRole('heading', { name: 'Selected private output' })).toBeVisible()
  await expect(page.getByText(/Semantic accuracy is unmeasured/)).toBeVisible()
  const accept = page.getByRole('button', { name: 'Accept exact output' }); await expect(accept).toBeDisabled()
  await page.getByRole('checkbox', { name: /I reviewed this exact submission/ }).check(); await accept.click()
  await expect(page.locator('main').getByRole('alert')).toBeVisible(); expect(f.counters()).toEqual({ acceptPosts: 1, releasePosts: 0, outputPosts: 0 })
  await page.reload(); await expect(page.getByText(/Exact buyer acceptance:/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Release original credit' })).toBeDisabled()
  await page.getByRole('checkbox', { name: /I authorize the separate original credit posting/ }).check(); await page.getByRole('button', { name: 'Release original credit' }).click()
  await expect(page.locator('main').getByRole('alert')).toBeVisible(); await page.reload()
  await expect(page.getByText(/Confirmed original credit posting:/)).toContainText(debit)
  expect(f.counters()).toEqual({ acceptPosts: 1, releasePosts: 1, outputPosts: 0 })
  const saved = await page.evaluate(() => JSON.stringify(Object.values(sessionStorage)))
  expect(saved).not.toContain('PRIVATE_SELECTED_ORIGINAL_REPORT'); expect(saved).not.toContain('artifact_bundle'); expect(saved).not.toContain(f.key)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  f.setDenied(); await page.getByRole('button', { name: 'Refresh original state' }).click()
  await expect(page.getByText('PRIVATE_SELECTED_ORIGINAL_REPORT', { exact: false })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Selected private output' })).toHaveCount(0)
})
test('original seller explicitly starts, submits private JSON once and recovers a lost output without buyer authority', async ({ page }) => {
  const f = await fixture(page, 'seller'); f.allowReplies()
  await page.goto(url); await expect(page.getByRole('button', { name: 'Start original work' })).toBeDisabled()
  await page.getByRole('checkbox', { name: /I understand the original nonwithdrawable seller credit/ }).check(); await page.getByRole('button', { name: 'Start original work' }).click()
  await page.getByLabel('Original artifact bundle JSON').fill('{"report":"PRIVATE_PROVIDER_OUTPUT"}')
  await page.getByRole('checkbox', { name: /I reviewed the original requirements and nonwithdrawable settlement terms/ }).check()
  f.loseReplies()
  await page.getByRole('button', { name: 'Submit original output' }).click()
  await expect(page.locator('main').getByRole('alert')).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Selected private output' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Accept exact output' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Release original credit' })).toHaveCount(0)
  expect(f.counters()).toEqual({ acceptPosts: 0, releasePosts: 0, outputPosts: 1 })
  expect(await page.evaluate(() => JSON.stringify(Object.values(sessionStorage)))).not.toContain('PRIVATE_PROVIDER_OUTPUT')
})
test('missing original acceptance after a precommit failure permits only an explicit saved-body retry', async ({ page }) => {
  const f = await fixture(page); f.allowReplies(); f.failBeforeAcceptance()
  await page.goto(url); await page.getByRole('checkbox', { name: /I reviewed this exact submission/ }).check(); await page.getByRole('button', { name: 'Accept exact output' }).click()
  await expect(page.locator('main').getByRole('alert')).toBeVisible()
  await page.reload(); await expect(page.getByRole('button', { name: 'Accept exact output' })).toBeDisabled()
  expect(f.counters().acceptPosts).toBe(1)
  await page.getByRole('checkbox', { name: /I reviewed this exact submission/ }).check(); await page.getByRole('button', { name: 'Accept exact output' }).click()
  await expect(page.getByText(/Exact buyer acceptance:/)).toBeVisible()
  expect(f.counters()).toEqual({ acceptPosts: 2, releasePosts: 0, outputPosts: 0 })
})
test('original agent key stays in memory, omits cookies and cannot upgrade a read-only credential', async ({ page }) => {
  const f = await fixture(page, 'buyer', true); f.setReadOnly()
  await page.context().addCookies([{ name: 'auth-token', value: 'DUMMY_OWNER_COOKIE', url: 'http://localhost:3000' }])
  await page.goto(url); await expect(page.locator('main').getByRole('alert')).toBeVisible()
  await page.getByText('Use an original agent credential', { exact: true }).click()
  await page.getByLabel('Original participant agent API key').fill(f.key); await page.getByRole('button', { name: 'Inspect with original agent key' }).click()
  await expect(page.getByRole('heading', { name: 'Selected private output' })).toBeVisible()
  await page.getByRole('checkbox', { name: /I reviewed this exact submission/ }).check(); await page.getByRole('button', { name: 'Accept exact output' }).click()
  await expect(page.locator('main').getByRole('alert')).toBeVisible(); expect(f.counters().acceptPosts).toBe(0)
  expect(await page.evaluate(() => JSON.stringify(Object.values(sessionStorage)))).not.toContain(f.key)
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await expect(page.getByLabel('Original participant agent API key')).toHaveValue('')
  await page.getByRole('button', { name: 'Refresh original state' }).click(); await expect(page.getByRole('heading', { name: 'Selected private output' })).toHaveCount(0)
})
