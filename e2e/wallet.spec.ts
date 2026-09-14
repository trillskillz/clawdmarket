import { test, expect } from '@playwright/test';
import { privateKeyToAccount } from 'viem/accounts';

const walletPrivateKey = '0x59c6995e998f97a5a0044966f0945387d9f71b4ddf4f5f0f8f0ce5f5ef5b9d25';

test.describe('Wallet auth flow', () => {
  test('nonce + signature verify logs user in', async ({ page }) => {
    const account = privateKeyToAccount(walletPrivateKey);

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

  test('discovered browser wallet signs in through the login page', async ({ page, context }) => {
    const account = privateKeyToAccount(walletPrivateKey);
    const nonce = '0123456789abcdef0123456789abcdef';
    const message = `Sign in to ClawdMarket\nNonce: ${nonce}`;
    const signature = await account.signMessage({ message });

    await context.addCookies([{
      name: 'wallet-nonce',
      value: nonce,
      url: 'http://localhost:3000',
      httpOnly: true,
      sameSite: 'Strict',
    }]);

    await page.addInitScript(({ address, signature: walletSignature }) => {
      let connected = false;
      const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
      const provider = {
        request: async ({ method }: { method: string }) => {
          if (method === 'wallet_requestPermissions') {
            connected = true;
            return [{ caveats: [{ value: [address] }] }];
          }
          if (method === 'eth_requestAccounts') {
            connected = true;
            return [address];
          }
          if (method === 'eth_accounts') return connected ? [address] : [];
          if (method === 'eth_chainId') return '0x1';
          if (method === 'personal_sign') return walletSignature;
          if (method === 'wallet_revokePermissions') {
            connected = false;
            return null;
          }
          throw new Error(`Unsupported test wallet method: ${method}`);
        },
        on(event: string, handler: (...args: unknown[]) => void) {
          const handlers = listeners.get(event) || new Set();
          handlers.add(handler);
          listeners.set(event, handlers);
        },
        removeListener(event: string, handler: (...args: unknown[]) => void) {
          listeners.get(event)?.delete(handler);
        },
      };

      const detail = {
        info: {
          icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
          name: 'Rabby',
          rdns: 'io.rabby',
          uuid: '350670db-19fa-4704-a166-e52e178b59d2',
        },
        provider,
      };

      window.addEventListener('eip6963:requestProvider', () => {
        window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail }));
      });
    }, { address: account.address, signature });

    await page.route('**/api/auth/wallet/nonce', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ nonce, message }),
      });
    });

    await page.goto('/auth/login');
    await expect(page.getByRole('link', { name: /Establish an identity/i })).toHaveCount(0);
    await page.getByRole('button', { name: /Use a signed wallet/i }).click();
    await expect(page).toHaveURL(/\/auth\/login$/);

    await page.getByRole('button', { name: 'Connect Rabby' }).click();
    await expect(page.getByRole('heading', { name: 'Wallet connected.' })).toBeVisible();
    await page.getByRole('button', { name: /Sign message & enter/i }).click();

    await expect(page).toHaveURL(/\/dashboard$/);
    const meResponse = await page.request.get('/api/auth/me');
    expect(meResponse.ok()).toBeTruthy();
    const me = await meResponse.json();
    expect(me.authenticated).toBe(true);
    expect(me.user.wallet).toBe(account.address.toLowerCase());
  });
});
