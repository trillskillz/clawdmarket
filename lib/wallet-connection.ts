export type WalletConnectorLike = {
  id: string;
  name: string;
  type?: string;
};

function normalized(value: string | undefined): string {
  return (value || '').trim().toLowerCase();
}

function stringifyWalletError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return 'Wallet connection failed';
}

function cleanWalletErrorMessage(message: string): string {
  return message
    .replace(/\s*Version:\s*viem@[^\s]+/gi, '')
    .replace(/^User rejected the request\.\s*Details:\s*/i, '')
    .trim();
}

export function isGenericInjectedConnector(connector: WalletConnectorLike): boolean {
  return normalized(connector.id) === 'injected' || normalized(connector.name) === 'injected';
}

export function getBrowserWalletConnectors<T extends WalletConnectorLike>(connectors: readonly T[]): T[] {
  const seen = new Set<string>();
  const browserConnectors: T[] = [];

  for (const connector of connectors) {
    if (isGenericInjectedConnector(connector)) continue;

    const id = normalized(connector.id);
    const name = normalized(connector.name);
    const type = normalized(connector.type);
    const isBrowserWallet =
      type === 'injected' ||
      id.includes('metamask') ||
      name.includes('metamask') ||
      id.includes('rabby') ||
      name.includes('rabby');

    if (!isBrowserWallet) continue;

    const key = name || id;
    if (seen.has(key)) continue;
    seen.add(key);
    browserConnectors.push(connector);
  }

  return browserConnectors;
}

export function formatWalletConnectionError(error: unknown, connectorName = 'wallet'): string {
  const raw = stringifyWalletError(error);
  const message = raw.toLowerCase();
  const label = connectorName === 'wallet' ? 'your wallet' : connectorName;

  if (
    message.includes('wallet must has at least one account') ||
    message.includes('accounts received is empty') ||
    message.includes('must have at least one account') ||
    message.includes('no account')
  ) {
    return `No account was shared by ${label}. Unlock it, select at least one account for clawdmkt.com, then try again.`;
  }

  if (
    message.includes('user rejected') ||
    message.includes('user denied') ||
    message.includes('request rejected') ||
    message.includes('user closed modal')
  ) {
    return `Connection request was rejected in ${label}. Approve the account request to continue.`;
  }

  if (
    message.includes('provider not found') ||
    message.includes('no provider') ||
    message.includes('wallet not found')
  ) {
    return `${label} was not detected in this browser. Install or unlock it, or use another wallet option.`;
  }

  if (
    message.includes('already pending') ||
    message.includes('request already pending') ||
    message.includes('resource unavailable')
  ) {
    return `A wallet request is already open in ${label}. Finish or close that prompt, then try again.`;
  }

  return cleanWalletErrorMessage(raw) || 'Wallet connection failed';
}
