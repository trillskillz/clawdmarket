import { test, expect } from '@playwright/test';
import { createClient } from '@libsql/client';

let registrationSequence = 0;

async function registerAccount(request: any, label: string) {
  registrationSequence += 1;
  const now = Date.now();
  const email = `pw.${label.toLowerCase()}.${now}.${registrationSequence}@example.com`;
  const password = 'Password123!';
  const response = await request.post('/api/auth/register', {
    headers: { 'x-forwarded-for': `2001:db8:${(now % 65536).toString(16)}::${registrationSequence}` },
    data: { email, password, name: `Playwright ${label}`, role: 'agent' },
  });
  expect(response.status()).toBe(201);
  const body = await response.json();
  return { email, password, userId: body.user.id as string };
}

async function fundLocalAccount(email: string, amount: number) {
  const url = process.env.TURSO_DATABASE_URL || 'file:./local.db';
  if (!url.startsWith('file:')) {
    throw new Error('Contract E2E funding is restricted to a local file: database');
  }
  const client = createClient({ url });
  const result = await client.execute({
    sql: `UPDATE wallets SET balance = ? WHERE user_id = (SELECT id FROM users WHERE email = ?)`,
    args: [amount, email],
  });
  if (result.rowsAffected !== 1) throw new Error('Failed to fund local E2E buyer');
  client.close();
}

async function loginToken(request: any, email: string, password: string) {
  const res = await request.post('/api/auth/login', {
    headers: { 'x-forwarded-for': `2001:db8:${(Date.now() % 65536).toString(16)}::40` },
    data: { email, password },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body?.token).toBeTruthy();
  return body.token as string;
}

test.describe('API lifecycle matrix', () => {
  test('api key lifecycle (create + list + revoke)', async ({ request }) => {
    const account = await registerAccount(request, 'Keys');
    const token = await loginToken(request, account.email, account.password);

    const create = await request.post('/api/auth/api-keys', {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: { name: `pw-key-${Date.now()}` },
    });

    expect(create.status()).toBe(201);
    const created = await create.json();
    expect(created.api_key).toBeTruthy();
    expect(created.key_info?.id).toBeTruthy();

    const list = await request.get('/api/auth/api-keys', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(list.ok()).toBeTruthy();
    const listed = await list.json();
    expect(Array.isArray(listed.keys)).toBeTruthy();
    expect(listed.keys.some((k: any) => k.id === created.key_info.id)).toBeTruthy();

    const revoke = await request.delete(`/api/auth/api-keys/${created.key_info.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(revoke.ok()).toBeTruthy();

    const listAfter = await request.get('/api/auth/api-keys', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(listAfter.ok()).toBeTruthy();
    const after = await listAfter.json();
    expect(after.keys.some((k: any) => k.id === created.key_info.id)).toBeFalsy();
  });

  test('listing + trade preview lifecycle', async ({ request }) => {
    const seller = await registerAccount(request, 'PreviewSeller');
    const sellerToken = await loginToken(request, seller.email, seller.password);

    const listingTitle = `PW Preview Listing ${Date.now()}`;

    const listingRes = await request.post('/api/listings', {
      headers: {
        Authorization: `Bearer ${sellerToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        category: 'skills',
        title: listingTitle,
        description: 'Playwright automated listing for trade preview integration testing.',
        price_bankr: 1200,
      },
    });

    expect(listingRes.status()).toBe(201);
    const listingBody = await listingRes.json();
    const listingId = listingBody.listing?.id;
    expect(listingId).toBeTruthy();

    const detailRes = await request.get(`/api/listings/${listingId}`);
    expect(detailRes.ok()).toBeTruthy();

    const previewRes = await request.post('/api/trades/preview', {
      headers: { 'Content-Type': 'application/json' },
      data: { listing_id: listingId },
    });

    expect(previewRes.ok()).toBeTruthy();
    const preview = await previewRes.json();
    expect(preview.item_price).toBe(1200);
    expect(preview.platform_fee).toBe(60);
    expect(preview.total_cost).toBe(1260);
    expect(preview.seller_amount).toBe(1200);
    expect(preview.dev_amount).toBe(60);
  });

  test('preview listings cannot collect payment or create trades', async ({ request }) => {
    const buyer = await registerAccount(request, 'ReferenceBuyer');
    const buyerToken = await loginToken(request, buyer.email, buyer.password);
    const preview = await request.post('/api/trades/preview', {
      data: { listing_id: 'demo-web-research' },
    });
    expect(preview.status()).toBe(409);
    expect((await preview.json()).code).toBe('DEMO_LISTING');

    const response = await request.post('/api/trades', {
      headers: { Authorization: `Bearer ${buyerToken}`, 'Content-Type': 'application/json' },
      data: { listing_id: 'demo-web-research', amount: 1 },
    });
    expect(response.status()).toBe(409);
    expect((await response.json()).code).toBe('DEMO_LISTING');
  });

  test('complete service journey: fund, deliver, release, and rate', async ({ request }) => {
    const seller = await registerAccount(request, 'JourneySeller');
    const buyer = await registerAccount(request, 'JourneyBuyer');
    const sellerToken = await loginToken(request, seller.email, seller.password);
    const buyerToken = await loginToken(request, buyer.email, buyer.password);
    await fundLocalAccount(buyer.email, 100);

    const listingRes = await request.post('/api/listings', {
      headers: { Authorization: `Bearer ${sellerToken}`, 'Content-Type': 'application/json' },
      data: {
        category: 'analysis',
        title: `Golden path research ${Date.now()}`,
        description: 'A focused research delivery used to verify the complete marketplace transaction journey.',
        price_bankr: 20,
      },
    });
    expect(listingRes.status()).toBe(201);
    const listing = (await listingRes.json()).listing;

    const tradeRes = await request.post('/api/trades', {
      headers: { Authorization: `Bearer ${buyerToken}`, 'Content-Type': 'application/json' },
      data: { listing_id: listing.id, amount: 1, payment_rail: 'ledger' },
    });
    expect(tradeRes.status()).toBe(201);
    const trade = (await tradeRes.json()).trade;
    expect(trade.status).toBe('escrow_held');

    const deliveryRes = await request.post('/api/messages', {
      headers: { Authorization: `Bearer ${sellerToken}`, 'Content-Type': 'application/json' },
      data: {
        receiver_id: buyer.userId,
        content: JSON.stringify({
          type: 'task_complete',
          trade_id: trade.id,
          summary: 'The requested report is complete and ready for buyer review.',
          delivery_url: 'https://example.com/deliverables/report',
        }),
      },
    });
    expect(deliveryRes.status()).toBe(201);

    const reviewListRes = await request.get('/api/trades', {
      headers: { Authorization: `Bearer ${buyerToken}` },
    });
    expect(reviewListRes.ok()).toBeTruthy();
    const reviewTrade = (await reviewListRes.json()).trades.find((item: any) => item.id === trade.id);
    expect(reviewTrade.status).toBe('pending_release');
    expect(Boolean(reviewTrade.rated_by_caller)).toBeFalsy();

    const confirmRes = await request.post(`/api/trades/${trade.id}/confirm`, {
      headers: { Authorization: `Bearer ${buyerToken}`, 'Content-Type': 'application/json' },
      data: {},
    });
    expect(confirmRes.ok()).toBeTruthy();
    expect((await confirmRes.json()).status).toBe('completed');

    const ratingRes = await request.post('/api/ratings', {
      headers: { Authorization: `Bearer ${buyerToken}`, 'Content-Type': 'application/json' },
      data: { trade_id: trade.id, score: 5, comment: 'Clear delivery and a smooth transaction.' },
    });
    expect(ratingRes.status()).toBe(201);

    const completedListRes = await request.get('/api/trades', {
      headers: { Authorization: `Bearer ${buyerToken}` },
    });
    const completedTrade = (await completedListRes.json()).trades.find((item: any) => item.id === trade.id);
    expect(completedTrade.status).toBe('completed');
    expect(Boolean(completedTrade.rated_by_caller)).toBeTruthy();

    const sellerRatingsRes = await request.get('/api/ratings', {
      headers: { Authorization: `Bearer ${sellerToken}` },
    });
    expect(sellerRatingsRes.ok()).toBeTruthy();
    expect((await sellerRatingsRes.json()).ratings.some((rating: any) => rating.trade_id === trade.id && rating.score === 5)).toBeTruthy();
  });

  test('dashboard guides seller delivery and buyer release through the browser', async ({ page }) => {
    const seller = await registerAccount(page.request, 'BrowserSeller');
    const buyer = await registerAccount(page.request, 'BrowserBuyer');
    const sellerToken = await loginToken(page.request, seller.email, seller.password);
    const buyerToken = await loginToken(page.request, buyer.email, buyer.password);
    await fundLocalAccount(buyer.email, 100);

    const listingRes = await page.request.post('/api/listings', {
      headers: { Authorization: `Bearer ${sellerToken}`, 'Content-Type': 'application/json' },
      data: {
        category: 'code',
        title: `Browser journey review ${Date.now()}`,
        description: 'A browser-driven delivery used to verify every visible marketplace action.',
        price_bankr: 15,
      },
    });
    expect(listingRes.status()).toBe(201);
    const listing = (await listingRes.json()).listing;

    const tradeRes = await page.request.post('/api/trades', {
      headers: { Authorization: `Bearer ${buyerToken}`, 'Content-Type': 'application/json' },
      data: { listing_id: listing.id, amount: 1, payment_rail: 'ledger' },
    });
    expect(tradeRes.status()).toBe(201);
    const trade = (await tradeRes.json()).trade;

    const sellerLogin = await page.request.post('/api/auth/login', {
      headers: { 'x-forwarded-for': `2001:db8:${(Date.now() % 65536).toString(16)}::51` },
      data: { email: seller.email, password: seller.password },
    });
    expect(sellerLogin.ok()).toBeTruthy();

    await page.goto(`/dashboard?tab=trades&trade=${trade.id}`);
    const focusedTrade = page.locator(`#trade-${trade.id}`);
    await expect(focusedTrade.getByRole('button', { name: 'Submit delivery' })).toBeVisible();
    await focusedTrade.getByRole('button', { name: 'Submit delivery' }).click();
    await page.getByLabel('Delivery summary').fill('Completed the requested browser journey review with reproducible findings.');
    await page.getByLabel('Deliverable link').fill('https://example.com/deliverables/browser-review');
    await page.getByRole('button', { name: 'Submit for buyer review' }).click();
    await expect(focusedTrade.getByText('The buyer is reviewing your delivery.')).toBeVisible();

    const buyerLogin = await page.request.post('/api/auth/login', {
      headers: { 'x-forwarded-for': `2001:db8:${(Date.now() % 65536).toString(16)}::52` },
      data: { email: buyer.email, password: buyer.password },
    });
    expect(buyerLogin.ok()).toBeTruthy();

    await page.goto(`/dashboard?tab=trades&trade=${trade.id}`);
    const buyerTrade = page.locator(`#trade-${trade.id}`);
    page.once('dialog', (dialog) => dialog.accept());
    await buyerTrade.getByRole('button', { name: 'Release escrow' }).click();
    await expect(page.getByRole('heading', { name: 'Rate this Agent' })).toBeVisible();
    await page.getByRole('button', { name: 'Rate 5 stars' }).click();
    await page.getByPlaceholder('How did the trade go?').fill('The full browser journey worked as expected.');
    await page.getByRole('button', { name: 'Submit Review' }).click();
    await expect(buyerTrade.getByText('Review submitted')).toBeVisible();
  });

  test('explicit contract funding and milestone release lifecycle', async ({ request }) => {
    const seller = await registerAccount(request, 'ContractSeller');
    const buyer = await registerAccount(request, 'ContractBuyer');
    const sellerToken = await loginToken(request, seller.email, seller.password);
    const buyerToken = await loginToken(request, buyer.email, buyer.password);
    await fundLocalAccount(buyer.email, 1_000);

    const listingTitle = `PW Contract Listing ${Date.now()}`;

    const listingRes = await request.post('/api/listings', {
      headers: {
        Authorization: `Bearer ${sellerToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        category: 'skills',
        title: listingTitle,
        description: 'Listing to validate the explicit contract and milestone lifecycle.',
        price_bankr: 100,
      },
    });

    expect(listingRes.status()).toBe(201);
    const listingBody = await listingRes.json();
    const listingId = listingBody.listing?.id;
    expect(listingId).toBeTruthy();

    const contractRes = await request.post('/api/contracts', {
      headers: {
        Authorization: `Bearer ${buyerToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        listing_id: listingId,
        milestones: [{
          title: 'Deliver the service',
          amount: 100,
          acceptance_spec: { required_artifacts: ['delivery_summary'] },
        }],
      },
    });
    expect(contractRes.status()).toBe(201);
    const created = await contractRes.json();
    const contract = created.contract;
    expect(contract?.id).toBeTruthy();

    const fundRes = await request.patch(`/api/contracts/${contract.id}`, {
      headers: { Authorization: `Bearer ${buyerToken}`, 'Content-Type': 'application/json' },
      data: { action: 'fund' },
    });
    expect(fundRes.ok()).toBeTruthy();

    const startRes = await request.patch(`/api/contracts/${contract.id}`, {
      headers: { Authorization: `Bearer ${sellerToken}`, 'Content-Type': 'application/json' },
      data: { action: 'start' },
    });
    expect(startRes.ok()).toBeTruthy();

    const detailRes = await request.get(`/api/contracts/${contract.id}`, {
      headers: { Authorization: `Bearer ${buyerToken}` },
    });
    expect(detailRes.ok()).toBeTruthy();
    const detailJson = await detailRes.json();
    const milestone = detailJson.milestones?.[0];
    expect(milestone?.id).toBeTruthy();

    const submitRes = await request.patch(`/api/contracts/${contract.id}/milestones/${milestone.id}`, {
      headers: {
        Authorization: `Bearer ${sellerToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        action: 'submit',
        artifact_bundle: { delivery_summary: 'done' },
      },
    });
    expect(submitRes.ok()).toBeTruthy();

    const approveRes = await request.patch(`/api/contracts/${contract.id}/milestones/${milestone.id}`, {
      headers: {
        Authorization: `Bearer ${buyerToken}`,
        'Content-Type': 'application/json',
      },
      data: { action: 'approve' },
    });
    expect(approveRes.ok()).toBeTruthy();

    const payRes = await request.patch(`/api/contracts/${contract.id}/milestones/${milestone.id}`, {
      headers: {
        Authorization: `Bearer ${buyerToken}`,
        'Content-Type': 'application/json',
      },
      data: { action: 'mark_paid' },
    });
    expect(payRes.ok()).toBeTruthy();
    const payJson = await payRes.json();
    expect(payJson.contract?.state).toBe('COMPLETED');
  });
});
