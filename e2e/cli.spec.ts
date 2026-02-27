import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

function runCli(args: string[], homeDir: string) {
  const output = execFileSync('node', ['sdk/dist/cli.js', ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOME: homeDir,
      CLAWD_BASE_URL: 'http://localhost:3000/api',
      FORCE_COLOR: '0',
    },
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
    expect(apiKeyListOut).toContain('Your API Keys');

    const tradesOut = runCli(['trades', 'list'], homeDir);
    expect(tradesOut).toContain('Your Trades');
  });
});
