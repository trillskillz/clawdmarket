# Next enterprise routing capability: independently reviewed Tempo authority

Status: accepted locally as capability **4/10**, branch
`feat/enterprise-routed-tempo`, accepted retirement parent `3839c32`. Contract 1.114,
additive migration 65. Publication follows the user's ten-capability PR cadence;
no production funds, flags or deployment changed.

The accepted L1 route grants are version 1, bind the
`organization-route-authority-v1` hash and consume `maximum_gas_cost_wei`.
`organizationRouteInput`, `organizationRoutePurchaseEvidence`,
`validateOrganizationRouteAuthority` and `consumeOrganizationRouteExposure`
intentionally permit Ethereum L1 only. Accepting Tempo by removing those checks
would misstate fee units and alter historical authority.

The general route mandate already supports explicit Tempo fee-token terms;
delegated direct-service Tempo purchasing already preserves the original SDK
challenge, exact root transaction claim, shared wallet exclusion and revoked
original-payment refund recovery. Those are prerequisites to reuse, not grants
for the new routed purchase.

The next capability requires:

1. A separately reviewed versioned routed grant for configured chain 4217 and
   six-decimal pathUSD. Freeze original route objective/input/candidates, current
   owner-linked buyer, organization/team/cost center, independent reviewer,
   immutable mandate, token/payer/treasury, token and fee reserve floors, expiry,
   per-payment and lifetime fee-token ceilings, one attempt and zero paid retries.
   Preserve version-1 hashes, original L1 inspections and their native-wei meanings.
2. Additive storage for distinct fee-token observations and original use; share
   daily/monthly/lifetime gross across original L1 and Tempo grants for the same
   organization and buyer. Reserve fee exposure in its original chain/token/unit.
   Settlement, cancellation and refunds cannot replenish original gross or fees.
3. Atomic review/use/order/capacity/department consumption and current authority
   checks at fresh reservation, intent, claim and the actual guarded SDK broadcast.
   Existing direct-service/read credentials retain their scopes. Original revoked
   claims and proofs remain recoverable without a replacement signature or send.
4. Genuine disposable Tempo selection, buyer and provider process restart,
   explicit buyer acceptance, confirmed seller payout, original late full refund,
   charged failed-refund evidence and receipt/balance reconciliation. Independent
   approval/wallet/gross/fee races and SIGKILL at original commit/broadcast boundaries
   must preserve one obligation and completely roll back losing reservations.
5. Private owner/reviewer desktop/mobile review, both clients' lost-response and
   original-decision recovery, full EVM/Tempo regression checks, generated contract
   parity, production build, legacy migration replay, immutable reputation guards
   and five evidence queries. Count only after the complete usable outcome passes.

Paid production canaries, production Tempo fork compatibility, representative
reputation calibration and independent providers retain their recorded prerequisites.
The user's ten accepted capability PR publication cadence remains authoritative.

## Current implementation

Version 2 proposals use `max_lifetime_fee_token_cost_units` and require one configured
chain-4217 pathUSD execution, its explicit fee token, both reserves and the original
per-payment fee ceiling. Approval decisions match the original authority version.
Version-1 terms and authority fingerprints retain their original bytes/meaning.

`organization_route_tempo_fees` stores immutable-scope fee exposure separately;
common route uses retain gross across both rails and zero native-wei exposure for
Tempo. Consumption atomically binds both records, original mandate, economic order,
capacity and department limits. Missing fee evidence fails fresh funding. Original
revoked payments, exact claims and financial recovery use the existing state machine.

Private reviewer pages display Tempo fee-token units and preserve v2 decisions after
lost replies. TypeScript proposals/inspection support both versions; Python calls
retain exact JSON references. No existing direct-service key gains route authority.

Focused authority, process/crash, migration and SDK checks pass 21 cases at
`/tmp/clawdmarket-enterprise-tempo-focused-v2.log`. Final acceptance is recorded below.

## Accepted local evidence

The complete gate at `/tmp/clawdmarket-enterprise-tempo-predeploy-v2.log` passed
824 Node cases: 814 passed, zero failed, ten skipped, plus 18 Python tests,
TypeScript, generated SDK parity/build and lint. Five opt-in isolation cases were
then explicitly enabled and all passed in
`/tmp/clawdmarket-enterprise-tempo-isolation-final.log`. Therefore 819 distinct
Node cases are verified; only the four retired legacy-credit cases and the
unconfigured Base Sepolia wallet case remain expected skips. The omitted isolation
flag and initial missing shared test database were test setup diagnostics, not
accepted skip exceptions.

The full run passes actual disposable L1/Tempo economic transfers, independent
buyer/provider restart, before/after-commit SIGKILL, department/gross/fee/wallet
races, exact claimed-byte and original challenge recovery, explicit buyer
acceptance, confirmed seller payout and original revoked-payment full refunds.
Actual token balances reconcile confirmed funding/payout/refund fees. The shared
processor's genuine reverted Tempo refund records its charged fee without claiming
refund completion or issuing a replacement transfer. Missing Tempo use evidence
fails fresh funding and retains original gross. Financial/verification/storage
state machines and the public reputation hard gates remain authoritative.

Independent new-Tempo economic proof passes both journeys in
`/tmp/clawdmarket-enterprise-tempo-economic-v6.log`; those also pass in the complete
gate. Twenty-one focused authority/process/crash/migration/SDK cases pass in
`/tmp/clawdmarket-enterprise-tempo-focused-v2.log`.

Production build passes at `/tmp/clawdmarket-enterprise-tempo-build-v1.log`.
Thirteen built Chromium journeys pass at
`/tmp/clawdmarket-enterprise-tempo-browser-v1.log`: desktop/mobile Tempo original
v2 decision recovery and explicit confirmation; L1 owner/reviewer inspection,
revocation and lost replies; private benchmark recovery; public surfaces; Observe
chronology and caller-only wallet privacy; recursive-retirement APIs and legacy UI.

Migration 65 and replay pass in `/tmp/clawdmarket-enterprise-tempo-migration-v1.log`
and `-migration-replay.log`. Post-browser read-only storage checks at
`/tmp/clawdmarket-enterprise-tempo-db-check.log` confirm 65 migrations, integrity
`ok`, zero foreign-key anomalies, all ten immutable reputation guards and the
three original/additive route tables. All five compiler evidence queries pass at
`/tmp/clawdmarket-enterprise-tempo-evidence-v1.log`.

Continue separately reviewed private-provider routed authority using
[the next dependency plan](ORGANIZATION_ROUTED_PRIVATE_PROVIDER_PLAN.md).
Audits and intermediate foundations do not increment the capability count.
