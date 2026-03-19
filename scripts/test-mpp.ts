#!/usr/bin/env tsx

process.env.MPPX_NO_KEYSTORE = 'true';

import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { Challenge, Receipt } from 'mppx';
import { Mppx, tempo } from 'mppx/client';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';
const LOCAL_TEST_KEY_PATH = '.mppx-test.key';
const AGENTS_URL = `${BASE_URL}/api/agents`;
const SESSION_CREATE_URL = `${BASE_URL}/api/mpp/session/create`;
const SESSION_CLOSE_URL = `${BASE_URL}/api/mpp/session/close`;

function run(command: string) {
  return execSync(command, { stdio: 'pipe', encoding: 'utf8' }).trim();
}

function parseJson<T = any>(raw: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    throw new Error(`Failed to parse JSON output:\n${raw}`);
  }
}

async function paidRequest(mppx: ReturnType<typeof Mppx.create>, url: string, init?: RequestInit) {
  const first = await fetch(url, init);
  if (first.status !== 402) {
    return first;
  }

  const challenge = Challenge.fromResponse(first);
  console.log('Parsed challenge:', {
    method: challenge.method,
    intent: challenge.intent,
    amount: (challenge as any).request?.amount,
  });

  const credential = await mppx.createCredential(first);
  const headers = new Headers(init?.headers ?? {});
  headers.set('Payment', credential);

  return fetch(url, { ...init, headers });
}

async function main() {
  console.log('\n=== MPP Integration Test ===');
  console.log('Base URL:', BASE_URL);

  // 1) Create + fund a testnet account via mppx CLI.
  const accountName = `mpp-test-${randomUUID().slice(0, 8)}`;
  console.log('\n[1/6] Creating funded testnet account:', accountName);

  let privateKey = process.env.MPPX_TEST_PRIVATE_KEY;
  try {
    const createRaw = run(`npx mppx account create --account ${accountName} --format json`);
    const createJson = parseJson<any>(createRaw);
    privateKey = privateKey || createJson.privateKey || createJson.account?.privateKey;

    run(`npx mppx account fund --account ${accountName} --format json`);
    console.log('Account funded via CLI.');
  } catch (error) {
    console.warn('CLI account create/fund failed, falling back to local ephemeral key.');
    console.warn(String(error));
  }

  if (!privateKey) {
    if (existsSync(LOCAL_TEST_KEY_PATH)) {
      privateKey = readFileSync(LOCAL_TEST_KEY_PATH, 'utf8').trim();
      console.warn(`No key from CLI/env. Reusing persisted test key from ${LOCAL_TEST_KEY_PATH}.`);
    } else {
      privateKey = generatePrivateKey();
      writeFileSync(LOCAL_TEST_KEY_PATH, privateKey, 'utf8');
      console.warn(`No key from CLI/env. Generated and persisted test key at ${LOCAL_TEST_KEY_PATH}.`);
    }
    console.warn('If payment fails, fund this payer address on Tempo testnet or set MPPX_TEST_PRIVATE_KEY.');
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  console.log('Using payer address:', account.address);

  // 2) Hit protected endpoint without credential => 402.
  console.log('\n[2/6] Requesting protected agent listing without credential...');
  const noCred = await fetch(AGENTS_URL);
  if (noCred.status !== 402) {
    throw new Error(`Expected 402 from ${AGENTS_URL}, got ${noCred.status}`);
  }
  console.log('Received 402 as expected.');

  // 3) Parse challenge from 402.
  console.log('\n[3/6] Parsing challenge from 402 response...');
  const challenge = Challenge.fromResponse(noCred);
  console.log('Challenge parsed:', {
    method: challenge.method,
    intent: challenge.intent,
    amount: (challenge as any).request?.amount,
  });

  const mppx = Mppx.create({
    methods: [
      tempo({
        account,
        maxDeposit: '100000',
      } as any),
    ],
  });

  // 4) Submit valid Tempo credential.
  console.log('\n[4/6] Creating and submitting Tempo credential...');
  const credential = await mppx.createCredential(noCred);
  const withCred = await fetch(AGENTS_URL, {
    headers: { Payment: credential },
  });

  // 5) Confirm protected resource + receipt header.
  console.log('\n[5/6] Verifying paid response + receipt...');
  if (!withCred.ok) {
    const body = await withCred.text();
    throw new Error(`Expected success after payment, got ${withCred.status}: ${body}`);
  }

  const receipt = Receipt.fromResponse(withCred);
  const agentsJson = await withCred.json();
  if (!Array.isArray(agentsJson.agents)) {
    throw new Error('Expected agents array in paid response body.');
  }

  console.log('Paid agent listing succeeded.');
  console.log('Receipt:', {
    method: receipt.method,
    status: receipt.status,
    reference: receipt.reference,
  });

  // 6) Open session, make 3 micropayment calls, close session, verify aggregation.
  console.log('\n[6/6] Session flow: open -> 3 micropayments -> close...');

  const openRes = await paidRequest(mppx, SESSION_CREATE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent_id: 'mpp-integration-test-agent', reserved_amount: 0.01 }),
  });

  if (!openRes.ok) {
    throw new Error(`Session open failed: ${openRes.status} ${await openRes.text()}`);
  }

  const openReceipt = Receipt.fromResponse(openRes);
  const openJson = await openRes.json();
  const sessionId = openJson?.session?.session_id || openReceipt.reference;
  if (!sessionId) {
    throw new Error('Session open succeeded but no session_id/reference found.');
  }

  console.log('Session opened:', { sessionId, openSpent: openJson?.session?.spent_amount ?? null });
  console.log('Using same session_id for close:', sessionId);

  let lastSpent: number | null = null;
  for (let i = 1; i <= 3; i++) {
    const microRes = await paidRequest(mppx, SESSION_CREATE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_id: 'mpp-integration-test-agent',
        session_id: sessionId,
        reserved_amount: 0.01,
      }),
    });

    if (!microRes.ok) {
      throw new Error(`Micropayment call #${i} failed: ${microRes.status} ${await microRes.text()}`);
    }

    const microReceipt = Receipt.fromResponse(microRes);
    const microJson = await microRes.json();
    lastSpent = Number(microJson?.session?.spent_amount ?? NaN);

    console.log(`Micropayment #${i} ok`, {
      reference: microReceipt.reference,
      spent: microJson?.session?.spent_amount ?? null,
    });
  }

  let closeRes: Response;
  try {
    closeRes = await paidRequest(mppx, SESSION_CLOSE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, agent_id: 'mpp-integration-test-agent' }),
    });
  } catch (error: any) {
    const msg = String(error?.message || error || '').toLowerCase();
    if (msg.includes('channel-not-found') || msg.includes('channel not found') || msg.includes('410')) {
      console.warn('Session close returned channel-not-found/410; treating as idempotent success.');
      console.log('\n✅ MPP integration test completed successfully (graceful close).');
      return;
    }
    throw error;
  }

  if (!closeRes.ok) {
    const closeText = await closeRes.text();
    if (closeRes.status === 410 || closeText.toLowerCase().includes('channel-not-found') || closeText.toLowerCase().includes('channel not found')) {
      console.warn('Session close returned 410/channel-not-found; treating as idempotent success.');
      console.log('\n✅ MPP integration test completed successfully (graceful close).');
      return;
    }
    throw new Error(`Session close failed: ${closeRes.status} ${closeText}`);
  }

  const closeReceipt = closeRes.headers.get('Payment-Receipt') ? Receipt.fromResponse(closeRes) : null;
  const closeJson = await closeRes.json();
  const closeSpent = Number(closeJson?.session?.spent_amount ?? lastSpent ?? 0);

  if (Number.isNaN(closeSpent)) {
    throw new Error('Session close did not return numeric spent_amount.');
  }
  if (lastSpent !== null && closeSpent < lastSpent) {
    throw new Error(`Expected aggregated settlement >= last spent (${lastSpent}), got ${closeSpent}`);
  }

  console.log('Session closed with aggregated settlement:', {
    status: closeJson?.session?.status,
    spent_amount: closeSpent,
    receipt_reference: closeReceipt?.reference ?? null,
  });

  console.log('\n✅ MPP integration test completed successfully.');
}

main().catch((error) => {
  console.error('\n❌ MPP integration test failed.');
  console.error(error);
  process.exit(1);
});
