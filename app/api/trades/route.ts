import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { trades, listings, users, wallets, transactions } from '@/lib/schema';
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

const TX_HASH_RE = /^0x([A-Fa-f0-9]{64})$/;

const ECOSYSTEM_FEE_PERCENT = 0.03; // 3% fee

class TradeRaceError extends Error {
  constructor(public readonly code: 'LISTING_ALREADY_CLAIMED' | 'INSUFFICIENT_FUNDS_AT_COMMIT', message: string) {
    super(message);
    this.name = 'TradeRaceError';
  }
}

async function ensureAdminFeeRecipient(): Promise<string | null> {
  const adminWalletAddress = (process.env.ADMIN_BANKR_WALLET_ADDRESS || '').trim().toLowerCase();
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

    // Fetch listing
    const [listing] = await db
      .select()
      .from(listings)
      .where(eq(listings.id, validated.listing_id));

    if (!listing) {
      return NextResponse.json(
        { error: 'Listing not found', code: 'LISTING_NOT_FOUND', ...envMeta('clawdmarket/api/trades') },
        { status: 404 }
      );
    }

    if (listing.status !== 'active') {
      return NextResponse.json(
        { error: 'Listing is not active', code: 'LISTING_NOT_ACTIVE', ...envMeta('clawdmarket/api/trades') },
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

    // Calculate fee
    const fee = validated.amount * ECOSYSTEM_FEE_PERCENT;
    const totalCost = validated.amount + fee;

    const bodyPaymentMode = (body?.payment_mode || '').toString();
    const onchain = body?.onchain || null;

    if (bodyPaymentMode === 'onchain') {
      const expectedToken = (process.env.BANKR_TOKEN_ADDRESS || '').toLowerCase();
      const expectedEscrow = (process.env.ESCROW_WALLET_ADDRESS || '').toLowerCase();
      const expectedFeeWallet = (process.env.DEV_FEE_WALLET_ADDRESS || '').toLowerCase();

      if (!expectedToken || !expectedEscrow || !expectedFeeWallet) {
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
        String(onchain.escrow_wallet || '').toLowerCase() !== expectedEscrow ||
        String(onchain.fee_wallet || '').toLowerCase() !== expectedFeeWallet
      ) {
        return NextResponse.json({ error: 'On-chain payment destination mismatch' }, { status: 400 });
      }

      if (!TX_HASH_RE.test(String(onchain.escrow_tx_hash || '')) || !TX_HASH_RE.test(String(onchain.fee_tx_hash || ''))) {
        return NextResponse.json({ error: 'Invalid on-chain transaction hash format' }, { status: 400 });
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
            amount: validated.amount,
            fee,
            status: 'pending',
          })
          .returning();

        await tx.insert(transactions).values({
          from_user_id: auth.userId,
          to_user_id: null,
          amount: validated.amount,
          type: 'transfer',
          reference_id: trade.id,
          memo: `On-chain escrow transfer (${onchain.escrow_tx_hash})`,
        });

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
            memo: `On-chain fee transfer (${onchain.fee_tx_hash})`,
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
            amount: validated.amount,
            ecosystem_fee: fee,
            seller_receives: validated.amount,
            admin_fee_wallet_configured: Boolean(process.env.ADMIN_BANKR_WALLET_ADDRESS),
          },
          onchain_receipts: {
            escrow_tx_hash: onchain.escrow_tx_hash,
            fee_tx_hash: onchain.fee_tx_hash,
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
      return NextResponse.json(
        {
          error: `Insufficient funds. Cost: ${totalCost} BANKR, Balance: ${buyerWallet.balance} BANKR`,
          code: 'INSUFFICIENT_FUNDS',
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
          escrow: sql`${wallets.escrow} + ${validated.amount}`,
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
          amount: validated.amount,
          fee: fee,
          status: 'pending',
        })
        .returning();

      // Record transaction: Lock funds
      await tx.insert(transactions).values({
        from_user_id: auth.userId,
        amount: validated.amount,
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
            ? 'Marketplace fee (3%) credited to admin wallet'
            : 'Marketplace fee (3%) with no admin wallet configured',
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
        message: 'Trade initiated successfully. Funds locked in escrow.',
        trade: newTrade,
        code: 'TRADE_CREATED',
        fee_info: {
          amount: validated.amount,
          ecosystem_fee: fee,
          seller_receives: validated.amount, // No fee for seller in this model, buyer pays fee
          admin_fee_wallet_configured: Boolean(process.env.ADMIN_BANKR_WALLET_ADDRESS),
        },
        ...envMeta('clawdmarket/api/trades'),
      },
      { 
        status: 201,
        headers: getRateLimitHeaders(rateLimitResult),
      }
    );
  } catch (error: any) {
    if (error instanceof TradeRaceError) {
      const status = error.code === 'LISTING_ALREADY_CLAIMED' ? 409 : 402;
      return NextResponse.json(
        { error: error.message, code: error.code, ...envMeta('clawdmarket/api/trades') },
        { status }
      );
    }

    if (error.errors) {
      return NextResponse.json(
        { error: 'Validation failed', details: error.errors, code: 'VALIDATION_FAILED', ...envMeta('clawdmarket/api/trades') },
        { status: 400 }
      );
    }
    console.error('Trade creation error:', error);
    return NextResponse.json(
      { error: 'Internal server error', code: 'INTERNAL_ERROR', ...envMeta('clawdmarket/api/trades') },
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
        status: trades.status,
        created_at: trades.created_at,
        completed_at: trades.completed_at,
      })
      .from(trades)
      .leftJoin(listings, eq(trades.listing_id, listings.id))
      .leftJoin(users, eq(trades.buyer_id, users.id))
      .where(
        or(
          eq(trades.buyer_id, auth.userId),
          eq(trades.seller_id, auth.userId)
        )
      )
      .orderBy(desc(trades.created_at));

    return NextResponse.json({ trades: userTrades, ...envMeta('clawdmarket/api/trades') });
  } catch (error) {
    console.error('Trades fetch error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
