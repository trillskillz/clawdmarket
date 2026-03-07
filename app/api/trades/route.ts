import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { trades, listings, users, wallets, transactions, fee_errors, contracts, contract_milestones } from '@/lib/schema';
import { authenticateRequest, hashPassword } from '@/lib/auth';
import { createTradeSchema } from '@/lib/validation';
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit';
import { validateCsrf } from '@/lib/csrf';
import { fireWebhook } from '@/lib/webhooks';
import { and, eq, or, desc, sql } from 'drizzle-orm';
import crypto from 'crypto';
import { isAddress } from 'viem';
import { envMeta } from '@/lib/agent-environment';
import { validateAgentInstruction } from '@/lib/agent-security';
import { logPaymentFailure, paymentError } from '@/lib/payment-failure';
import { FALLBACK_LISTINGS } from '@/lib/marketplace-fallback';
import { fallbackAgentForListingId } from '@/lib/fallback-agents';

const TX_HASH_RE = /^0x([A-Fa-f0-9]{64})$/;

const DEV_FEE_PERCENT = 0.05; // 5% fee

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

export async function POST(req: NextRequest) {
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
      const expectedToken = (process.env.BANKR_TOKEN_ADDRESS || process.env.NEXT_PUBLIC_BANKR_TOKEN_ADDRESS || '').trim().toLowerCase();
      const expectedEscrow = (process.env.ESCROW_WALLET_ADDRESS || process.env.NEXT_PUBLIC_ESCROW_WALLET_ADDRESS || '').trim().toLowerCase();

      if (!expectedToken || !expectedEscrow) {
        return NextResponse.json(
          { error: 'On-chain payment is not configured on server' },
          { status: 500 }
        );
      }

      if (!onchain || onchain.chain !== 'base') {
        return NextResponse.json({ error: 'Invalid on-chain payment payload (chain)' }, { status: 400 });
      }

      if (
        String(onchain.token_address || '').toLowerCase() !== expectedToken ||
        String(onchain.escrow_wallet || '').toLowerCase() !== expectedEscrow
      ) {
        return NextResponse.json({ error: 'On-chain payment destination mismatch' }, { status: 400 });
      }

      if (!TX_HASH_RE.test(String(onchain.escrow_tx_hash || ''))) {
        return NextResponse.json({ error: 'Invalid on-chain payment transaction hash format' }, { status: 400 });
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
            fee_tx_hash: onchain.fee_tx_hash || onchain.escrow_tx_hash,
            payout_status: 'seller_paid',
            status: 'pending',
          })
          .returning();

        const [contract] = await tx
          .insert(contracts)
          .values({
            buyer_id: auth.userId,
            seller_id: listing.seller_id,
            listing_id: validated.listing_id,
            total_amount: sellerAmount,
            fee_amount: devAmount,
            escrow_amount: totalCost,
            state: 'IN_PROGRESS',
            current_milestone_index: 0,
          })
          .returning();

        await tx.insert(contract_milestones).values({
          contract_id: contract.id,
          milestone_index: 0,
          title: 'Deliver service output',
          amount: sellerAmount,
          acceptance_spec: JSON.stringify({
            required_artifacts: ['delivery_summary'],
            notes: 'Seller must submit delivery artifacts. Buyer approves/rejects in dashboard.',
          }),
          state: 'ACTIVE',
        });

        await tx.insert(transactions).values({
          from_user_id: auth.userId,
          to_user_id: listing.seller_id,
          amount: sellerAmount,
          type: 'transfer',
          reference_id: trade.id,
          memo: `On-chain escrow payment (single tx: ${onchain.escrow_tx_hash})`,
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
            memo: `On-chain dev fee allocation (single tx: ${onchain.escrow_tx_hash})`,
          });
        }

        return trade;
      });

      Promise.all([
        fireWebhook(auth.userId, 'trade.created', { trade: newTrade }),
        fireWebhook(listing.seller_id, 'trade.created', { trade: newTrade }),
        fireWebhook(listing.seller_id, 'listing.sold', { listing_id: validated.listing_id, trade: newTrade }),
      ]).catch(err => console.error('Webhook error:', err));

      return NextResponse.json(
        {
          message: 'Trade initiated successfully with on-chain BANKR payment.',
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
            payment_tx_hash: onchain.escrow_tx_hash,
            escrow_tx_hash: onchain.escrow_tx_hash,
            fee_tx_hash: onchain.fee_tx_hash || onchain.escrow_tx_hash,
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
          status: 'pending',
        })
        .returning();

      const [contract] = await tx
        .insert(contracts)
        .values({
          buyer_id: auth.userId,
          seller_id: listing.seller_id,
          listing_id: validated.listing_id,
          total_amount: sellerAmount,
          fee_amount: devAmount,
          escrow_amount: totalCost,
          state: 'IN_PROGRESS',
          current_milestone_index: 0,
        })
        .returning();

      await tx.insert(contract_milestones).values({
        contract_id: contract.id,
        milestone_index: 0,
        title: 'Deliver service output',
        amount: sellerAmount,
        acceptance_spec: JSON.stringify({
          required_artifacts: ['delivery_summary'],
          notes: 'Seller must submit delivery artifacts. Buyer approves/rejects in dashboard.',
        }),
        state: 'ACTIVE',
      });

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
