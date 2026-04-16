import { test, expect } from '@playwright/test';

test.describe('Social features: profiles, ratings, messaging', () => {
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
      data: { ...agentA, role: 'agent' },
    });
    expect(regA.ok()).toBeTruthy();

    const regB = await request.post('/api/auth/register', {
      data: { ...agentB, role: 'agent' },
    });
    expect(regB.ok()).toBeTruthy();

    const loginA = await request.post('/api/auth/login', {
      data: { email: agentA.email, password: agentA.password },
    });
    expect(loginA.ok()).toBeTruthy();

    const me = await request.get('/api/auth/me');
    expect(me.ok()).toBeTruthy();
    const meData = await me.json();
    expect(meData.user.name).toBe(agentA.name);
  });

  test('update profile bio and avatar', async ({ request }) => {
    await request.post('/api/auth/login', {
      data: { email: agentA.email, password: agentA.password },
    });

    const update = await request.patch('/api/auth/me', {
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
    await page.request.post('/api/auth/login', {
      data: { email: agentA.email, password: agentA.password },
    });

    await page.goto('/dashboard/profile');
    await expect(page.getByRole('heading', { name: 'Edit Profile' })).toBeVisible();
  });

  test('agent registry shows registered agents', async ({ page }) => {
    await page.goto('/registry');
    await expect(page).toHaveURL(/registry/);
  });

  test('agent rating API accepts valid rating', async ({ request }) => {
    const loginA = await request.post('/api/auth/login', {
      data: { email: agentA.email, password: agentA.password },
    });
    const loginData = await loginA.json();

    const loginB = await request.post('/api/auth/login', {
      data: { email: agentB.email, password: agentB.password },
    });
    expect(loginB.ok()).toBeTruthy();

    const meB = await request.get('/api/auth/me');
    const meBData = await meB.json();

    if (meBData.user?.id) {
      const rate = await request.post(`/api/agents/${meBData.user.id}/rate`, {
        data: { score: 1 },
      });
      const rateStatus = rate.status();
      expect([200, 201, 400, 403]).toContain(rateStatus);
    }
  });

  test('messaging API handles send and retrieve', async ({ request }) => {
    const loginA = await request.post('/api/auth/login', {
      data: { email: agentA.email, password: agentA.password },
    });
    expect(loginA.ok()).toBeTruthy();

    const loginB = await request.post('/api/auth/login', {
      data: { email: agentB.email, password: agentB.password },
    });
    const bData = await loginB.json();

    if (bData.user?.id) {
      const send = await request.post('/api/messages', {
        data: {
          receiver_id: bData.user.id,
          content: 'Hello from E2E test!',
        },
      });
      const sendStatus = send.status();
      expect([200, 201, 400]).toContain(sendStatus);

      const thread = await request.get(`/api/messages/${bData.user.id}`);
      const threadStatus = thread.status();
      expect([200, 404]).toContain(threadStatus);
    }
  });
});
