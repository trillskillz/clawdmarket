import test from 'node:test';
import assert from 'node:assert/strict';
import { isAddress } from 'viem';
import { BaseWalletService } from '@/src/wallet/baseWallet';

const rpc = process.env.BASE_SEPOLIA_RPC_URL;
const token = process.env.BASE_BNKR_TOKEN_ADDRESS || process.env.NEXT_PUBLIC_BANKR_TOKEN_ADDRESS;
const fundedKey = process.env.AGENT_WALLET_PRIVATE_KEY as `0x${string}` | undefined;

const canRunReadTests = Boolean(rpc && token);

if (!canRunReadTests) {
  test('base sepolia config missing, skipping wallet integration tests', { skip: true }, () => {
    assert.ok(true);
  });
} else {
  test('can instantiate base sepolia wallet service and create/import wallet', () => {
    const wallet = new BaseWalletService({
      network: 'base-sepolia',
      rpcUrl: rpc,
      bnkrTokenAddress: token as `0x${string}`,
      privateKey: fundedKey,
    });

    const generated = wallet.createAgentWallet();
    assert.equal(isAddress(generated.address), true);
    assert.equal(generated.privateKey.startsWith('0x'), true);

    if (fundedKey) {
      const imported = wallet.importAgentWallet(fundedKey);
      assert.equal(isAddress(imported.address), true);
      assert.equal(imported.privateKeyRef, 'env');
    }
  });

  test('can read BNKR balance on Base Sepolia', async () => {
    const wallet = new BaseWalletService({
      network: 'base-sepolia',
      rpcUrl: rpc,
      bnkrTokenAddress: token as `0x${string}`,
      privateKey: fundedKey,
    });

    const addressToCheck = fundedKey ? wallet.importAgentWallet(fundedKey).address : wallet.createAgentWallet().address;
    const bal = await wallet.getBNKRBalance(addressToCheck);

    assert.equal(isAddress(bal.wallet), true);
    assert.equal(isAddress(bal.token), true);
    assert.equal(typeof bal.formatted, 'string');
    assert.equal(typeof bal.decimals, 'number');
    assert.equal(typeof bal.raw, 'bigint');
  });

  test('can estimate BNKR transfer gas on Base Sepolia', async () => {
    if (!fundedKey) return test.skip('AGENT_WALLET_PRIVATE_KEY not set');

    const wallet = new BaseWalletService({
      network: 'base-sepolia',
      rpcUrl: rpc,
      bnkrTokenAddress: token as `0x${string}`,
      privateKey: fundedKey,
    });

    const from = wallet.importAgentWallet(fundedKey).address;
    const to = wallet.createAgentWallet().address;

    const gas = await wallet.estimateSendBNKRGas(from, to, '0.000001');
    assert.equal(typeof gas, 'bigint');
    assert.ok(gas > 0n);
  });

  test('optional live transfer + incoming detection (disabled by default)', async () => {
    if (!fundedKey) return test.skip('AGENT_WALLET_PRIVATE_KEY not set');
    if (process.env.RUN_LIVE_BASE_SEPOLIA_TRANSFER !== '1') {
      return test.skip('Set RUN_LIVE_BASE_SEPOLIA_TRANSFER=1 to enable live transfer test');
    }

    const wallet = new BaseWalletService({
      network: 'base-sepolia',
      rpcUrl: rpc,
      bnkrTokenAddress: token as `0x${string}`,
      privateKey: fundedKey,
      pollIntervalMs: 3000,
    });

    const receiver = wallet.createAgentWallet().address;
    const fromBlock = await wallet.getCurrentBlockNumber();

    const sent = await wallet.sendBNKR({ to: receiver, amount: '0.000001' });
    assert.equal(sent.txHash.startsWith('0x'), true);

    const incoming = await wallet.waitForIncomingBNKR(receiver, { timeoutMs: 90_000, fromBlock });
    assert.ok(incoming, 'expected incoming transfer to be detected');
    assert.equal(incoming?.to.toLowerCase(), receiver.toLowerCase());
  }, 120_000);
}
