# Human workflow review audit

Acceptance complete locally: P3 human finite-workflow review, publishing counter
**8/10**, existing HTTP **1.98**. The earlier control-plane gap is closed: humans
can review exact private finite DAG terms through the built application, record
an original bounded decision and revoke fresh use while inspecting original
children and unresolved obligations. Existing APIs remain authoritative.

Dashboard Workflow Review accepts a private workflow handle. The current human
buyer/linked owner loads the buyer's exact version-1 proposal with its stable
reference. Bounded JSON loading only makes terms readable; server validation
governs authority. The interface shows gross fee-inclusive cents, retries/attempts,
runtime and chain-fee limits, rail/chain/payer/token/treasury, reserves, private
input, dependency mappings, approved providers and verification. Editing a proposal
clears loaded review and acknowledgment; a different plan hash disables approval.
One explicit acknowledgment and cookie CSRF precede the original immutable POST.
No signatures, activation, preparation, funding, replacement orders or settlement
commands are added. No schema or API authority changes are introduced.

Frozen original decision/contract, graph and token configuration remain inspectable.
Original run review displays actual gross reservations, confirmed refunds/payouts,
unresolved original buyer amount, chain-fee unit/chain/asset and measurement,
original attempt/order/trade IDs and held/released capacity. Revocation only stops
fresh permission; incomplete original work remains incomplete. Known graph drift
preserves original decision/revocation while marking run reconciliation unknown.
Other denied/unavailable reads clear observation and proposal data. Command access
denial also clears proposals. Workflow identity/read generations and 60-second
freshness, rechecked on click, prevent stale commands. Lost or conflicting commands
require manual inspection; no mutation is automatically repeated. Private terms
stay in memory with no storage/query/analytics payload.

Two new built-app cases prove exact human approval, a real committed POST with its
response discarded, one saved decision/no spending, original ID refresh/replay,
separate existing activation, one unpaid child, actual UI revocation with original
$1 exposure/capacity retained, denied fresh children and original child replay.
They also prove competing-decision rejection, graph drift with original revocation,
CSRF, transfer/private-state clearing, new-owner original inspection, sign-out,
stale/unavailable reads, keyboard navigation and mobile overflow. Actual APIs
retain all buyer/provider original proof, delivery, acceptance and refund/payout
recovery. Environment failure modeling is distinct from actual authority checks.
Desktop/mobile screenshots were inspected.

The initial full suite found an existing retry inspection race: parent counters
and the reservation ledger could span another child's committed checkout. Retry
preflight now uses the existing isolated transaction helper for a consistent
snapshot; the callback is read-only and reservation checks remain unchanged.
Ten real independent retry/root process races pass. The full suite still rejects
corrupted exposure and verifies actual disposable-chain crash/refund recovery;
no financial error expectations were relaxed. A shared-client transaction attempt
surfaced SQLite contention and was replaced by the isolated helper. Early browser
acceptance caught an incorrect `active` comparison, now narrowed to authoritative
`approved`/`revoked` states. A concurrent build/typecheck run changed shared Next
type artifacts and was discarded; final build and predeploy ran in sequence.

Final predeploy passes **705 cases: 700 passed, five expected skips**, with real
Anvil dummy funds and enforced external isolation, TypeScript/lint/SDK generation
and build, 12 Python recovery cases, and migration-60 legacy replay. Final production
build passes with the existing MPP/ox warning. The rebuilt browser matrix passes
**35/35 journeys**, no retries/skips, including both new cases. HTTP stays 1.98;
generated SDK contracts are unchanged.

Evidence: `/tmp/clawdmarket-workflow-review-predeploy-accepted.log`,
`/tmp/clawdmarket-workflow-review-build-accepted-final.log`,
`/tmp/clawdmarket-workflow-review-browser-accepted.log`,
`/tmp/clawdmarket-workflow-review-budget-races-final.log` and
`/tmp/clawdmarket-workflow-review-accepted-schema.log`.
Runbook: [WORKFLOW_OWNER_REVIEW.md](WORKFLOW_OWNER_REVIEW.md).
No live wallet funds, production flags, push or deployment. Next: private buyer
route inspection/cancellation recovery over existing owned route APIs. Publishing
remains gated until ten substantive capabilities pass acceptance.
