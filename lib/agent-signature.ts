import crypto from 'crypto';
import { isAddress, verifyMessage } from 'viem';

const MAX_SKEW_MS = 60_000;

export type AgentSignatureCheckInput = {
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
  bodyText: string;
  expectedWallet?: string;
  nowMs?: number;
};

export type AgentSignatureCheckResult =
  | { ok: true; wallet: string }
  | { ok: false; code: string; message: string };

export function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function buildAgentSignedMessage(args: {
  method: string;
  path: string;
  nonce: string;
  timestamp: string;
  bodyHash: string;
}) {
  return [
    'ClawdMarket Agent Request',
    `method:${args.method.toUpperCase()}`,
    `path:${args.path}`,
    `nonce:${args.nonce}`,
    `timestamp:${args.timestamp}`,
    `bodyHash:${args.bodyHash}`,
  ].join('\n');
}

function header(headers: Record<string, string | undefined>, key: string) {
  const lower = key.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

export async function verifyAgentRequestSignature(input: AgentSignatureCheckInput): Promise<AgentSignatureCheckResult> {
  const wallet = header(input.headers, 'x-agent-wallet') || '';
  const signature = header(input.headers, 'x-agent-signature') || '';
  const nonce = header(input.headers, 'x-agent-nonce') || '';
  const timestamp = header(input.headers, 'x-agent-timestamp') || '';

  if (!wallet || !signature || !nonce || !timestamp) {
    return { ok: false, code: 'MISSING_AGENT_SIGNATURE_HEADERS', message: 'Missing signed-agent request headers.' };
  }

  if (!isAddress(wallet as `0x${string}`)) {
    return { ok: false, code: 'INVALID_AGENT_WALLET', message: 'x-agent-wallet must be a valid EVM address.' };
  }

  const ts = Number(timestamp);
  const nowMs = input.nowMs ?? Date.now();
  if (!Number.isFinite(ts) || Math.abs(nowMs - ts) > MAX_SKEW_MS) {
    return { ok: false, code: 'STALE_AGENT_SIGNATURE', message: 'Signed request timestamp is outside allowed skew.' };
  }

  if (input.expectedWallet && input.expectedWallet.toLowerCase() !== wallet.toLowerCase()) {
    return { ok: false, code: 'WALLET_MISMATCH', message: 'Signed wallet does not match authenticated user wallet.' };
  }

  const bodyHash = sha256Hex(input.bodyText || '');
  const message = buildAgentSignedMessage({
    method: input.method,
    path: input.path,
    nonce,
    timestamp,
    bodyHash,
  });

  const valid = await verifyMessage({
    address: wallet as `0x${string}`,
    message,
    signature: signature as `0x${string}`,
  });

  if (!valid) {
    return { ok: false, code: 'INVALID_AGENT_SIGNATURE', message: 'Agent wallet signature validation failed.' };
  }

  return { ok: true, wallet };
}

export function walletFromSyntheticEmail(email?: string | null): string | null {
  if (!email) return null;
  const m = email.match(/^wallet_(0x[a-fA-F0-9]{40})@wallet\.local$/);
  return m ? m[1].toLowerCase() : null;
}
