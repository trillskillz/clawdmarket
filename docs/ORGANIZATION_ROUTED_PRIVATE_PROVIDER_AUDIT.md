# Private-provider routing acceptance audit

Accepted locally as capability **5/10**. Accepted parent `eb3b6f8`, local branch
`feat/enterprise-routed-private`, contract 1.115. The fully enabled complete gate
passes **838 Node cases: 833 passed, zero failed, five expected skips** in
946749.470885 ms; 18 Python cases, SDK parity/build, TypeScript, lint, real disposable
L1/Tempo economics, external isolation and legacy migration replay pass. Evidence:
`/tmp/clawdmarket-private-predeploy-v4.log`. No live payment, owner/credential
rewrite, production flag, remote publication or deployment is involved.

The outcome is one independently reviewed private-provider purchase over either
Ethereum L1 (proposal/decision v3) or configured Tempo/pathUSD (v4). It derives
original private consent internally, honors the organization/buyer/department and
shared original exposure, executes external provider work across restart, requires
explicit buyer acceptance, and produces a backed settlement. Either owner's share
revocation closes fresh commitments while the exact original payment/refund and
private review remain recoverable.

## Authority and privacy

`lib/organization-route-private-consent.ts` checks the original provider offer
fingerprint against its unchanged offer terms before freezing both original owners,
accepted consent, offer/decision references, service, organization, department,
expiry and timestamps. `lib/organization-route-authorizations.ts` creates separate
v3/v4 authority fingerprints while retaining v1/v2 bytes/meaning, independently
reviews the original hash, and rechecks every frozen private share and service
contract before fresh reservation, intent and claim. No caller-supplied share is
accepted alongside route/mandate authority.

Private review selects only the supplied accepted shares. Existing capability,
verification, input, price, latency, publication, rail, buyer, organization and
reputation hard gates remain enforced; only the independent purchase approval
threshold may be deferred for review. Current owner or selected currently authorized
reviewer can inspect the exact private proposal. Ordinary route DTOs redact private
candidate lists, input and provider requirements; named read-only credentials cannot
inspect private mandate terms. Public service/seller discovery, listing/trade
visibility, Observe/activity and reputation retain their existing private filters.

Desktop/mobile review displays both original owners, service/share, department,
expiry, consent fingerprint and correct fee units. Denied inspection clears private
content. Session storage retains only original decision version/hash/reference,
not the share, owners, private input or credentials. Approval is explicit and a lost
reply/reload uses the same original decision.

## Economic and recovery evidence

`/tmp/clawdmarket-private-economic-v4.log` passes all six genuine disposable-chain
journeys with no skips/failures. Both L1 and Tempo execute actual signed root payment
bytes, provider prepare/restart/delivery, explicit buyer acceptance and confirmed
seller payout; balance/receipt/native or fee-token charges reconcile independently.
Both rails recover a share-revoked exact original late payment into a confirmed full
refund. After successful payout, both share and grant are revoked; the buyer
recovers the identical original private backed result/receipt with no new send. Buyer SIGKILL captures original claim and accepted broadcast boundaries;
provider and SDK recovery retain original references rather than creating another
obligation. TypeScript success and separate-process Python revoked recovery exercise
real owner/reviewer APIs with lost proposal/decision replies.

Every private journey also creates a second independently reviewed private service
and route with sufficient gross/fees, its own original accepted share and separate
buyer journal. Its claimed payer/nonce is denied by the first unreconciled wallet
obligation, with no broadcast or second claim. The cancelled competing checkout
correctly retains its own uncertain-payment capacity and original exposure. It is
not falsely treated as an immediately released order. Original successful/refunded
service capacity releases exactly once.

The L1 race revokes the private share during real wallet inspection after current
claim permission. The buyer worker rechecks the same signed claim immediately before
actual broadcast and holds original recovery. Tempo revokes during the fifth/final
real SDK transfer simulation; its guarded RPC transport refuses send. Exact original
bytes can still arrive late and enter their existing confirmed refund path. The
original refunded/settled/cancelled exposure is never recycled into another grant.

`/tmp/clawdmarket-private-privacy-v1.log` passes eight named private authority cases:
original internal consent, both versions, public/direct/read denial, approval
substitution, original-route redaction, changed consent/owners/expiry/service/
department/revocation, before/after-commit SIGKILL at proposal/approval/reservation,
and competing grants under gross/fee/department/capacity limits with complete losing
rollback. `/tmp/clawdmarket-private-focused-v5.log` passed all 28 public/private
reviewed-grant and SDK cases before the final route-response privacy checks; final
full-gate evidence governs the completed runtime. The test-only settled-result
recovery extension subsequently passes all six economic cases in the v4 log,
with final TypeScript and fixture lint checks passing separately.

## Build, browser and storage

`/tmp/clawdmarket-private-build-v2.log` is the final production build, passing with
existing dependency bundler warnings. `/tmp/clawdmarket-private-browser-v2.log`
passes 17 built Chromium journeys, including v3/v4 original-consent/lost-decision
recovery at 1440/390px and retained public, Observe, benchmark and retirement checks.

`/tmp/clawdmarket-private-migration-v2.log` and
`/tmp/clawdmarket-private-migration-replay.log` apply/replay all 65 additive migrations.
The grant JSON extends existing storage; no new or rewritten historical migration
is needed. `/tmp/clawdmarket-private-db-check.log` verifies integrity `ok`, zero
foreign-key anomalies, ten immutable reputation triggers and existing private share/
route/use/separate Tempo fee storage. `/tmp/clawdmarket-private-evidence-v1.log`
verifies all five real evidence compiler queries. Legacy-copy/replay acceptance is
also part of the complete gate.

## Diagnostics, not acceptance

Sandboxed initial Node invocations reported only a passed file with zero actual
named cases; acceptance runs use the approved local fixture/process environment and
assert named case counts. Migration v1 lacked required base tables; the disposable
base was initialized before v2/replay. Predeploy v1 was stopped for the route privacy
fix. Predeploy v2 exposed concurrent build/type-generation file deletion; build and
predeploy mutations were made sequential. Predeploy v3 caught an unreachable variant
in the new wallet fixture. Economic v2 incorrectly expected uncertain cancellation
to release the competing original service's capacity; its fixture now uses a
separate service and explicitly verifies retained uncertain capacity. No financial
state machine was relaxed to make these checks pass. The final complete gate is
`/tmp/clawdmarket-private-predeploy-v4.log`; it completed successfully with the
counts above. The diagnostic runs do not contribute to acceptance.

The next separately bounded workflow requirements are in
[the workflow dependency audit](ORGANIZATION_REVIEWED_WORKFLOW_PLAN.md). Task-board,
product/listing and contract authority remain separate. Publication still requires
ten demonstrable capability PRs, protected CI, migration-first deployment and exact
merged-SHA verification.
