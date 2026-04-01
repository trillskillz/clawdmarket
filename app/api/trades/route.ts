import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { trades, listings, users, wallets, transactions, fee_errors, contracts, contract_milestones, payment_receipts, mpp_sessions } from '@/lib/schema';
import { authenticateRequest, hashPassword } from '@/lib/auth';
import { createTradeSchema } from '@/lib/validation';
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit';
import { validateCsrf } from '@/lib/csrf';
import { fireWebhook } from '@/lib/webhooks';
import { and, eq, or, desc, sql } from 'drizzle-orm';
import crypto from 'crypto';
import { createPublicClient, decodeEventLog, formatUnits, http, isAddress, parseAbiItem } from 'viem';
import { envMeta } from '@/lib/agent-environment';
import { validateAgentInstruction } from '@/lib/agent-security';
import { logPaymentFailure, paymentError } from '@/lib/payment-failure';
import { FALLBACK_LISTINGS } from '@/lib/marketplace-fallback';
import { fallbackAgentForListingId } from '@/lib/fallback-agents';
import { ensureContractsSchema } from '@/lib/contracts-schema-ensure';
import { mppx } from '@/lib/mpp';
import { Receipt } from 'mppx';
import { PATHUSD_ADDRESS } from '@/lib/constants';
import { getTokenPriceUsd } from '@/lib/price-oracle';

const TX_HASH_RE = /^0x([A-Fa-f0-9]{64})$/;

const DEV_FEE_PERCENT = 0.05; // 5% fee
const CONTRACTS_V1_ENABLED = process.env.CONTRACTS_V1 !== 'false';
const MPP_TRADE_EXECUTION_PRICE_USD = 0.01;
const MPP_CURRENCY_PATH_USD = PATHUSD_ADDRESS;
const TRANSFER_EVENT = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');

function getRpcUrl(chainId: number): string | null {
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

async function verifyErc20Transfer(params: {
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

async function tryCreateContractForTrade(params: {
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

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function calculateTradeFinancials(itemPrice: number) {
  const platformFee = round2(itemPrice * DEV_FEE_PERCENT);
  const totalCost = round2(itemPrice + platformFee);
  const sellerAmount = itemPrice;
  const devAmount = platformFee;
  if (devAmount !== round2(itemPrice * DEV_FEE_PERCENT)) {
    throw new Error('DEV_FEE_MISMATCH');
  }
  return { itemPrice, platformFee, totalCost, sellerAmount, devAmount };
}

async function createEscrowSession(tx: any, buyerId: string, reservedAmount: number) {
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

async function tradesHasFeeColumns() {
  try {
    const rs = await (db as any).$client.execute({ sql: "PRAGMA table_info('trades')", args: [] });
    const rows = rs?.rows || [];
    const names = new Set(rows.map((r: any) => String(r.name || r[1] || '').toLowerCase()));
    return names.has('item_price') && names.has('platform_fee') && names.has('payout_status');
  } catch {
    return false;
  }
}

class TradeRaceError extends Error {
  constructor(public readonly code: 'LISTING_ALREADY_CLAIMED' | 'INSUFFICIENT_FUNDS_AT_COMMIT', message: string) {
    super(message);
    this.name = 'TradeRaceError';
  }
}

function mapFallbackCategory(input: string): 'compute' | 'skills' | 'data' | 'bounties' | 'other' {
  const c = input.toLowerCase();
  if (c === 'data') return 'data';
  if (c === 'code' || c === 'analysis' || c === 'content' || c === 'custom') return 'skills';
  if (c === 'defi' || c === 'trading') return 'bounties';
  return 'other';
}

async function ensureSeededListingMaterialized(listingId: string) {
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

async function ensureAdminFeeRecipient(): Promise<string | null> {
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

async function createTradePost(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cookieToken = req.cookies.get('auth-token')?.value;
  const auth = await authenticateRequest(authHeader || (cookieToken ? `Bearer ${cookieToken}` : null));

  if (!auth) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  // Validate CSRF for cookie-based auth
  if (!authHeader && !validateCsrf(req)) {
    return NextResponse.json(
      { error: 'CSRF validation failed' },
      { status: 403 }
    );
  }

  const replayValidation = await validateAgentInstruction(req, auth.userId, authHeader || null);
  if (replayValidation) return replayValidation;

  const rateLimitResult = rateLimit(`trade:${auth.userId}`, { 
    interval: 60 * 1000, 
    maxRequests: 20 
  });

  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: 'Too many trade attempts. Please try again later.' },
      { 
        status: 429,
        headers: getRateLimitHeaders(rateLimitResult),
      }
    );
  }

  try {
    const body = await req.json();
    const validated = createTradeSchema.parse(body);

    if (CONTRACTS_V1_ENABLED) {
      await ensureContractsSchema();
    }

    // Fetch listing (materialize seeded fallback listings when needed)
    let [listing]: any = await db
      .select()
      .from(listings)
      .where(eq(listings.id, validated.listing_id));

    if (!listing && validated.listing_id.startsWith('fb-')) {
      listing = await ensureSeededListingMaterialized(validated.listing_id);
    }

    if (!listing) {
      await logPaymentFailure({
        buyer_id: auth.userId,
        amount: validated.amount,
        token: 'bnkr',
        route: 'POST /api/trades',
        listing_id: validated.listing_id,
        error_code: 'LISTING_NOT_FOUND',
        message: 'Listing not found',
        state: 'no_funds_moved',
      });
      return NextResponse.json(
        { ...paymentError('LISTING_NOT_FOUND', 'Listing not found'), ...envMeta('clawdmarket/api/trades') },
        { status: 404 }
      );
    }

    if (listing.status !== 'active') {
      await logPaymentFailure({
        buyer_id: auth.userId,
        seller_id: listing.seller_id,
        amount: validated.amount,
        token: 'bnkr',
        route: 'POST /api/trades',
        listing_id: validated.listing_id,
        error_code: 'LISTING_NOT_ACTIVE',
        message: 'Listing is not active',
        state: 'no_funds_moved',
      });
      return NextResponse.json(
        { ...paymentError('LISTING_NOT_ACTIVE', 'Listing is not active'), ...envMeta('clawdmarket/api/trades') },
        { status: 400 }
      );
    }

    if (validated.allow_partial_fill) {
      return NextResponse.json(
        { error: 'Partial fills are not supported', code: 'PARTIAL_FILL_NOT_SUPPORTED', ...envMeta('clawdmarket/api/trades') },
        { status: 400 }
      );
    }

    if (listing.seller_id === auth.userId) {
      return NextResponse.json(
        { error: 'Cannot buy your own listing' },
        { status: 400 }
      );
    }

    // Server-authoritative fee math (never trust client-provided fee/price)
    const requestedQuantity = Number(validated.amount || 1);
    if (requestedQuantity !== 1) {
      return NextResponse.json({ error: 'Only quantity=1 is supported' }, { status: 400 });
    }

    const itemPrice = Number(listing.price_bankr);
    const { itemPrice: tradeAmount, platformFee: fee, totalCost, sellerAmount, devAmount } = calculateTradeFinancials(itemPrice);
    const devWalletAddress = (process.env.DEV_WALLET_ADDRESS || process.env.DEV_FEE_WALLET_ADDRESS || process.env.ADMIN_BANKR_WALLET_ADDRESS || '').trim() || null;

    const bodyPaymentMode = (body?.payment_mode || '').toString();
    const onchain = body?.onchain || null;

    if (bodyPaymentMode === 'onchain') {
      const treasuryAddressRaw = (
        process.env.TREASURY_ADDRESS ||
        process.env.MPP_TREASURY_ADDRESS ||
        process.env.MPP_RECIPIENT_ADDRESS ||
        process.env.ESCROW_WALLET_ADDRESS ||
        process.env.NEXT_PUBLIC_ESCROW_WALLET_ADDRESS ||
        ''
      ).trim();

      if (!treasuryAddressRaw || !isAddress(treasuryAddressRaw)) {
        return NextResponse.json(
          { error: 'On-chain treasury wallet is not configured on server' },
          { status: 500 }
        );
      }

      if (!onchain) {
        return NextResponse.json({ error: 'Missing on-chain payment payload' }, { status: 400 });
      }

      const tokenAddress = String(onchain.tokenAddress || onchain.token_address || '').trim();
      const txHash = String(onchain.txHash || onchain.escrow_tx_hash || '').trim();
      const buyerWalletRaw = String(onchain.buyerWallet || onchain.buyer_wallet || '').trim();
      const tokenSymbol = String(onchain.tokenSymbol || onchain.token_symbol || '').trim() || null;
      const chainId = Number(onchain.chainId || onchain.chain_id || 0);
      const tokenDecimals = Number(onchain.decimals);

      if (!isAddress(tokenAddress)) {
        return NextResponse.json({ error: 'Invalid token address' }, { status: 400 });
      }
      if (!Number.isInteger(chainId) || chainId <= 0) {
        return NextResponse.json({ error: 'Invalid on-chain payment payload (chainId)' }, { status: 400 });
      }
      if (!Number.isInteger(tokenDecimals) || tokenDecimals < 0 || tokenDecimals > 36) {
        return NextResponse.json({ error: 'Invalid token decimals' }, { status: 400 });
      }
      if (!TX_HASH_RE.test(txHash)) {
        return NextResponse.json({ error: 'Invalid on-chain payment transaction hash format' }, { status: 400 });
      }

      let buyerWallet: `0x${string}` | undefined;
      if (buyerWalletRaw) {
        if (!isAddress(buyerWalletRaw)) {
          return NextResponse.json({ error: 'Invalid buyer wallet address' }, { status: 400 });
        }
        buyerWallet = buyerWalletRaw as `0x${string}`;
      }

      let tokenAmount: bigint;
      try {
        const verification = await verifyErc20Transfer({
          chainId,
          tokenAddress: tokenAddress as `0x${string}`,
          txHash: txHash as `0x${string}`,
          treasuryAddress: treasuryAddressRaw as `0x${string}`,
          buyerWallet,
        });
        tokenAmount = verification.tokenAmount;
      } catch (error: any) {
        return NextResponse.json({ error: error?.message || 'On-chain transfer verification failed' }, { status: 402 });
      }

      const tokenPriceUsd = await getTokenPriceUsd(tokenAddress, chainId);
      if (tokenPriceUsd == null) {
        return NextResponse.json(
          { error: 'Token price could not be verified. Use a token with a CoinGecko listing.' },
          { status: 402 },
        );
      }

      const tokenAmountFloat = Number(formatUnits(tokenAmount, tokenDecimals));
      const usdValueAtPayment = tokenAmountFloat * tokenPriceUsd;
      const minRequiredUsd = totalCost * 0.98;
      if (!Number.isFinite(usdValueAtPayment) || usdValueAtPayment < minRequiredUsd) {
        return NextResponse.json(
          { error: `Insufficient on-chain payment value. Required at least $${minRequiredUsd.toFixed(4)}, received $${usdValueAtPayment.toFixed(4)}.` },
          { status: 402 },
        );
      }

      const adminFeeRecipientUserId = await ensureAdminFeeRecipient();

      const newTrade = await db.transaction(async (tx) => {
        const claimedRows = await tx
          .update(listings)
          .set({ status: 'sold' })
          .where(and(eq(listings.id, validated.listing_id), eq(listings.status, 'active')))
          .returning({ id: listings.id });

        if (claimedRows.length === 0) {
          throw new TradeRaceError('LISTING_ALREADY_CLAIMED', 'Listing was claimed by another buyer.');
        }

        const escrowSessionId = await createEscrowSession(tx, auth.userId, totalCost);

        const [trade] = await tx
          .insert(trades)
          .values({
            listing_id: validated.listing_id,
            buyer_id: auth.userId,
            seller_id: listing.seller_id,
            amount: sellerAmount,
            fee: devAmount,
            item_price: itemPrice,
            platform_fee: devAmount,
            total_cost: totalCost,
            seller_amount: sellerAmount,
            dev_amount: devAmount,
            dev_wallet: devWalletAddress,
            // Single on-chain payment tx covers item + dev fee.
            fee_tx_hash: txHash,
            payout_status: 'seller_paid',
            escrow_session_id: escrowSessionId,
            status: 'escrow_held',
          })
          .returning();

        await tx.insert(transactions).values({
          from_user_id: auth.userId,
          to_user_id: listing.seller_id,
          amount: sellerAmount,
          type: 'transfer',
          reference_id: trade.id,
          memo: `On-chain escrow payment (single tx: ${txHash})`,
        });

        if (devAmount > 0) {
          if (adminFeeRecipientUserId) {
            await tx
              .update(wallets)
              .set({ balance: sql`${wallets.balance} + ${devAmount}` })
              .where(eq(wallets.user_id, adminFeeRecipientUserId));
          }

          await tx.insert(transactions).values({
            from_user_id: auth.userId,
            to_user_id: adminFeeRecipientUserId,
            amount: devAmount,
            type: 'fee',
            reference_id: trade.id,
            memo: `On-chain dev fee allocation (single tx: ${txHash})`,
          });
        }

        return trade;
      });

      await tryCreateContractForTrade({
        listingId: validated.listing_id,
        buyerId: auth.userId,
        sellerId: listing.seller_id,
        sellerAmount,
        devAmount,
        totalCost,
      });

      await db.insert(payment_receipts).values({
        route: 'POST /api/trades',
        amount: totalCost,
        currency: tokenAddress.toLowerCase(),
        tx_hash: txHash,
        payer_address: buyerWallet || null,
        token_address: tokenAddress.toLowerCase(),
        chain_id: chainId,
        token_symbol: tokenSymbol,
        token_amount: tokenAmount.toString(),
        usd_value_at_payment: usdValueAtPayment,
      });

      Promise.all([
        fireWebhook(auth.userId, 'trade.created', { trade: newTrade }),
        fireWebhook(listing.seller_id, 'trade.created', { trade: newTrade }),
        fireWebhook(listing.seller_id, 'listing.sold', { listing_id: validated.listing_id, trade: newTrade }),
      ]).catch(err => console.error('Webhook error:', err));

      return NextResponse.json(
        {
          message: 'Trade initiated successfully with on-chain ERC-20 payment.',
          trade: newTrade,
          code: 'TRADE_CREATED_ONCHAIN',
          fee_info: {
            item_price: sellerAmount,
            platform_fee: devAmount,
            total_cost: totalCost,
            seller_amount: sellerAmount,
            dev_amount: devAmount,
            dev_wallet: process.env.DEV_WALLET_ADDRESS || process.env.DEV_FEE_WALLET_ADDRESS || process.env.ADMIN_BANKR_WALLET_ADDRESS || null,
            admin_fee_wallet_configured: Boolean(process.env.DEV_WALLET_ADDRESS || process.env.DEV_FEE_WALLET_ADDRESS || process.env.ADMIN_BANKR_WALLET_ADDRESS),
          },
          onchain_receipts: {
            payment_tx_hash: txHash,
            escrow_tx_hash: txHash,
            fee_tx_hash: txHash,
          },
          ...envMeta('clawdmarket/api/trades'),
        },
        {
          status: 201,
          headers: getRateLimitHeaders(rateLimitResult),
        }
      );
    }

    // ─── LEDGER ESCROW LOGIC (legacy fallback) ───

    // 1. Check buyer balance
    const [buyerWallet] = await db
      .select()
      .from(wallets)
      .where(eq(wallets.user_id, auth.userId));

    if (!buyerWallet) {
      return NextResponse.json(
        { error: 'Buyer wallet not found' },
        { status: 404 }
      );
    }

    if (buyerWallet.balance < totalCost) {
      await logPaymentFailure({
        buyer_id: auth.userId,
        seller_id: listing.seller_id,
        amount: totalCost,
        token: 'bnkr',
        route: 'POST /api/trades',
        listing_id: validated.listing_id,
        error_code: 'INSUFFICIENT_FUNDS',
        message: `Insufficient funds. Cost: ${totalCost} BANKR, Balance: ${buyerWallet.balance} BANKR`,
        state: 'no_funds_moved',
      });
      return NextResponse.json(
        {
          ...paymentError('INSUFFICIENT_FUNDS', `Insufficient funds. Cost: ${totalCost} BANKR, Balance: ${buyerWallet.balance} BANKR`),
          ...envMeta('clawdmarket/api/trades'),
        },
        { status: 402 } // Payment Required
      );
    }

    const adminFeeRecipientUserId = await ensureAdminFeeRecipient();

    // 2. Perform atomic trade creation & fund locking
    // Note: Drizzle's `db.transaction` works with @libsql/client (Turso)
    const newTrade = await db.transaction(async (tx) => {
      const claimedRows = await tx
        .update(listings)
        .set({ status: 'sold' })
        .where(and(eq(listings.id, validated.listing_id), eq(listings.status, 'active')))
        .returning({ id: listings.id });

      if (claimedRows.length === 0) {
        throw new TradeRaceError('LISTING_ALREADY_CLAIMED', 'Listing was claimed by another buyer.');
      }

      const walletUpdateRows = await tx
        .update(wallets)
        .set({
          balance: sql`${wallets.balance} - ${totalCost}`,
          escrow: sql`${wallets.escrow} + ${tradeAmount}`,
        })
        .where(and(eq(wallets.user_id, auth.userId), sql`${wallets.balance} >= ${totalCost}`))
        .returning({ user_id: wallets.user_id });

      if (walletUpdateRows.length === 0) {
        throw new TradeRaceError('INSUFFICIENT_FUNDS_AT_COMMIT', `Insufficient funds at commit time. Required ${totalCost} BANKR.`);
      }

      const escrowSessionId = await createEscrowSession(tx, auth.userId, totalCost);

      const [trade] = await tx
        .insert(trades)
        .values({
          listing_id: validated.listing_id,
          buyer_id: auth.userId,
          seller_id: listing.seller_id,
          amount: sellerAmount,
          fee: devAmount,
          item_price: itemPrice,
          platform_fee: devAmount,
          total_cost: totalCost,
          seller_amount: sellerAmount,
          dev_amount: devAmount,
          dev_wallet: devWalletAddress,
          payout_status: devAmount > 0 ? 'fee_sent' : 'pending',
          escrow_session_id: escrowSessionId,
          status: 'escrow_held',
        })
        .returning();

      // Record transaction: Lock funds
      await tx.insert(transactions).values({
        from_user_id: auth.userId,
        amount: tradeAmount,
        type: 'escrow_lock',
        reference_id: trade.id,
        memo: `Escrow lock for listing ${validated.listing_id}`,
      });

      // Record transaction: Fee (credited to configured admin fee wallet when available)
      if (fee > 0) {
        if (adminFeeRecipientUserId) {
          await tx
            .update(wallets)
            .set({ balance: sql`${wallets.balance} + ${fee}` })
            .where(eq(wallets.user_id, adminFeeRecipientUserId));
        }

        await tx.insert(transactions).values({
          from_user_id: auth.userId,
          to_user_id: adminFeeRecipientUserId,
          amount: fee,
          type: 'fee',
          reference_id: trade.id,
          memo: adminFeeRecipientUserId
            ? 'Marketplace fee (5%) credited to admin wallet'
            : 'Marketplace fee (5%) with no admin wallet configured',
        });
      }

      return trade;
    });
    // ─── ESCROW LOGIC END ───

    await tryCreateContractForTrade({
      listingId: validated.listing_id,
      buyerId: auth.userId,
      sellerId: listing.seller_id,
      sellerAmount,
      devAmount,
      totalCost,
    });

    // Fire webhooks (fire-and-forget, don't block response)
    Promise.all([
      fireWebhook(auth.userId, 'trade.created', { trade: newTrade }),
      fireWebhook(listing.seller_id, 'trade.created', { trade: newTrade }),
      fireWebhook(listing.seller_id, 'listing.sold', { listing_id: validated.listing_id, trade: newTrade }),
      fireWebhook(auth.userId, 'balance.changed', { reason: 'escrow_lock', trade_id: newTrade.id }),
    ]).catch(err => console.error('Webhook error:', err));

    return NextResponse.json(
      {
        message: 'Trade initiated successfully. Payment verified on-chain before service release.',
        trade: newTrade,
        code: 'TRADE_CREATED',
        fee_info: {
          item_price: sellerAmount,
          platform_fee: devAmount,
          total_cost: totalCost,
          seller_amount: sellerAmount,
          dev_amount: devAmount,
          dev_wallet: process.env.DEV_WALLET_ADDRESS || process.env.DEV_FEE_WALLET_ADDRESS || process.env.ADMIN_BANKR_WALLET_ADDRESS || null,
          admin_fee_wallet_configured: Boolean(process.env.DEV_WALLET_ADDRESS || process.env.DEV_FEE_WALLET_ADDRESS || process.env.ADMIN_BANKR_WALLET_ADDRESS),
        },
        ...envMeta('clawdmarket/api/trades'),
      },
      { 
        status: 201,
        headers: getRateLimitHeaders(rateLimitResult),
      }
    );
  } catch (error: any) {
    if (error?.message === 'DEV_FEE_MISMATCH') {
      await db.insert(fee_errors).values({
        trade_id: null,
        listing_id: null,
        buyer_id: auth.userId,
        item_price: 0,
        expected_dev_fee: 0,
        actual_dev_fee: 0,
        message: 'Dev fee mismatch — transaction halted',
      });
      return NextResponse.json(
        { ...paymentError('DEV_FEE_MISMATCH', 'Dev fee mismatch — transaction halted'), ...envMeta('clawdmarket/api/trades') },
        { status: 500 }
      );
    }

    if (error instanceof TradeRaceError) {
      const status = error.code === 'LISTING_ALREADY_CLAIMED' ? 409 : 402;
      await logPaymentFailure({
        buyer_id: auth.userId,
        token: 'bnkr',
        route: 'POST /api/trades',
        error_code: error.code,
        message: error.message,
        state: 'no_funds_moved',
      });
      return NextResponse.json(
        { ...paymentError(error.code, error.message), ...envMeta('clawdmarket/api/trades') },
        { status }
      );
    }

    const zodIssues = error?.errors || error?.issues;
    if (zodIssues) {
      return NextResponse.json(
        { error: 'Validation failed', details: zodIssues, code: 'VALIDATION_FAILED', ...envMeta('clawdmarket/api/trades') },
        { status: 400 }
      );
    }
    console.error('Trade creation error:', error);
    await logPaymentFailure({
      buyer_id: auth.userId,
      token: 'bnkr',
      route: 'POST /api/trades',
      error_code: 'INTERNAL_ERROR',
      message: error?.message || 'Internal server error',
      state: 'no_funds_moved',
    });
    return NextResponse.json(
      { ...paymentError('INTERNAL_ERROR', 'Internal server error'), ...envMeta('clawdmarket/api/trades') },
      { status: 500 }
    );
  }
}

function paidCreateTradeRoute(req: NextRequest) {
  return mppx.session({ amount: '0.01', unitType: 'request' })(async (request: Request) => {
    const nextRequest = request instanceof NextRequest ? request : new NextRequest(request);
    return createTradePost(nextRequest);
  })(req);
}

async function attachAndLogPaymentReceipt(response: Response) {
  const receiptHeader = response.headers.get('Payment-Receipt');
  if (!receiptHeader) return response;

  let receipt: Record<string, any> | null = null;
  try {
    receipt = Receipt.deserialize(receiptHeader) as Record<string, any>;
  } catch {
    receipt = null;
  }

  if (receipt) {
    try {
      await db.insert(payment_receipts).values({
        route: 'POST /api/trades',
        amount: MPP_TRADE_EXECUTION_PRICE_USD,
        currency: MPP_CURRENCY_PATH_USD,
        tx_hash: String(receipt.txHash || receipt.reference || '') || null,
        payer_address: String(receipt.payer || receipt.payerAddress || receipt.from || '') || null,
      });
    } catch (error) {
      console.error('Failed to persist payment receipt:', error);
    }
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json') || !receipt) return response;

  try {
    const body = await response.clone().json();
    return NextResponse.json(
      {
        ...body,
        mpp_receipt: receipt,
      },
      {
        status: response.status,
        headers: response.headers,
      },
    );
  } catch {
    return response;
  }
}

export async function POST(req: NextRequest) {
  const response = await paidCreateTradeRoute(req);
  return attachAndLogPaymentReceipt(response);
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cookieToken = req.cookies.get('auth-token')?.value;
  const auth = await authenticateRequest(authHeader || (cookieToken ? `Bearer ${cookieToken}` : null));

  if (!auth) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  try {
    const hasFeeColumns = await tradesHasFeeColumns();

    if (hasFeeColumns) {
      const userTrades = await db
        .select({
          id: trades.id,
          listing_id: trades.listing_id,
          listing_title: listings.title,
          buyer_id: trades.buyer_id,
          buyer_name: users.name,
          seller_id: trades.seller_id,
          amount: trades.amount,
          fee: trades.fee,
          item_price: trades.item_price,
          platform_fee: trades.platform_fee,
          total_cost: trades.total_cost,
          seller_amount: trades.seller_amount,
          dev_amount: trades.dev_amount,
          dev_wallet: trades.dev_wallet,
          fee_tx_hash: trades.fee_tx_hash,
          payout_status: trades.payout_status,
          status: trades.status,
          created_at: trades.created_at,
          completed_at: trades.completed_at,
        })
        .from(trades)
        .leftJoin(listings, eq(trades.listing_id, listings.id))
        .leftJoin(users, eq(trades.buyer_id, users.id))
        .where(or(eq(trades.buyer_id, auth.userId), eq(trades.seller_id, auth.userId)))
        .orderBy(desc(trades.created_at));

      return NextResponse.json({ trades: userTrades, ...envMeta('clawdmarket/api/trades') });
    }

    const legacyTrades = await db
      .select({
        id: trades.id,
        listing_id: trades.listing_id,
        listing_title: listings.title,
        buyer_id: trades.buyer_id,
        buyer_name: users.name,
        seller_id: trades.seller_id,
        amount: trades.amount,
        fee: trades.fee,
        status: trades.status,
        created_at: trades.created_at,
        completed_at: trades.completed_at,
      })
      .from(trades)
      .leftJoin(listings, eq(trades.listing_id, listings.id))
      .leftJoin(users, eq(trades.buyer_id, users.id))
      .where(or(eq(trades.buyer_id, auth.userId), eq(trades.seller_id, auth.userId)))
      .orderBy(desc(trades.created_at));

    return NextResponse.json({ trades: legacyTrades, schema_mode: 'legacy', ...envMeta('clawdmarket/api/trades') });
  } catch (error: any) {
    console.error('Trades fetch error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
