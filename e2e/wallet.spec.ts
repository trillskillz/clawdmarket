import { test, expect } from '@playwright/test';
import { privateKeyToAccount } from 'viem/accounts';

test.describe('Wallet auth flow', () => {
  test('nonce + signature verify logs user in', async ({ page }) => {
    const account = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945387d9f71b4ddf4f5f0f8f0ce5f5ef5b9d25');

    const nonceRes = await page.request.post('/api/auth/wallet/nonce');
    expect(nonceRes.ok()).toBeTruthy();
    const nonceBody = await nonceRes.json();

    const message = String(nonceBody.message);
    const nonce = String(nonceBody.nonce);
    expect(message).toContain('Sign in to ClawdMarket');
    expect(nonce.length).toBeGreaterThan(7);

    const signature = await account.signMessage({ message });

    const verifyRes = await page.request.post('/api/auth/wallet/verify', {
      data: {
        address: account.address,
        signature,
        nonce,
      },
    });
    expect(verifyRes.ok()).toBeTruthy();

    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });
});
