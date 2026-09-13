import { db } from './db';
import { users, wallets, mpp_sessions, listings, trades, transactions } from './schema';
import { and, eq, sql } from 'drizzle-orm';
import { createPublicClient, decodeEventLog, erc20Abi, http, isAddress, parseAbiItem } from 'viem';
import crypto from 'crypto';
import { enforceAgentSpendPolicy } from './agent-spend-policy';

const DEV_FEE_PERCENT = 0.05;
const TRANSFER_EVENT = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');

export { DEV_FEE_PERCENT };

export function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export function calculateTradeFinancials(itemPrice: number) {
  const platformFee = round2(itemPrice * DEV_FEE_PERCENT);
  const totalCost = round2(itemPrice + platformFee);
  const sellerAmount = itemPrice;
  const devAmount = platformFee;
  if (devAmount !== round2(itemPrice * DEV_FEE_PERCENT)) {
    throw new Error('DEV_FEE_MISMATCH');
  }
  return { itemPrice, platformFee, totalCost, sellerAmount, devAmount };
}

export class TradeRaceError extends Error {
  constructor(public readonly code: 'LISTING_ALREADY_CLAIMED' | 'INSUFFICIENT_FUNDS_AT_COMMIT', message: string) {
    super(message);
    this.name = 'TradeRaceError';
  }
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function createLedgerTrade(
  tx: Transaction,
  listing: typeof listings.$inferSelect,
  buyerId: string,
  feeRecipientId: string,
  options: { agentId?: string | null; clientReference?: string | null } = {},
) {
  if (listing.seller_id === buyerId) throw new Error('Cannot buy your own work');
  if (!Number.isFinite(listing.price_bankr) || listing.price_bankr <= 0) throw new Error('Invalid listing price');
  const { sellerAmount, platformFee, totalCost } = calculateTradeFinancials(listing.price_bankr);
  if (options.agentId) {
    await enforceAgentSpendPolicy(tx, { agentId: options.agentId, buyerId, totalCost });
  }
  const claimed = await tx.update(listings).set({ status: 'sold' })
    .where(and(eq(listings.id, listing.id), eq(listings.status, 'active'))).returning({ id: listings.id });
  if (!claimed.length) throw new TradeRaceError('LISTING_ALREADY_CLAIMED', 'Listing was claimed by another buyer.');

  const debit = await tx.update(wallets).set({
    balance: sql`${wallets.balance} - ${totalCost}`,
    escrow: sql`${wallets.escrow} + ${sellerAmount}`,
  }).where(and(eq(wallets.user_id, buyerId), sql`${wallets.balance} >= ${totalCost}`)).returning({ id: wallets.user_id });
  if (!debit.length) throw new TradeRaceError('INSUFFICIENT_FUNDS_AT_COMMIT', `Insufficient account balance. Required ${totalCost}.`);

  const sessionId = await createEscrowSession(tx, buyerId, totalCost);
  const [trade] = await tx.insert(trades).values({
    listing_id: listing.id, buyer_id: buyerId, seller_id: listing.seller_id,
    amount: sellerAmount, fee: platformFee, item_price: listing.price_bankr,
    platform_fee: platformFee, total_cost: totalCost, seller_amount: sellerAmount,
    dev_amount: platformFee,
    dev_wallet: (process.env.DEV_WALLET_ADDRESS || process.env.DEV_FEE_WALLET_ADDRESS || '').trim() || null,
    payout_status: platformFee > 0 ? 'fee_sent' : 'pending', payment_rail: 'ledger',
    client_reference: options.clientReference || null,
    escrow_session_id: sessionId, status: 'escrow_held',
    auto_confirm_at: new Date(Date.now() + 259200 * 1000).toISOString(),
  }).returning();
  await tx.insert(transactions).values({
    from_user_id: buyerId, amount: sellerAmount, type: 'escrow_lock', reference_id: trade.id,
    memo: `Account-balance escrow lock for listing ${listing.id}`,
  });
  if (platformFee > 0) {
    await tx.update(wallets).set({ balance: sql`${wallets.balance} + ${platformFee}` }).where(eq(wallets.user_id, feeRecipientId));
    await tx.insert(transactions).values({
      from_user_id: buyerId, to_user_id: feeRecipientId, amount: platformFee,
      type: 'fee', reference_id: trade.id, memo: 'Marketplace fee (5%)',
    });
  }
  return trade;
}

export function getRpcUrl(chainId: number): string | null {
  const specific = process.env[`EVM_RPC_URL_${chainId}` as keyof NodeJS.ProcessEnv] as string | undefined;
  if (specific) return specific;
  if (chainId === 4217 && process.env.TEMPO_RPC_URL) return process.env.TEMPO_RPC_URL;
  if (process.env.EVM_RPC_URL) return process.env.EVM_RPC_URL;
  if (chainId === 1) return 'https://rpc.ankr.com/eth';
  if (chainId === 10) return 'https://rpc.ankr.com/optimism';
  if (chainId === 56) return 'https://rpc.ankr.com/bsc';
  if (chainId === 137) return 'https://rpc.ankr.com/polygon';
  if (chainId === 43114) return 'https://rpc.ankr.com/avalanche';
  if (chainId === 8453) return 'https://rpc.ankr.com/base';
  if (chainId === 42161) return 'https://rpc.ankr.com/arbitrum';
  return null;
}

export async function verifyErc20Transfer(params: {
  chainId: number;
  tokenAddress: `0x${string}`;
  txHash: `0x${string}`;
  treasuryAddress: `0x${string}`;
  buyerWallet?: `0x${string}`;
}) {
  const rpcUrl = getRpcUrl(params.chainId);
  if (!rpcUrl) throw new Error(`Unsupported or unconfigured chainId: ${params.chainId}`);

  const client = createPublicClient({ transport: http(rpcUrl) });
  const receipt = await client.getTransactionReceipt({ hash: params.txHash });
  if (receipt.status !== 'success') {
    throw new Error('Payment transaction failed on-chain');
  }
  const transaction = await client.getTransaction({ hash: params.txHash });
  if (params.buyerWallet && transaction.from.toLowerCase() !== params.buyerWallet.toLowerCase()) {
    throw new Error('Payment transaction sender does not match the connected buyer wallet');
  }
  const tokenDecimals = Number(await client.readContract({
    address: params.tokenAddress,
    abi: erc20Abi,
    functionName: 'decimals',
  }));
  if (!Number.isInteger(tokenDecimals) || tokenDecimals < 0 || tokenDecimals > 36) {
    throw new Error('Token decimals could not be verified on-chain');
  }

  let tokenAmount = BigInt(0);
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== params.tokenAddress.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi: [TRANSFER_EVENT], data: log.data, topics: log.topics });
      if (decoded.eventName !== 'Transfer') continue;
      const from = String(decoded.args.from || '').toLowerCase();
      const to = String(decoded.args.to || '').toLowerCase();
      const value = BigInt(decoded.args.value || BigInt(0));
      if (to === params.treasuryAddress.toLowerCase()) {
        if (!params.buyerWallet || from === params.buyerWallet.toLowerCase()) {
          tokenAmount += value;
        }
      }
    } catch {
      // ignore unrelated logs
    }
  }

  if (tokenAmount <= BigInt(0)) {
    throw new Error('No ERC-20 transfer to treasury found in transaction');
  }

  return { tokenAmount, tokenDecimals };
}

export async function createEscrowSession(tx: any, buyerId: string, reservedAmount: number) {
  const sessionId = crypto.randomUUID();
  await tx.insert(mpp_sessions).values({
    session_id: sessionId,
    agent_id: buyerId,
    reserved_amount: reservedAmount,
    spent_amount: 0,
    status: 'active',
  });
  return sessionId;
}

export async function ensureAdminFeeRecipient(): Promise<string> {
  const adminWalletAddress = (process.env.DEV_WALLET_ADDRESS || process.env.DEV_FEE_WALLET_ADDRESS || '').trim().toLowerCase();
  const validExternalAddress = adminWalletAddress && isAddress(adminWalletAddress as `0x${string}`)
    ? adminWalletAddress
    : null;
  if (adminWalletAddress && !validExternalAddress) {
    console.error('Invalid marketplace fee wallet configured; fees will remain in the internal platform account');
  }

  const feeUserId = 'system_marketplace_fees';
  await db.insert(users).values({
    id: feeUserId,
    email: 'fees@system.clawdmarket.local',
    password_hash: crypto.randomBytes(32).toString('hex'),
    name: 'ClawdMarket Fees',
    role: 'human',
    bio: validExternalAddress ? `External settlement wallet: ${validExternalAddress}` : 'Internal marketplace fee account',
  }).onConflictDoNothing();
  await db.insert(wallets).values({ user_id: feeUserId, balance: 0, escrow: 0 }).onConflictDoNothing();
  return feeUserId;
}
