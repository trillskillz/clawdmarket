## Current progress — 2026-10-15

The corrected listing candidate e55e151 (tested source 9d48c39) passes all complete
local gates: 1,071 Node/24 Python/149 Chromium, expected skips retained, security
publication blocked. Its separate manifest/migration 71 evidence does not bind the
unfinished contract continuation. Contract checkpoints now implement original
DRAFT reference recovery, private credit-only review and generic funding exclusion,
maintenance exclusion and read-only historical use validation (migration 74).
No reviewed funding or acceptance authority is enabled and no capability 9 is
accepted. Next wire shared gross across each existing reviewed family, preserve
consumed inventory, add exact immutable submission/buyer acceptance and original
financial recovery, then finite clients/SDK/private UI and complete genuine
multi-milestone economic and release acceptance. See the current contract audit
and `ORGANIZATION_CONTRACT_CREDIT_EXPOSURE_DESIGN_2026-10-15.md`.

The initial dependency observations below are historical code findings, superseded
by current implementation evidence where stated. Preserve historical financial
semantics, original references and local-only publication policy throughout.

# Next dependency audit: independently reviewed contract purchasing

This is a read-only dependency plan for the milestone after reviewed listing
acceptance. The listing outcome is accepted locally as HTTP 1.119 at source `4cc00d4`; its
complete enabled and browser gates pass (1,064 Node and 149 browser passes). This audit is not another accepted
capability, payment authority, publication permission or change to custody.
The separate contract implementation may now proceed locally. Keep the preserved
`bee652c` dependable-pilot candidate unchanged.

The initial finite contract scope is one original deposited-credit contract and
its bounded ordered milestones, independently reviewed by a selected current
organization reviewer, funded once by its assigned buyer, with explicitly
hash-bound buyer acceptance and original credit release/refund recovery.
Prepaid credit remains nonwithdrawable. Seller receives account credit, not an
external token payout. No withdrawals, new custody, new chain payment rail or
listing/task claim reuse is authorized by this plan.

## Current code findings

The following are code observations at `6ae6dbb`, not claims about deployment:

| Boundary | Current behavior | Required separate reviewed scope |
| --- | --- | --- |
| `app/api/contracts/route.ts` POST | Creates a credit DRAFT and milestones atomically from seller/listing, amounts and relative deadlines. No original request/reference lookup exists. No funds move. | Add bounded saved-reference DRAFT recovery before relying on its ID after an uncertain creation reply. Preserve legacy rows with no fabricated references. |
| `app/api/contracts/[id]/route.ts` fund | Original buyer, CSRF, payment pause, credit readiness, whole-cent milestone/quote reconciliation, buyer/agent/team limits, seller credit preference and original credit lock apply. Linked active listing is claimed atomically. | Independently reviewed exact contract/milestone hash, selected reviewer, buyer/department, expiry and shared original gross authority must also hold inside this transaction. |
| `lib/contract-settlement.ts` | `reserveCredit` debits fee-inclusive backed credit and holds seller principal. Milestone releases/refunds use the original contract reference and escrow deltas. Legacy wallet escrows can finish; new wallet funding is rejected. | Retain this ledger and fee treatment. No EVM/Tempo intent, wallet nonce or marketplace trade can represent this contract. |
| Milestone submit | Seller appends original submission, artifact JSON, finite required-field outcome and report; updates the selected submission by milestone state CAS. Change requests permit another submission. | Persist and recover each exact original submission operation/hash; no replacement computation or new submission after a lost reply without inspecting original state. |
| Milestone approve / mark_paid | Buyer actions are separate. `mark_paid` releases original milestone funds after state transition. Requests do not currently name an expected submission/content hash. | Require explicit authenticated acceptance for the exact current original submission hash before approval/payment. A finite key check cannot authorize payment. |
| `app/api/contracts/maintenance/route.ts` | Funded unstarted expiry refunds original principal; expired review windows automatically move awaiting-review milestones to approved. | Preserve legacy behavior, but reviewed contracts must explicitly exclude time-based acceptance. Maintenance cannot invent exact buyer acceptance. |
| Private GET | Contract and milestones are participant-only; organization review inspection is not implemented. | Current owner and selected reviewer inspect frozen scope only; review authority must not expose private seller submissions or grant buyer spending. |
| Shared accounting | Existing organization contract attributions, buyer policy and backed-credit accounting already exist. Listing/route/workflow/task reviewed use readers do not yet represent independently reviewed contract authority. | Join original reviewed contract gross once with the other reviewed obligations. Cancellation/refunds must not replenish reviewed history. Credit has no chain-fee unit and must never be mixed with wei/pathUSD fee budgets. |

Current original contract/milestone/submission identities and financial references
must survive unchanged. Funding fee treatment and historical refund rights may
not be rewritten as an incidental improvement. In particular, inspect original
fee-inclusive debit, held principal and fees retained on unstarted refunds; show
those exact terms to both participants before creating new reviewed obligations.

## Proposed first boundaries

1. Add optional bounded original creation reference/hash and current-buyer lookup
   for new DRAFTs. Preserve no-reference historical semantics. Normalize relative
   deadlines once at the first creation, never again on replay. Concurrent exact
   creation or a lost HTTP response must recover one DRAFT and one milestone set;
   a changed command with the same reference fails.
2. Introduce a separate `contract-authorizations` resource and a credit-only v1
   authority. Freeze current owner/assigned buyer/department, independent selected
   reviewer, seller, original contract and ordered milestone IDs, amounts, fee,
   escrow, deadlines, finite acceptance specifications and explicit buyer-review
   policy. Reviewer ownership of either participant must fail independence checks.
   This is organizational reviewer separation, not marketplace independence proof.
3. A pending companion blocks its original buyer's generic funding of that exact
   contract. It grants no inventory, seller work, service or listing authority.
   Original public-listing links need explicit cross-scope review: contract DRAFT
   and funding currently share the listing's active/sold inventory. Ensure neither
   consumed reviewed listings nor task/private-service synthetic listings can be
   adopted, including after an edited/reopened catalog status. Do not infer a
   seller's binding rail preference or private delivery agreement from prose.
4. Original assigned buyer consumes approved exact authority and locks backed
   credit in the existing financial transaction. Recheck current reviewer, owner,
   assignment, seller rail, all amounts/deadlines, payment pause, deployment and
   shared limits. Persist one original contract-use ledger, attribution and credit
   reference without a marketplace trade or external claim. Original-reference
   recovery does not re-reserve credit or reopen revocation.
5. Seller submits finite original milestone output with persisted request ID and
   canonical hash. A buyer decision names the original submission ID and content
   hash. Changed/replaced submissions cannot receive a stale decision. Owner and
   reviewer inspection grants no artifact access or acceptance authority.
6. Only explicitly accepted original milestone content may release credit. Exclude
   reviewed contracts from automatic review-window approval while preserving old
   contracts. Failed/inconclusive finite checks remain accurately labeled. Neither
   source URLs nor artifact presence proves semantic correctness or remote execution.
7. Revocation closes fresh funding, not paid fulfillment, valid milestone review,
   disputes or original refunds. Preserve partial payout/refund arithmetic and the
   original credit escrow through restarts. Do not relist/recycle a consumed
   reviewed obligation, replenish reviewed gross after refund or adopt a different
   contract's reservation. Keep legacy wallet recovery exactly scoped to legacy
   funded records.

## Complete outcome and acceptance

Implement in small coherent local checkpoints; a schema or endpoint foundation
does not earn a capability. Demonstrate a genuinely deposit-backed disposable
credit journey with multiple finite milestones, seller/buyer restarts, explicit
exact-submission acceptance, confirmed original ledger releases, partial dispute
and original cancellation/expiry refunds. Seeded unbacked balances, legacy wallet
balances and mocked success flags cannot establish backed credit economics.

Race original creation, independent decisions, funding, competing shared gross
exposure and milestone acceptance/payment in separate processes. Test real
before/after-commit SIGKILL, genuinely lost proposal/decision/creation/funding/
submission/acceptance replies in both SDKs, changed owner/reviewer/department/
quote/deadline/rail, original paid recovery after revocation, and maintenance
past every review deadline without manufactured acceptance or release.

Keep original reference IDs and immutable delivery/financial evidence across
migrations and replay; preserve every old business row, all ten immutable
reputation guards and five actual evidence queries. Require current enabled
application/security/economic gates, both SDKs, responsive private browser review,
production build and source-bound evidence before accepting the outcome. The
existing braces advisory still requires actual remediation or an approved scoped
exception for publication. Existing closed production admission remains closed.
No live funding, global execution flags, custody changes, real-user mail,
synthetic marketplace activity or provider/prospect contact may be performed.
