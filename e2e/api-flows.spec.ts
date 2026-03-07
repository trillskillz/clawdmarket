import { test, expect } from '@playwright/test';

async function loginToken(request: any, email: string, password: string) {
  const res = await request.post('/api/auth/login', { data: { email, password } });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body?.token).toBeTruthy();
  return body.token as string;
}

test.describe('API lifecycle matrix', () => {
  test('api key lifecycle (create + list + revoke)', async ({ request }) => {
    const token = await loginToken(request, 'jacob@example.com', 'password123');

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
    const sellerToken = await loginToken(request, 'jacob@example.com', 'password123');

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

  test('contracts lifecycle via trade auto-create', async ({ request }) => {
    const sellerToken = await loginToken(request, 'jacob@example.com', 'password123');
    const buyerToken = await loginToken(request, 'maya@startup.io', 'password123');

    const listingTitle = `PW Contract Listing ${Date.now()}`;

    const listingRes = await request.post('/api/listings', {
      headers: {
        Authorization: `Bearer ${sellerToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        category: 'skills',
        title: listingTitle,
        description: 'Listing to validate auto contract + milestone lifecycle.',
        price_bankr: 100,
      },
    });

    expect(listingRes.status()).toBe(201);
    const listingBody = await listingRes.json();
    const listingId = listingBody.listing?.id;
    expect(listingId).toBeTruthy();

    const tradeRes = await request.post('/api/trades', {
      headers: {
        Authorization: `Bearer ${buyerToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        listing_id: listingId,
        amount: 1,
      },
    });

    expect(tradeRes.status()).toBe(201);

    const contractsRes = await request.get('/api/contracts', {
      headers: { Authorization: `Bearer ${buyerToken}` },
    });
    expect(contractsRes.ok()).toBeTruthy();
    const contractsJson = await contractsRes.json();
    const contract = (contractsJson.contracts || []).find((c: any) => c.listing_id === listingId);
    expect(contract?.id).toBeTruthy();

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
