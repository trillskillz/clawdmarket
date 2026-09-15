import { test, expect } from '@playwright/test';
import { privateKeyToAccount } from 'viem/accounts';

const walletPrivateKey = '0x59c6995e998f97a5a0044966f0945387d9f71b4ddf4f5f0f8f0ce5f5ef5b9d25';

test.describe('Wallet auth flow', () => {
  test('nonce + signature verify logs user in', async ({ page }) => {
    const account = privateKeyToAccount(walletPrivateKey);

    const nonceRes = await page.request.post('/api/auth/wallet/nonce', {
      data: { address: account.address, chainId: 1 },
    });
    expect(nonceRes.ok()).toBeTruthy();
    const nonceBody = await nonceRes.json();

    const message = String(nonceBody.message);
    const nonce = String(nonceBody.nonce);
    expect(message).toContain('http://localhost:3000 wants you to sign in with your Ethereum account:');
    expect(message).toContain('URI: http://localhost:3000/auth/login');
    expect(message).toContain('Chain ID: 1');
    expect(message).toContain('Expiration Time:');
    expect(nonce.length).toBeGreaterThan(7);

    const signature = await account.signMessage({ message });
    const verification = {
      data: {
        address: account.address,
        signature,
        nonce,
      },
    };
    const [firstVerify, concurrentReplay] = await Promise.all([
      page.request.post('/api/auth/wallet/verify', verification),
      page.request.post('/api/auth/wallet/verify', verification),
    ]);
    expect([firstVerify.status(), concurrentReplay.status()].sort()).toEqual([200, 401]);

    const laterReplay = await page.request.post('/api/auth/wallet/verify', verification);
    expect(laterReplay.status()).toBe(401);

    const csrfBypassAttempt = await page.request.post('/api/messages', {
      headers: { Authorization: 'Bearer intentionally-invalid' },
      data: {},
    });
    expect(csrfBypassAttempt.status()).toBe(403);

    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });

  test('discovered browser wallet signs in through the login page', async ({ page }) => {
    const account = privateKeyToAccount(walletPrivateKey);
    const challengeResponse = await page.request.post('/api/auth/wallet/nonce', {
      data: { address: account.address, chainId: 1 },
    });
    expect(challengeResponse.ok()).toBeTruthy();
    const challenge = await challengeResponse.json();
    const message = String(challenge.message);
    const signature = await account.signMessage({ message });

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
        body: JSON.stringify(challenge),
      });
    });

    await page.goto('/auth/login?next=%2Fdocs#wallet');
    await expect(page.getByRole('link', { name: /Establish an identity/i })).toHaveCount(0);
    await page.getByRole('button', { name: /Use a signed wallet/i }).click();
    await expect(page).toHaveURL(/\/auth\/login\?next=%2Fdocs#wallet$/);

    await page.getByRole('button', { name: 'Connect Rabby' }).click();
    await expect(page.getByRole('heading', { name: 'Wallet connected.' })).toBeVisible();
    await page.getByRole('button', { name: /Sign message & enter/i }).click();

    await expect(page).toHaveURL(/\/docs$/);
    const meResponse = await page.request.get('/api/auth/me');
    expect(meResponse.ok()).toBeTruthy();
    const me = await meResponse.json();
    expect(me.authenticated).toBe(true);
    expect(me.user.wallet).toBe(account.address.toLowerCase());
  });

  test('MetaMask prefers its EIP-6963 provider over a conflicting legacy provider', async ({ page }) => {
    const account = privateKeyToAccount(walletPrivateKey);
    const challengeResponse = await page.request.post('/api/auth/wallet/nonce', {
      data: { address: account.address, chainId: 1 },
    });
    expect(challengeResponse.ok()).toBeTruthy();
    const challenge = await challengeResponse.json();
    const message = String(challenge.message);
    const signature = await account.signMessage({ message });

    await page.addInitScript(({ address, signature: walletSignature }) => {
      const legacyProvider = {
        isMetaMask: true,
        _events: {},
        _state: {},
        request: async ({ method }: { method: string }) => {
          if (method === 'eth_accounts') return [];
          if (method === 'eth_chainId') return '0x1';
          throw new Error('Wrong legacy MetaMask provider selected');
        },
        on() {},
        removeListener() {},
      };
      Object.defineProperty(window, 'ethereum', { value: legacyProvider, configurable: true });

      let connected = false;
      const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
      const discoveredProvider = {
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
          throw new Error(`Unsupported MetaMask test method: ${method}`);
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
          name: 'MetaMask',
          rdns: 'io.metamask',
          uuid: '73b80911-cb39-4d68-818c-17cc6ff93d6b',
        },
        provider: discoveredProvider,
      };
      window.addEventListener('eip6963:requestProvider', () => {
        window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail }));
      });
    }, { address: account.address, signature });

    await page.route('**/api/auth/wallet/nonce', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(challenge),
      });
    });

    await page.goto('/auth/login#wallet');
    await expect(page.getByRole('button', { name: 'Connect MetaMask' })).toHaveCount(1);
    await page.getByRole('button', { name: 'Connect MetaMask' }).click();
    await expect(page.getByRole('heading', { name: 'Wallet connected.' })).toBeVisible();
    await page.getByRole('button', { name: /Sign message & enter/i }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  });
});
