import { NextRequest, NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { createPublicClient, decodeFunctionData, erc20Abi, http, isAddress, parseUnits } from 'viem';
import { base } from 'viem/chains';
import { authenticateRequest } from '@/lib/auth';
import { validateCsrf } from '@/lib/csrf';
import { db } from '@/lib/db';
import { contract_milestones, contracts, listings, trades, transactions, users, wallets } from '@/lib/schema';
import { ensureContractsSchema } from '@/lib/contracts-schema-ensure';

export const dynamic = 'force-dynamic'

async function ensureTradeFeeColumns() {
  const statements = [
    "ALTER TABLE trades ADD COLUMN item_price real DEFAULT 0 NOT NULL",
    "ALTER TABLE trades ADD COLUMN platform_fee real DEFAULT 0 NOT NULL",
    "ALTER TABLE trades ADD COLUMN total_cost real DEFAULT 0 NOT NULL",
    "ALTER TABLE trades ADD COLUMN seller_amount real DEFAULT 0 NOT NULL",
    "ALTER TABLE trades ADD COLUMN dev_amount real DEFAULT 0 NOT NULL",
    "ALTER TABLE trades ADD COLUMN dev_wallet text",
    "ALTER TABLE trades ADD COLUMN fee_tx_hash text",
    "ALTER TABLE trades ADD COLUMN payout_status text DEFAULT 'pending' NOT NULL",
  ];

  for (const sql of statements) {
    try {
      await db.$client.execute(sql);
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (/duplicate column name|already exists/i.test(msg)) continue;
    }
  }
}

const TX_HASH_RE = /^0x([A-Fa-f0-9]{64})$/;
const DEV_FEE_PERCENT = 0.05;
const CONTRACTS_V1_ENABLED = process.env.CONTRACTS_V1 !== 'false';

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function calculateTradeFinancials(itemPrice: number) {
  const platformFee = round2(itemPrice * DEV_FEE_PERCENT);
  const totalCost = round2(itemPrice + platformFee);
  return {
    itemPrice,
    platformFee,
    totalCost,
    sellerAmount: itemPrice,
    devAmount: platformFee,
  };
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cookieToken = req.cookies.get('auth-token')?.value;
  const auth = await authenticateRequest(authHeader || (cookieToken ? `Bearer ${cookieToken}` : null));

  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!authHeader && !validateCsrf(req)) {
    return NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 });
  }

  await ensureTradeFeeColumns();

  try {
    const body = await req.json();
    const listingId = String(body?.listing_id || '').trim();
    const txHash = String(body?.tx_hash || '').trim();

    if (!listingId) return NextResponse.json({ error: 'listing_id required' }, { status: 400 });
    if (!TX_HASH_RE.test(txHash)) return NextResponse.json({ error: 'Invalid tx hash' }, { status: 400 });

    const [existingByTx] = await db.select().from(trades).where(eq(trades.fee_tx_hash, txHash)).limit(1);
    if (existingByTx) {
      return NextResponse.json({ message: 'Trade already reconciled', trade: existingByTx }, { status: 200 });
    }

    const [listing] = await db.select().from(listings).where(eq(listings.id, listingId)).limit(1);
    if (!listing) return NextResponse.json({ error: 'Listing not found' }, { status: 404 });

    const expectedToken = (process.env.BANKR_TOKEN_ADDRESS || process.env.NEXT_PUBLIC_BANKR_TOKEN_ADDRESS || '').trim();
    const expectedEscrow = (process.env.ESCROW_WALLET_ADDRESS || process.env.NEXT_PUBLIC_ESCROW_WALLET_ADDRESS || '').trim();

    if (!isAddress(expectedToken as `0x${string}`) || !isAddress(expectedEscrow as `0x${string}`)) {
      return NextResponse.json({ error: 'On-chain config missing on server' }, { status: 500 });
    }

    const client = createPublicClient({ chain: base, transport: http('https://mainnet.base.org') });
    const tx = await client.getTransaction({ hash: txHash as `0x${string}` });
    const receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` });

    if (receipt.status !== 'success') {
      return NextResponse.json({ error: 'Transaction did not succeed on-chain' }, { status: 400 });
    }

    if (!tx.to || tx.to.toLowerCase() !== expectedToken.toLowerCase()) {
      return NextResponse.json({ error: 'Transaction token does not match BANKR token' }, { status: 400 });
    }

    const decoded = decodeFunctionData({ abi: erc20Abi, data: tx.input });
    if (decoded.functionName !== 'transfer') {
      return NextResponse.json({ error: 'Transaction is not an ERC20 transfer' }, { status: 400 });
    }

    const [to, value] = decoded.args as readonly [`0x${string}`, bigint];
    if (to.toLowerCase() !== expectedEscrow.toLowerCase()) {
      return NextResponse.json({ error: 'Transaction recipient is not escrow wallet' }, { status: 400 });
    }

    const { itemPrice, platformFee, totalCost, sellerAmount, devAmount } = calculateTradeFinancials(listing.price_bankr);
    const expectedAmount = parseUnits(totalCost.toFixed(18), 18);
    if (value !== expectedAmount) {
      return NextResponse.json({ error: 'Transaction amount does not match required total' }, { status: 400 });
    }

    const [user] = await db.select().from(users).where(eq(users.id, auth.userId)).limit(1);
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const sender = tx.from.toLowerCase();
    const syntheticEmail = `wallet_${sender}@wallet.local`;
    if (String(user.email).toLowerCase() !== syntheticEmail) {
      return NextResponse.json({ error: 'Authenticated user does not match transaction sender wallet' }, { status: 403 });
    }

    const devWalletAddress = (process.env.DEV_WALLET_ADDRESS || process.env.DEV_FEE_WALLET_ADDRESS || process.env.ADMIN_BANKR_WALLET_ADDRESS || '').trim();

    const [adminUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, 'admin@clawdmarket.local'))
      .limit(1);

    const adminFeeRecipientUserId = adminUser?.id || null;

    const trade = await db.transaction(async (txdb) => {
      const claimedRows = await txdb
        .update(listings)
        .set({ status: 'sold' })
        .where(and(eq(listings.id, listingId), eq(listings.status, 'active')))
        .returning({ id: listings.id });

      if (claimedRows.length === 0) {
        const [already] = await txdb
          .select()
          .from(trades)
          .where(eq(trades.listing_id, listingId))
          .limit(1);
        if (already) return already;
        throw new Error('Listing already sold and no trade found to attach this tx');
      }

      const [newTrade] = await txdb
        .insert(trades)
        .values({
          listing_id: listingId,
          buyer_id: auth.userId,
          seller_id: listing.seller_id,
          amount: sellerAmount,
          fee: devAmount,
          item_price: itemPrice,
          platform_fee: platformFee,
          total_cost: totalCost,
          seller_amount: sellerAmount,
          dev_amount: devAmount,
          dev_wallet: devWalletAddress,
          fee_tx_hash: txHash,
          payout_status: 'seller_paid',
          status: 'pending',
        })
        .returning();

      await txdb.insert(transactions).values({
        from_user_id: auth.userId,
        to_user_id: listing.seller_id,
        amount: sellerAmount,
        type: 'transfer',
        reference_id: newTrade.id,
        memo: `On-chain escrow payment reconciled (${txHash})`,
      });

      if (devAmount > 0) {
        if (adminFeeRecipientUserId) {
          await txdb
            .update(wallets)
            .set({ balance: sql`${wallets.balance} + ${devAmount}` })
            .where(eq(wallets.user_id, adminFeeRecipientUserId));
        }

        await txdb.insert(transactions).values({
          from_user_id: auth.userId,
          to_user_id: adminFeeRecipientUserId,
          amount: devAmount,
          type: 'fee',
          reference_id: newTrade.id,
          memo: `On-chain dev fee allocation reconciled (${txHash})`,
        });
      }

      return newTrade;
    });

    if (CONTRACTS_V1_ENABLED) {
      try {
        await ensureContractsSchema();
        await db.transaction(async (txdb) => {
          const [contract] = await txdb
            .insert(contracts)
            .values({
              buyer_id: auth.userId,
              seller_id: listing.seller_id,
              listing_id: listingId,
              total_amount: sellerAmount,
              fee_amount: devAmount,
              escrow_amount: totalCost,
              state: 'IN_PROGRESS',
              current_milestone_index: 0,
            })
            .returning();

          await txdb.insert(contract_milestones).values({
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
        });
      } catch (e) {
        console.error('contract creation non-fatal error (reconcile):', e);
      }
    }

    return NextResponse.json({ message: 'Trade reconciled successfully', trade }, { status: 201 });
  } catch (error: any) {
    console.error('Trade reconcile error:', error);
    return NextResponse.json({ error: error?.message || 'Internal server error' }, { status: 500 });
  }
}
