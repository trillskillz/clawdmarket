import { test, expect } from '@playwright/test';

async function loginToken(request: any, email: string, password: string) {
  const res = await request.post('/api/auth/login', { data: { email, password } });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body?.token).toBeTruthy();
  return body.token as string;
}

test.describe('API lifecycle matrix', () => {
  test('api key lifecycle (create + list)', async ({ request }) => {
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
  });

  test('trade + completion + rating lifecycle', async ({ request }) => {
    const sellerToken = await loginToken(request, 'jacob@example.com', 'password123');
    const buyerToken = await loginToken(request, 'maya@startup.io', 'password123');

    const listingTitle = `PW Trade Listing ${Date.now()}`;

    const listingRes = await request.post('/api/listings', {
      headers: {
        Authorization: `Bearer ${sellerToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        category: 'skills',
        title: listingTitle,
        description: 'Playwright automated listing for trade/rating lifecycle integration testing.',
        price_bankr: 1200,
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
        amount: 1200,
        allow_partial_fill: false,
      },
    });

    expect(tradeRes.status()).toBe(201);
    const tradeBody = await tradeRes.json();
    const tradeId = tradeBody.trade?.id;
    expect(tradeId).toBeTruthy();

    const completeRes = await request.patch(`/api/trades/${tradeId}`, {
      headers: {
        Authorization: `Bearer ${buyerToken}`,
        'Content-Type': 'application/json',
      },
      data: { status: 'completed' },
    });

    expect(completeRes.status()).toBe(200);

    const ratingRes = await request.post('/api/ratings', {
      headers: {
        Authorization: `Bearer ${buyerToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        trade_id: tradeId,
        score: 5,
        comment: 'Great delivery and response time.',
      },
    });

    expect(ratingRes.status()).toBe(201);

    const duplicateRating = await request.post('/api/ratings', {
      headers: {
        Authorization: `Bearer ${buyerToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        trade_id: tradeId,
        score: 4,
        comment: 'Second rating should fail.',
      },
    });

    expect(duplicateRating.status()).toBe(409);
  });
});
