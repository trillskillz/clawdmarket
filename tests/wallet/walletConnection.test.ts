import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatWalletConnectionError,
  getBrowserWalletConnectors,
  isGenericInjectedConnector,
  type WalletConnectorLike,
} from '@/lib/wallet-connection';

test('wallet connector filtering removes targetless injected connector', () => {
  const connectors: WalletConnectorLike[] = [
    { id: 'injected', name: 'Injected', type: 'injected' },
    { id: 'metaMask', name: 'MetaMask', type: 'injected' },
    { id: 'io.metamask', name: 'MetaMask', type: 'injected' },
    { id: 'coinbaseWalletSDK', name: 'Coinbase Wallet', type: 'coinbaseWallet' },
  ];

  assert.equal(isGenericInjectedConnector(connectors[0]!), true);
  assert.deepEqual(
    getBrowserWalletConnectors(connectors).map((connector) => connector.name),
    ['MetaMask'],
  );
});

test('wallet empty-account errors are actionable and hide viem internals', () => {
  const message = formatWalletConnectionError(
    new Error('User rejected the request. Details: wallet must has at least one account Version: viem@2.47.11'),
    'MetaMask',
  );

  assert.match(message, /No account was shared by MetaMask/);
  assert.match(message, /select at least one account/);
  assert.doesNotMatch(message, /viem/i);
});

test('wallet rejection errors are normalized', () => {
  const message = formatWalletConnectionError(new Error('User rejected the request.'), 'Coinbase Wallet');

  assert.equal(
    message,
    'Connection request was rejected in Coinbase Wallet. Approve the account request to continue.',
  );
});
