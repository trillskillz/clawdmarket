import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
import { privateKeyToAccount } from 'viem/accounts';

// Public dummy fixtures for readiness/approval tests. The RPC cannot send transactions.
const fixtureSigner = `0x${'99'.repeat(32)}` as const;

const localChromium = process.platform === 'linux' && existsSync('/usr/bin/chromium')
  ? '/usr/bin/chromium'
  : undefined;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || localChromium
          ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || localChromium }
          : undefined,
      },
    },
  ],
  webServer: {
    command: 'pnpm start',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
    env: {
      JWT_SECRET: process.env.JWT_SECRET || 'clawdmarket-playwright-jwt-secret',
      AGENT_API_KEY_PEPPER: process.env.AGENT_API_KEY_PEPPER || 'clawdmarket-playwright-agent-pepper',
      CHAT_ENCRYPTION_KEY: process.env.CHAT_ENCRYPTION_KEY || 'clawdmarket-playwright-chat-secret',
      WEBHOOK_SECRET_KEY: process.env.WEBHOOK_SECRET_KEY || 'clawdmarket-playwright-webhook-secret',
      TREASURY_ADDRESS: process.env.TREASURY_ADDRESS || privateKeyToAccount(fixtureSigner).address,
      EVM_SETTLEMENT_PRIVATE_KEY: process.env.EVM_SETTLEMENT_PRIVATE_KEY || fixtureSigner,
      EVM_ACCEPTED_TOKENS: process.env.EVM_ACCEPTED_TOKENS || JSON.stringify([{ chainId: 8453, chainName: 'Test Base',
        address: `0x${'44'.repeat(20)}`, symbol: 'USDC', decimals: 6, fixedUsdPrice: 1, confirmations: 3, rpcUrl: 'https://rpc.example.invalid' },{chainId:1,chainName:'Test Ethereum L1',address:`0x${'45'.repeat(20)}`,symbol:'USDC',decimals:6,fixedUsdPrice:1,confirmations:1,rpcUrl:'https://rpc.example.invalid'}]),
      MPP_SECRET_KEY_CURRENT: process.env.MPP_SECRET_KEY_CURRENT || 'clawdmarket-playwright-mpp-test-secret',
      MPP_RECIPIENT_ADDRESS: process.env.MPP_RECIPIENT_ADDRESS || privateKeyToAccount(fixtureSigner).address,
      TEMPO_RPC_URL: process.env.TEMPO_RPC_URL || 'https://rpc.example.invalid',
      ADMIN_USER_IDS: process.env.ADMIN_USER_IDS || 'benchmark-browser-admin',
      CLAWDMARKET_BENCHMARK_GRADER_IDS: process.env.CLAWDMARKET_BENCHMARK_GRADER_IDS || 'trusted-benchmark-browser-grader',
      CLAWDMARKET_REUSABLE_SERVICES_ENABLED: 'true',
      CLAWDMARKET_ENTERPRISE_FOUNDATION_ENABLED: 'true',
      CLAWDMARKET_ROUTE_PLANNING_ENABLED: 'true',
      CLAWDMARKET_ROUTE_EXECUTION_ENABLED: 'true',
      CLAWDMARKET_WORKFLOW_PLANNING_ENABLED: 'true',
      CLAWDMARKET_WORKFLOW_EXECUTION_ENABLED: 'true',
      CLAWDMARKET_A2A_ROUTING_WRITES_ENABLED: 'true',
      CLAWDMARKET_MCP_ROUTING_WRITES_ENABLED: 'true',
    },
  },
});
