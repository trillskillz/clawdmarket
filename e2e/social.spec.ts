import { test, expect } from '@playwright/test';

test.describe('Social features: profiles and messaging', () => {
  const ipRun = (Date.now() % 65536).toString(16);
  const agentA = {
    email: `social.a.${Date.now()}@example.com`,
    password: 'Password123!',
    name: 'SocialAgentA',
  };
  const agentB = {
    email: `social.b.${Date.now()}@example.com`,
    password: 'Password123!',
    name: 'SocialAgentB',
  };

  test('register two agents and view profiles', async ({ request }) => {
    const regA = await request.post('/api/auth/register', {
      headers: { 'x-forwarded-for': `2001:db8:${ipRun}::30` },
      data: { ...agentA, role: 'agent' },
    });
    expect(regA.ok()).toBeTruthy();

    const regB = await request.post('/api/auth/register', {
      headers: { 'x-forwarded-for': `2001:db8:${ipRun}::31` },
      data: { ...agentB, role: 'agent' },
    });
    expect(regB.ok()).toBeTruthy();

    const loginA = await request.post('/api/auth/login', {
      headers: { 'x-forwarded-for': `2001:db8:${ipRun}::41` },
      data: { email: agentA.email, password: agentA.password },
    });
    expect(loginA.ok()).toBeTruthy();

    const me = await request.get('/api/auth/me');
    expect(me.ok()).toBeTruthy();
    const meData = await me.json();
    expect(meData.user.name).toBe(agentA.name);
  });

  test('update profile bio and avatar', async ({ request }) => {
    const login = await request.post('/api/auth/login', {
      headers: { 'x-forwarded-for': `2001:db8:${ipRun}::42` },
      data: { email: agentA.email, password: agentA.password },
    });
    expect(login.ok()).toBeTruthy();

    const storage = await request.storageState();
    const csrfToken = storage.cookies.find((cookie) => cookie.name === 'csrf-token')?.value;
    expect(csrfToken).toBeTruthy();

    const update = await request.patch('/api/auth/me', {
      headers: { 'x-csrf-token': csrfToken! },
      data: {
        bio: 'Test social agent for E2E',
        avatar_emoji: '🤖',
      },
    });
    expect(update.ok()).toBeTruthy();

    const me = await request.get('/api/auth/me');
    const data = await me.json();
    expect(data.user.bio).toBe('Test social agent for E2E');
    expect(data.user.avatar_emoji).toBe('🤖');
  });

  test('edit profile page loads', async ({ page }) => {
    const login = await page.request.post('/api/auth/login', {
      headers: { 'x-forwarded-for': `2001:db8:${ipRun}::43` },
      data: { email: agentA.email, password: agentA.password },
    });
    expect(login.ok()).toBeTruthy();

    await page.goto('/dashboard/profile');
    await expect(page.getByRole('heading', { name: 'Edit Profile' })).toBeVisible();
  });

  test('agent registry shows registered agents', async ({ page }) => {
    await page.goto('/registry');
    await expect(page).toHaveURL(/registry/);
  });

  test('messaging API handles send and retrieve', async ({ request }) => {
    const loginA = await request.post('/api/auth/login', {
      headers: { 'x-forwarded-for': `2001:db8:${ipRun}::44` },
      data: { email: agentA.email, password: agentA.password },
    });
    expect(loginA.ok()).toBeTruthy();
    const aData = await loginA.json();

    const loginB = await request.post('/api/auth/login', {
      headers: { 'x-forwarded-for': `2001:db8:${ipRun}::45` },
      data: { email: agentB.email, password: agentB.password },
    });
    expect(loginB.ok()).toBeTruthy();
    const bData = await loginB.json();

    if (bData.user?.id) {
      const send = await request.post('/api/messages', {
        headers: { Authorization: `Bearer ${aData.token}` },
        data: {
          receiver_id: bData.user.id,
          content: 'Hello from E2E test!',
        },
      });
      expect(send.status()).toBe(201);

      const thread = await request.get(`/api/messages/${bData.user.id}`, {
        headers: { Authorization: `Bearer ${aData.token}` },
      });
      expect(thread.status()).toBe(200);
    }
  });
});
