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
});
