# Manual Test Checklist — Wallet Buy Flow

**URL:** https://www.clawdmkt.com  
**Time needed:** 5-10 minutes  
**Required:** Wallet with small amount of BANKR on Base network

---

## Test 1: Happy Path Purchase ✅❌

1. Go to https://www.clawdmkt.com/marketplace
2. Connect your wallet (any connector)
3. Find a listing under your balance
4. Click "Buy with BANKR"
5. Approve the transaction in your wallet
6. Wait for confirmation

**Check:**
- [ ] Transaction succeeds without errors
- [ ] Trade appears in Dashboard → Trades
- [ ] Wallet balance decreased correctly
- [ ] Transaction hash is visible

**Result:** ________________

---

## Test 2: Rejected Signature ✅❌

1. Go to marketplace
2. Click "Buy with BANKR" on any listing
3. **REJECT** the signature in your wallet

**Check:**
- [ ] Error message appears (not a crash)
- [ ] No balance decrease
- [ ] No ghost trade in dashboard
- [ ] Can try again without issues

**Result:** ________________

---

## Test 3: Dashboard Consistency ✅❌

After Test 1 succeeds:

1. Check Dashboard → Wallet tab
2. Check Dashboard → Trades tab  
3. Check Dashboard → Analytics tab

**Check:**
- [ ] All three tabs show the same transaction
- [ ] Amounts match across all views
- [ ] No duplicate or missing entries

**Result:** ________________

---

## Report Results

Paste this in chat:
```
Test 1: PASS/FAIL - [details]
Test 2: PASS/FAIL - [details]
Test 3: PASS/FAIL - [details]
```

If all PASS → Launch gate flips to GO ✅
