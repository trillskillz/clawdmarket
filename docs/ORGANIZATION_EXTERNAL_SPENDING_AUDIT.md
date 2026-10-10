# Delegated L1 service purchasing acceptance — 2026-10-10

Local HTTP 1.100, additive migration 61, local batch part 2/10. Production stays
at released 1.99 with enterprise/routing writes closed. This capability grants
exact approved direct-service purchasing and payment recovery on Ethereum L1
and Sepolia only. Tempo delegation, other product families, dedicated buyer
clients and production participation retain separate milestones.

## Reviewed boundary

The prior audit found immutable version-1 credit grants, owner-linked assigned
buyers, exact human service approvals and original gross usage; automatic EVM
and Tempo claims belonged exclusively to route mandates. The new implementation
does not turn a credit key into wallet authority or create synthetic routes.
It adds an explicit version-2 grant, frozen configured payment terms and a
separate original transaction claim table. The existing EVM intent/proof
implementation is shared behind unchanged general authentication and a new
account/order-specific spending-key endpoint. Private service/share and approval
attribution stay in the original order/financial transaction.

Only supported legacy/EIP-1559 L1 ERC-20 transfers are accepted. Blob, sponsor,
rollup and batch authority are excluded; fee bounds cannot silently stand in
for unobserved rollup charges. Every original checkout consumes gross USD and
its full gas ceiling, even after cancellation/refund. Current key/owner/buyer/
department/approval/provider/budget/payment controls gate fresh permission.
Signed bytes and exact payer proof are checked before a claim commits. Token
and native reserve floors use the configured RPC, including per-chain overrides,
with a chain identity check. An RPC failure permits no fresh send. Wallet
operators retain their own keys, journal and lock for other wallet activity;
a balance read cannot lock an external wallet or revoke already signed bytes.
Verified late transfers use the original refund path. Confirmed receipts alone
release unresolved wallet claims across enterprise EVM and route EVM/Tempo.
Original buyer credentials preserve recovery after spending-key revocation.

## Accepted evidence

- Full gate: `/tmp/clawdmarket-delegated-evm-predeploy-final.log` — 716 cases,
  711 passed, zero failed, five expected skips; TypeScript, shared SDK generation
  parity/build, 13 Python recovery-client cases, lint, real disposable EVM/Tempo
  workflow economics, verifier isolation and legacy runtime migration replay.
- Actual L1 private service purchase: original 105-cent buyer transfer, 100-cent
  confirmed seller payout, separate provider process/restart, original buyer
  hash-bound review, one payout and one capacity release; private attribution
  remains excluded from public proof after share/key revocation.
- Seven SIGKILL boundaries: before/after intent, claim and verified receipt
  commits, plus after the original on-chain broadcast. Original operation,
  claim/hash, receipt, gross use and refund outbox converge without a replacement
  payment. Late refunds return 105 cents; funded dispute refunds return 100 cents
  and retain the original five-cent marketplace fee.
- Separate worker processes race original approvals against shared gross and
  worst-case gas allowances. One reservation commits; refunded/cancelled
  allowances cannot be recycled. Changed department ceilings, wrong wallet,
  wrong bytes, reserve exhaustion, foreign credentials and incompatible grant
  versions fail closed.
- `/tmp/clawdmarket-delegated-evm-build.log` — production build passed; the
  existing ox/mppx dynamic-dependency and package module warnings remain.
- `/tmp/clawdmarket-delegated-evm-browser.log` — one built Chromium owner journey
  passed, including deposited-credit compatibility, private external terms,
  once-only secret, revocation, foreign/anonymous denial and 390px overflow.
- `/tmp/clawdmarket-delegated-evm-db-check.log` — 61 migrations, SQLite integrity
  ok, zero foreign-key anomalies. Version defaults preserve historical credit
  grants; original read credentials and legacy financial/order rows survive
  migration replay.

## Corrected fixture failures

The broadcast crash fixture initially tried to resend an already-confirmed
transaction; recovery now inspects its original hash. The refund fixture used
the wrong dispute credential/action and initially expected the marketplace fee
to be returned after a funded dispute; both now follow the existing settlement
semantics. Direct reservation races exclude the independent fail-closed HTTP
rate limiter, which can legitimately deny a contending request before economics.
The first full gate had one stale assertion expecting a funding-helper error
for an operation-less body; strict dedicated validation correctly rejects it
earlier. The complete gate above was rerun after correction. Failed intermediate
logs are not acceptance evidence. All chain execution used guarded loopback-only
unforked dummy chains and public fixture wallets; no production payment, provider
independence, mainnet fork compatibility or global rollout is claimed.
