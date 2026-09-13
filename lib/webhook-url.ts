import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

const BLOCKED_HOSTNAMES = new Set(['localhost', 'metadata.google.internal', 'metadata.internal']);

export function isPrivateAddress(input: string): boolean {
  const ip = input.replace(/^\[|\]$/g, '').toLowerCase();
  if (ip === '::' || ip === '::1' || ip.startsWith('fe80:') || ip.startsWith('fc') || ip.startsWith('fd')) return true;
  if (ip.startsWith('::ffff:')) return isPrivateAddress(ip.slice('::ffff:'.length));

  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 0
    || parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
    || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
    || (parts[0] >= 224);
}

export function isSafeWebhookUrlLiteral(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    if (url.port && url.port !== '443') return false;
    if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost')) return false;
    if (isIP(hostname.replace(/^\[|\]$/g, '')) && isPrivateAddress(hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

export async function assertSafeWebhookDestination(value: string): Promise<void> {
  if (!isSafeWebhookUrlLiteral(value)) throw new Error('unsafe_webhook_url');
  const hostname = new URL(value).hostname.replace(/^\[|\]$/g, '');
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error('unsafe_webhook_destination');
  }
}
