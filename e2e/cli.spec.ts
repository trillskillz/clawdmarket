import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

function runCli(args: string[], homeDir: string, input?: string) {
  const output = execFileSync('node', ['sdk/dist/cli.js', ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOME: homeDir,
      CLAWD_BASE_URL: 'http://localhost:3000/api',
      FORCE_COLOR: '0',
    },
    input,
    encoding: 'utf8',
  });
  return output;
}

test.describe('CLI smoke', () => {
  test('non-interactive login and core commands work', async () => {
    execFileSync('npm', ['run', 'build'], {
      cwd: path.join(process.cwd(), 'sdk'),
      stdio: 'pipe',
      env: { ...process.env, FORCE_COLOR: '0' },
    });

    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawd-cli-'));

    const loginOut = runCli(['auth', 'login', '--email', 'jacob@example.com', '--password', 'password123'], homeDir);
    expect(loginOut).toContain('Logged in as');

    const statusOut = runCli(['auth', 'status'], homeDir);
    expect(statusOut).toContain('Logged in as');

    const apiKeyListOut = runCli(['auth', 'api-keys', 'list'], homeDir);
    expect(
      apiKeyListOut.includes('Your API Keys') || apiKeyListOut.includes('No API keys found.')
    ).toBeTruthy();

    const tradesOut = runCli(['trades', 'list'], homeDir);
    expect(
      tradesOut.includes('Your Trades') || tradesOut.includes('No trades found.')
    ).toBeTruthy();
  });

  test('api-key create/revoke/rotate command chain works', async () => {
    execFileSync('npm', ['run', 'build'], {
      cwd: path.join(process.cwd(), 'sdk'),
      stdio: 'pipe',
      env: { ...process.env, FORCE_COLOR: '0' },
    });

    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawd-cli-'));

    runCli(['auth', 'login', '--email', 'jacob@example.com', '--password', 'password123'], homeDir);

    const createOut = runCli(['auth', 'api-keys', 'create', `PW Create ${Date.now()}`], homeDir);
    expect(createOut).toContain('API key created successfully');
    const createdId = createOut.match(/ID:\s*([0-9a-fA-F-]{36})/)?.[1];
    expect(createdId).toBeTruthy();

    const revokeOut = runCli(['auth', 'api-keys', 'revoke', createdId!], homeDir, 'y\n');
    expect(revokeOut).toContain('API key revoked');

    const createOut2 = runCli(['auth', 'api-keys', 'create', `PW Rotate ${Date.now()}`], homeDir);
    const rotateTargetId = createOut2.match(/ID:\s*([0-9a-fA-F-]{36})/)?.[1];
    expect(rotateTargetId).toBeTruthy();

    const rotateOut = runCli(['auth', 'api-keys', 'rotate', rotateTargetId!, `PW Rotated ${Date.now()}`], homeDir, 'y\n');
    expect(rotateOut).toContain('API key rotated successfully');
    expect(rotateOut).toContain('Revoked key ID');
  });
});
