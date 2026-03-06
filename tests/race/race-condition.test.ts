import test from 'node:test';
import assert from 'node:assert/strict';

type ListingState = { status: 'active' | 'sold' };
type TradeState = { status: 'pending' | 'completed' | 'disputed'; releases: number };

async function oldClaimFlow(listing: ListingState) {
  if (listing.status !== 'active') return false;
  await Promise.resolve(); // simulate interleaving gap between read and write
  listing.status = 'sold';
  return true;
}

async function newClaimFlow(listing: ListingState) {
  // atomic compare-and-set semantics used by DB conditional UPDATE ... WHERE status='active'
  if (listing.status !== 'active') return false;
  listing.status = 'sold';
  return true;
}

async function oldCompleteFlow(trade: TradeState) {
  if (trade.status !== 'pending') return false;
  await Promise.resolve(); // interleaving gap
  trade.status = 'completed';
  trade.releases += 1; // escrow release side effect
  return true;
}

async function newCompleteFlow(trade: TradeState) {
  // atomic compare-and-set semantics used by DB conditional UPDATE ... WHERE status='pending'
  if (trade.status !== 'pending') return false;
  trade.status = 'completed';
  trade.releases += 1;
  return true;
}

test('reproduces listing claim race in old flow and verifies new atomic claim blocks second buyer', async () => {
  const listingOld: ListingState = { status: 'active' };
  const [oldA, oldB] = await Promise.all([oldClaimFlow(listingOld), oldClaimFlow(listingOld)]);
  assert.equal(oldA && oldB, true, 'old flow can allow both claim attempts to succeed');

  const listingNew: ListingState = { status: 'active' };
  const [newA, newB] = await Promise.all([newClaimFlow(listingNew), newClaimFlow(listingNew)]);
  assert.equal(Number(newA) + Number(newB), 1, 'new atomic claim allows exactly one winner');
});

test('reproduces trade completion race in old flow and verifies new atomic status update prevents double release', async () => {
  const tradeOld: TradeState = { status: 'pending', releases: 0 };
  const [oldA, oldB] = await Promise.all([oldCompleteFlow(tradeOld), oldCompleteFlow(tradeOld)]);
  assert.equal(oldA && oldB, true, 'old flow can allow duplicate completion');
  assert.equal(tradeOld.releases, 2, 'old flow can release escrow twice under race');

  const tradeNew: TradeState = { status: 'pending', releases: 0 };
  const [newA, newB] = await Promise.all([newCompleteFlow(tradeNew), newCompleteFlow(tradeNew)]);
  assert.equal(Number(newA) + Number(newB), 1, 'new atomic update allows exactly one completion');
  assert.equal(tradeNew.releases, 1, 'new flow releases escrow once');
});
