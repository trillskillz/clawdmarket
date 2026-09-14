import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';

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
  await resolveSafeWebhookDestination(value);
}

type SafeDestination = {
  url: URL;
  address: string;
  family: 4 | 6;
};

export async function resolveSafeWebhookDestination(value: string): Promise<SafeDestination> {
  if (!isSafeWebhookUrlLiteral(value)) throw new Error('unsafe_webhook_url');
  const url = new URL(value);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error('unsafe_webhook_destination');
  }
  const selected = addresses[0];
  return { url, address: selected.address, family: selected.family as 4 | 6 };
}

type SafeExternalRequest = {
  method?: string;
  headers?: HeadersInit;
  body?: string | Uint8Array;
  signal?: AbortSignal;
  maxResponseBytes?: number;
};

/**
 * Resolve once, reject every private result, then connect to the selected
 * public address. Keeping the original hostname in SNI and Host preserves TLS
 * verification without allowing a second DNS lookup to rebind the request.
 */
export async function safeExternalFetch(value: string, init: SafeExternalRequest = {}): Promise<Response> {
  const destination = await resolveSafeWebhookDestination(value);
  const headers = new Headers(init.headers);
  headers.set('Host', destination.url.host);
  const maxResponseBytes = init.maxResponseBytes ?? 1024 * 1024;

  return new Promise<Response>((resolve, reject) => {
    const request = httpsRequest({
      protocol: 'https:',
      hostname: destination.address,
      family: destination.family,
      port: 443,
      path: `${destination.url.pathname}${destination.url.search}`,
      method: init.method || 'GET',
      headers: Object.fromEntries(headers.entries()),
      servername: destination.url.hostname,
      signal: init.signal,
    }, (response) => {
      const chunks: Buffer[] = [];
      let totalBytes = 0;
      response.on('data', (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes > maxResponseBytes) {
          request.destroy(new Error('response_too_large'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        const responseHeaders = new Headers();
        for (const [name, rawValue] of Object.entries(response.headers)) {
          if (Array.isArray(rawValue)) {
            for (const item of rawValue) responseHeaders.append(name, item);
          } else if (rawValue !== undefined) {
            responseHeaders.set(name, rawValue);
          }
        }
        resolve(new Response(Buffer.concat(chunks), {
          status: response.statusCode || 500,
          statusText: response.statusMessage,
          headers: responseHeaders,
        }));
      });
      response.on('error', reject);
    });
    request.on('error', reject);
    if (init.body !== undefined) request.write(init.body);
    request.end();
  });
}
