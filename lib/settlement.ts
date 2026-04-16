import { db } from './db';
import { listings, users, wallets, contracts, contract_milestones, mpp_sessions } from './schema';
import { eq } from 'drizzle-orm';
import { hashPassword } from './auth';
import { createPublicClient, decodeEventLog, http, isAddress, parseAbiItem } from 'viem';
import { FALLBACK_LISTINGS } from './marketplace-fallback';
import { fallbackAgentForListingId } from './fallback-agents';
import { ensureContractsSchema } from './contracts-schema-ensure';
import crypto from 'crypto';

const DEV_FEE_PERCENT = 0.05;
const CONTRACTS_V1_ENABLED = process.env.CONTRACTS_V1 !== 'false';
const TRANSFER_EVENT = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');

export { DEV_FEE_PERCENT, CONTRACTS_V1_ENABLED };

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

export function getRpcUrl(chainId: number): string | null {
  const specific = process.env[`EVM_RPC_URL_${chainId}` as keyof NodeJS.ProcessEnv] as string | undefined;
  if (specific) return specific;
  if (process.env.EVM_RPC_URL) return process.env.EVM_RPC_URL;
  if (chainId === 1) return 'https://rpc.ankr.com/eth';
  if (chainId === 10) return 'https://rpc.ankr.com/optimism';
  if (chainId === 137) return 'https://rpc.ankr.com/polygon';
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

  return { tokenAmount };
}

export async function tryCreateContractForTrade(params: {
  listingId: string;
  buyerId: string;
  sellerId: string;
  sellerAmount: number;
  devAmount: number;
  totalCost: number;
}) {
  if (!CONTRACTS_V1_ENABLED) return;

  try {
    await ensureContractsSchema();
    await db.transaction(async (tx) => {
      const [contract] = await tx
        .insert(contracts)
        .values({
          buyer_id: params.buyerId,
          seller_id: params.sellerId,
          listing_id: params.listingId,
          total_amount: params.sellerAmount,
          fee_amount: params.devAmount,
          escrow_amount: params.totalCost,
          state: 'IN_PROGRESS',
          current_milestone_index: 0,
        })
        .returning();

      await tx.insert(contract_milestones).values({
        contract_id: contract.id,
        milestone_index: 0,
        title: 'Deliver service output',
        amount: params.sellerAmount,
        acceptance_spec: JSON.stringify({
          required_artifacts: ['delivery_summary'],
          notes: 'Seller must submit delivery artifacts. Buyer approves/rejects in dashboard.',
        }),
        state: 'ACTIVE',
      });
    });
  } catch (e) {
    console.error('contract creation non-fatal error:', e);
  }
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

export async function ensureAdminFeeRecipient(): Promise<string | null> {
  const adminWalletAddress = (process.env.DEV_WALLET_ADDRESS || process.env.DEV_FEE_WALLET_ADDRESS || process.env.ADMIN_BANKR_WALLET_ADDRESS || '').trim().toLowerCase();
  if (!adminWalletAddress) return null;
  if (!isAddress(adminWalletAddress as `0x${string}`)) {
    console.error('Invalid ADMIN_BANKR_WALLET_ADDRESS configured');
    return null;
  }

  const syntheticEmail = `wallet_${adminWalletAddress}@wallet.local`;

  let [adminUser] = await db.select().from(users).where(eq(users.email, syntheticEmail));
  if (!adminUser) {
    const passwordHash = await hashPassword(crypto.randomBytes(32).toString('hex'));
    const inserted = await db
      .insert(users)
      .values({
        email: syntheticEmail,
        password_hash: passwordHash,
        name: `AdminWallet_${adminWalletAddress.slice(2, 8)}`,
        role: 'human',
        bio: `Admin fee wallet ${adminWalletAddress}`,
      })
      .returning();
    adminUser = inserted[0];
  }

  const [existingWallet] = await db.select().from(wallets).where(eq(wallets.user_id, adminUser.id));
  if (!existingWallet) {
    await db.insert(wallets).values({
      user_id: adminUser.id,
      balance: 0,
      escrow: 0,
    });
  }

  return adminUser.id;
}

function mapFallbackCategory(input: string): 'compute' | 'skills' | 'data' | 'bounties' | 'other' {
  const c = input.toLowerCase();
  if (c === 'data') return 'data';
  if (c === 'code' || c === 'analysis' || c === 'content' || c === 'custom') return 'skills';
  if (c === 'defi' || c === 'trading') return 'bounties';
  return 'other';
}

export async function ensureSeededListingMaterialized(listingId: string) {
  const fallback = FALLBACK_LISTINGS.find((l) => l.id === listingId);
  if (!fallback) return null;

  const seller = fallbackAgentForListingId(listingId);

  let [sellerUser] = await db.select().from(users).where(eq(users.id, seller.id));
  if (!sellerUser) {
    const password_hash = await hashPassword(`${seller.id}:seeded-agent`);
    const [createdUser] = await db
      .insert(users)
      .values({
        id: seller.id,
        email: `${seller.name.toLowerCase().replace(/\s+/g, '.')}@agents.clawdmarket.local`,
        password_hash,
        name: seller.name,
        role: 'agent',
        bio: seller.bio,
        avatar_url: seller.avatar_url,
      })
      .returning();
    sellerUser = createdUser;

    await db.insert(wallets).values({
      user_id: seller.id,
      balance: 0,
      escrow: 0,
    });
  }

  let [listing] = await db.select().from(listings).where(eq(listings.id, listingId));
  if (!listing) {
    const [createdListing] = await db
      .insert(listings)
      .values({
        id: listingId,
        seller_id: seller.id,
        category: mapFallbackCategory(fallback.category),
        title: fallback.title,
        description: fallback.description,
        price_bankr: fallback.price_bankr,
        status: 'active',
      })
      .returning();
    listing = createdListing;
  }

  return listing;
}

export async function tradesHasFeeColumns() {
  try {
    const rs = await (db as any).$client.execute({ sql: "PRAGMA table_info('trades')", args: [] });
    const rows = rs?.rows || [];
    const names = new Set(rows.map((r: any) => String(r.name || r[1] || '').toLowerCase()));
    return names.has('item_price') && names.has('platform_fee') && names.has('payout_status');
  } catch {
    return false;
  }
}
