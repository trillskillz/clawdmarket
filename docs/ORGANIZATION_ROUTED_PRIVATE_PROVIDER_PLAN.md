# Accepted routing capability: explicitly shared private providers

Accepted locally as capability **5/10**, HTTP **1.115**. This document retains the
original dependency requirements below and records their completed acceptance.
[Full acceptance audit](ORGANIZATION_ROUTED_PRIVATE_PROVIDER_AUDIT.md).

Reviewed public-provider L1 and Tempo routes bind original organization, buyer,
department, reviewer, route/candidates, mandate, gross and separate original fee
units. Private direct-service purchases already require a provider-owner offer,
organization-owner acceptance and current buyer/department scope through
`privateProviderAccess`. Those direct-service approvals and credentials do not
grant routed purchasing authority.

The original pre-implementation boundaries were deliberate: `planOrganizationRouteForReview` selects only
public services and public sellers; reviewed route grants reject private services;
`reserveServiceOrder` rejects direct `provider_share_id` alongside a route/mandate.
Remove none of these public boundaries without an independently scoped grant.

The completed capability satisfies these original requirements:

1. A separately versioned owner proposal and independent reviewer decision that
   freeze original accepted share identity/fingerprint, both owners, original
   service contract, department and expiry with route candidates and payment terms.
   Preserve public v1/v2 authority hashes and the original gross/fee accounting.
2. Private candidate inspection for the exact current organization owner and
   selected currently authorized reviewer. Keep discovery, public reputation,
   machine suggestions, Observe, activity and read/viewer credentials private-safe.
   Apply every existing buyer/provider/verification/rail/budget hard gate.
3. Internal reservation evidence from the original reviewed grant, not an arbitrary
   caller-supplied share ID. Atomically recheck the share's accepted consent,
   original owners, service, organization/buyer assignment, department, reviewer,
   grant/mandate, capacity and shared cross-rail gross/fee limits. Recheck fresh
   intent, claim and actual SDK broadcast. Revocation stops fresh commitments while
   original paid proofs/refunds and private backed results remain recoverable.
4. Genuine disposable L1/Tempo execution, separate buyer/provider restart, explicit
   buyer acceptance, confirmed payout and original revoked-share late-payment
   refunds. Prove consent/owner/department/capacity/gross/fee/wallet races and
   before/after-commit SIGKILL rollback/recovery with one original obligation.
5. TypeScript/Python original-reference and lost-decision recovery, private
   desktop/mobile review, public privacy regression, additive migration replay,
   immutable reputation guards, five evidence queries, production build and the
   complete genuine economic/regression gate. Count only after all acceptance.

Broader product/task/workflow authority and independent-provider production proof
retain their separate gates. Publication remains one demonstrable capability per
PR in batches of ten completed capabilities, with protected CI, migration-first
deployment and exact merged-SHA production verification. No live funds or global
execution/payment flags change.

## Accepted implementation

HTTP 1.115 implements explicit private L1 v3 and Tempo v4 grants. Two-owner consent
and original service contracts are frozen and validated internally at reservation
and funding; caller-supplied routed shares remain rejected. Public v1/v2 hashes and
shared gross/native-wei/Tempo fee meanings are preserved. Ordinary route DTOs redact
private candidates/input/provider requirements, and named read-only credentials
cannot inspect private mandate terms. Original owner/reviewer inspection and paid
proof/refund recovery remain available after share revocation.

Focused private authority/privacy/crash/race checks pass eight named cases at
`/tmp/clawdmarket-private-privacy-v1.log`; all 28 reviewed public/private authority
and SDK cases previously passed at `/tmp/clawdmarket-private-focused-v5.log`.
The fully enabled complete gate passes 838 Node cases: 833 passed, zero failed,
five expected skips, plus 18 Python cases, SDK parity/build, TypeScript and lint.
All six final genuine private L1/Tempo economic journeys pass, including revoked
original refunds and settled-result recovery after share/grant revocation.
Production build `/tmp/clawdmarket-private-build-v2.log` and all 17 built desktop,
mobile and public privacy journeys `/tmp/clawdmarket-private-browser-v2.log` pass.
Migration 65/replay, integrity, ten reputation guards and five evidence queries pass.
The next uncounted dependency is
[independently reviewed enterprise workflows](ORGANIZATION_REVIEWED_WORKFLOW_PLAN.md).
