# Reputation v2 source and consumer audit

Baseline: production main `c574e266b447f97d5f9e007ed47e41471aad7649`, HTTP 1.108.
The supplied plan reviewed the same commit. The local fee/routed draft is saved
separately on `feat/enterprise-chain-fee-coverage`; this branch starts at main.
No later production features were removed. The latest user gate prohibits any
GitHub push or Vercel deployment until observation requirements are met.

| Surface | Baseline source / eligibility | Ordering / issue |
|---|---|---|
| Agent directory, search, profile, trust, user profile | `loadAgentTrustMap`; current backed exact buyer-reviewed public trades; latest eligible feedback per current owner group | Directory newest; search relevance then **cached stars before pagination** |
| Listings API / SSR catalog | same trust reader; `listingFeedbackAggregateSql` | SSR newest; API newest/price, raw eligible stars (`trust_desc`), breadth (`recommended`); missing stable ID ties |
| Registry, marketplace, proof, Observe leaderboard | API/SSR trust fields | Legacy score/confidence shown as earned trust; proof tick reads cached stars |
| Leaderboard | all public agents, strict trust attached before in-memory sort | Rating / completion / legacy trust modes; must label literal legacy modes |
| Ratings endpoints | raw `ratings` joins | Recent and individual public endpoints leak comments/party identity without trade visibility/backing checks |
| Raw rating writes / webhook | party authorization and completed rating window | Cached profile stars include raw feedback; webhook sent to authorized recipient but includes raw review and rater ID |
| Network stats | raw rating AVG | Raw average is not eligible satisfaction |
| Capability / provider requirements | backed capability events + bounded cycles | Completion breadth distinct from quality; requirement checks remain authoritative |
| Router / workflow / MCP / A2A | shared route/provider logic and API contract | Existing failures, refunds, verification and hard gates exist; universal trust must not replace them |
| Old `lib/reputation.ts` | benchmark/velocity heuristic | No imports found in app/lib/scripts/SDK; remove dead implementation |

Positive evidence already requires public visibility, accepted exact delivery,
financial proof and consistency with orders. Refunds/current ownership/reference
and controlled cohorts invalidate eligibility. Four-principal / 256-state cycles
withhold uncertain positives; longer cycles and hidden control remain unknown.
Open disputes and seller-favor resolutions are incorrectly penalized by the
baseline legacy dispute count. Account age affects the legacy heuristic; it must
not enter v2 performance or evidence labels.

Implementation and acceptance evidence will be appended after each phase.

## Local implementation (contract 1.110; publication held)

| Plan phase | Implemented behavior | Evidence |
| --- | --- | --- |
| 1 | Shared SQL filters precede search/listing pagination. Public labels use eligible counts. Open cases and seller-favor outcomes do not become provider failures. Dead universal benchmark heuristic removed. | Reputation API and listing/search/SSR integration tests; desktop/mobile Chromium. |
| 2 | Migration 63 installs immutable transactional transition capture, conservative legacy backfill, unique decision roots and superseding chains. Original-reference concurrent replay, appeals and financial-resolution correlation are enforced. | Migration/idempotency test; transactional rollback, concurrent decision and immutable event tests. |
| 3 | Service/canonical-leaf/mode/frozen-contract scopes, broad-history labels, dated symmetric group caps, within-group satisfaction means, denominators, unknown attribution, deadline coverage, version continuity and separate instant observations. | Pure model invariants; real database scope and four-rail evidence tests; instant execution tests. |
| 4 | Existing four-principal/256-state exclusion retained. A separate bounded worker persists private review signals for longer rings, reciprocal work, repeats and new-account clusters. Reviewed/appealed signals confer no financial or score authority. | Existing multi-rail cycle tests plus longer-ring queue/replay and screening bound tests. |
| 5 | All existing hard gates precede three explicit shadow suggestion modes. Unproven records remain separate. Minimum required-leaf support, stable ties, numeric prices and truthful 500-candidate truncation apply. Default execution ordering remains the compatibility policy. | Ranking/requirement invariants; provider execution/reservation/funding rechecks; read-only suggestion endpoint tests. |
| 6 | Additive public API/SSR/UI records, private review UI, TS/Python clients, generated contract/OpenAPI/MCP/A2A guidance, private health aggregates and versioned policy/runbook. Public ratings/webhooks withhold buyer IDs and review bodies. | SDK recovery/contract tests, privacy integration tests, health protection test, public and private browser flows. |

All financial/authorization state machines remain authoritative. Captured facts
cannot accept a delivery, release escrow, bypass funding, increase a limit or
promote a ranking. The separate routed purchasing draft remains excluded.

## Migration and coverage

The fresh disposable rehearsal applies all 63 runtime migrations, compiles the
four production evidence-query shapes, and builds the production application.
The minimal legacy fixture starts with one completed financial trade, no seller
column, no ratings table, and no trustworthy completion date. Upgrade adds the
missing nullable party/date columns and empty feedback table, then records
exactly one conservative backfill observation: unknown terminal date, no
performed capabilities, no public eligibility and unknown deadline coverage.
A second migration invocation records no duplicate. Ten immutability triggers
protect events, adjudications, screening runs/cases and review chains.

Actual Unix-second, millisecond and ISO timestamps are normalized; missing dates
remain missing. A dedicated epoch-second terminal capture test prevents a date
from disappearing through SQLite `unixepoch` coercion. Public records distinguish
actual outcome freshness from latest captured-event timestamp. Scoped records
report same-service work withheld because performed scope is unknown. Captured
ownership and current ownership can tighten grouping; transfer/unlink cannot
reset known historical related-party evidence.

Legacy numerical fields retain their units and compatibility heuristic. The v2
model does not inherit account age, cached stars, amount-weighted votes or peer
quality claims. Private work is excluded as a whole job. Historical capability
events remain readable under the legacy eligibility policy; new events require
frozen performed scope. No new credit is inferred for an unknown legacy bundle.

## Required adversarial matrix

| Supplied case | Coverage |
| --- | --- |
| 1 zero/adverse-only | Pure model zero/null/unknown/adverse test; API zero-history fields. |
| 2 twenty repeat transactions | Group-cap invariant; API repeated owner-alias feedback and completion test. |
| 3 repeat failures/severity | Symmetric failure cap and serious finding retention across decay. |
| 4 earlier dissatisfaction | Weighted within-group review mean; API two-review history. |
| 5 dispute/seller-favor neutrality | Reasoned decision/resolution tests, contradictory seller-favor rejection. |
| 6 one job/multiple failure facts | Immutable transition/rollback and deduplicated terminal model tests. |
| 7 corrected first pass | First-pass operational evidence separate from accepted terminal observation. |
| 8 payment delay | Pending/unknown model and exact external funding/payout eligibility tests. |
| 9 buyer/platform/goodwill/provider | Structured responsibility truth table, appeal and explicit correction tests. |
| 10 cached stars/pagination | Search boundary and live listing/SSR ordering tests; Chromium. |
| 11 retry/concurrency | Unique source revision, rollback, concurrent append/replay and original SDK request tests. |
| 12 current invalidation | All four rails; refunds, original receipt mismatches, ownership and current party/owner administrative bans. |
| 13 historical ownership | Captured related work remains excluded after transfer; historical group continuity. |
| 14 rings/exhaustion | 2/3/4/5-principal and 256-state tests; bounded longer-ring screening and exhaustion. |
| 15 reciprocal commerce | Explicit conservative short-cycle policy; private review/appeal queue without accusations. |
| 16 frozen performed scope | Bundle/unrelated capability/version rejection and routed requested-capability freezing. |
| 17 finite checks/authority | Separate typed instant/schema/benchmark observations; no semantic quality or spending grant. |
| 18 new-provider hard minimums | Explicit unavailable/breadth/fault/case requirements; read-only endpoint preserves minimums. |
| 19 privacy | Public individual/recent/user feedback, historical private visibility, webhook redaction and private health access. |
| 20 compatibility/unavailable | Existing field/contract assertions, versioned null model, unavailable records and health protection failure. |
| 21 ties/truncation/money | Stable suggestion ties and disclosed candidate bound; existing owned-chain/authorization gates plus no-persistence suggestion test. |

## Shadow and real coverage

[Controlled shadow report](REPUTATION_V2_SHADOW_FIXTURES.json) compares a pinned
legacy router formula against all three suggestion modes, with changed positions,
established-provider presence and new-provider visibility. Scenarios include
repeat customers, new cheap providers, adverse-only work, difficult mixed work,
outages, stale history and a six-member ring. This is explicitly synthetic. It
cannot establish calibration or representative production behavior.

[Read-only public inventory](REPUTATION_V2_PUBLIC_COVERAGE.json), checked
2026-10-11, reports production HTTP 1.108, zero active reusable services, 21
network completed trades and $0.92 recorded volume. None of the 45 public agents
in that response has eligible accepted-work/review counts. Public aggregate
network counters are not original scoped outcome evidence. The inventory does
not provide original fault decisions, historical owner links or performed
contracts, and it contains no private identity data.

**Ranking promotion remains closed.** Representative real scoped
candidate/outcome comparisons, classification and exclusion review, privacy,
latency, stale/unavailable rates and reviewer acceptance remain outstanding.
No synthetic outcome fills that gap. The user's latest explicit instruction
allows publication after passing release checks without real observations.
Publication/migration acceptance is recorded separately below; no ranking
promotion or live wallet spend is authorized by this release.
See [the runbook](REPUTATION_V2_RUNBOOK.md) for the next permitted steps.

## Validation record

All results below are local checks on disposable data, using Node 24.21.0 and
owned loopback-only Anvil/Tempo nodes. They prove implementation behavior and
do not establish representative production observations.

| Check | Accepted result and artifact |
| --- | --- |
| Complete `pnpm predeploy` | **784 cases: 779 passed, zero failed, five expected skips**, 676785 ms; Next route generation, TypeScript, generated SDK parity/build, Python 18 cases, lint, real disposable economics and isolated verifiers. `/tmp/clawdmarket-reputation-v2-predeploy-v4.log` |
| Final affected-area regression | **98/98 passed**, zero skips, 19677 ms; capability evidence, provider hard requirements, reputation evidence, instant calls, contract and ranking. Includes current party/known-owner moderation invalidation. `/tmp/clawdmarket-reputation-v2-final-focused-v3.log` |
| Economic/reputation recovery regression | **127/127 passed**, zero skips, 349343 ms; real private approved EVM/Tempo purchases, funding/settlement, genuine SQLite read-lock contention, original challenge races, read-only suggestions and SDK recovery. `/tmp/clawdmarket-reputation-v2-corrections-v4.log` |
| Final Python recovery client | **18/18 passed**, including bounded legacy public agent identifiers and exactly one original appeal PATCH on lost response. `/tmp/clawdmarket-reputation-v2-python-v3.log` |
| Final production build | Passed with TypeScript validation; existing optional MPP/ox bundler warning remains. `/tmp/clawdmarket-reputation-v2-build-v5.log` |
| Final real Chromium | **2/2 passed**, zero retries, 6.9 s, against the final production build; public live API/SSR backing/ownership invalidation and private rejected-request correction/finding/original-seller appeal. Both cover 390 px layouts. `/tmp/clawdmarket-reputation-v2-browser-v8.log` |
| Fresh migration rehearsal | All **63** runtime migrations applied; full-suite legacy fixture also proves conservative unknown backfill and second-run idempotency. `/tmp/clawdmarket-reputation-v2-migration-v3.log` |
| Evidence SQL compatibility | All **four** production query shapes compile: buyer feedback, backed reputation, marketplace ranking and capability backing. `/tmp/clawdmarket-reputation-v2-evidence-query-v4.log` |
| Private aggregate health | [Controlled local coverage](REPUTATION_V2_LOCAL_COVERAGE.json): 15 sampled providers, zero unavailable/stale projections, 10 immutable triggers. Explicitly synthetic; no production health claim. |

The five inherited full-suite skips concern four retired unbacked-credit task
cases and an optional Base Sepolia wallet test. Required owned disposable
asset-backed EVM/Tempo/credit execution and recovery checks passed. No live funds
were used.

Earlier attempts are diagnostic, not accepted release gates: minimal fixture
schema/backfill and old contract-text assumptions were corrected; globally
enabling WAL weakened the suite's required SQLite read-lock scenario and was
removed. A new ban fixture initially omitted its mandatory creation timestamp;
the corrected fixture passed the final 98-case rerun without weakening eligibility
or financial assertions. The final shared positive-eligibility moderation change
and Python identifier compatibility correction received focused reruns after the
full release run had begun; the final production build and Chromium use the final
code. `git diff --check` is clean.

The subsequent full Chromium sweep exposed a legacy cycle fixture without frozen
performed scope/exact ledger parties, checkout locators racing nonempty initial
SSR data, an obsolete profile label, and genuine mobile overflow from long
unbroken service titles. The fixture now records the same agreed contract and
exact ledger parties as production; checkout targets its mocked service; profile
assertions use the evidence label; service cards wrap long words. Runtime
eligibility and layout assertions remain strict. The final private health response
separates authorized publication from the still-closed ranking promotion gate.
Instant service DTOs retain instant scope instead of being labelled contracted.

The protected read-only promotion workflow and its aggregate report are additional
acceptance tooling. They replay original public requests under actual production
configuration, apply current hard gates, and disclose missing comparable candidate
sets, unavailable/stale scopes, bounded coverage, and required review. A workflow
success is distinct from `promotion_ready`; neither it nor local fixtures grant
ranking or spending authority.

Post-override acceptance: **41/41** endpoint/economic cases passed, including
the no-write/no-private-identity promotion assessment and instant service feed;
**26/26** Chromium cases passed with zero retries, covering every broad-sweep
failure plus public/private reputation and site navigation. Typecheck and lint
passed. Logs: `/tmp/clawdmarket-reputation-v2-promotion-focused-v3.log`,
`/tmp/clawdmarket-reputation-v2-browser-corrections.log`. The audit CLI rehearsal
produces `/tmp/clawdmarket-reputation-v2-local-promotion-report.json`, explicitly
`production_source=false` and `promotion_ready=false`; it is controlled fixture
evidence only. The final full protected CI will cover the updated release commit.

The final configuration-head CI additionally caught `SQLITE_BUSY` during the
department's pre-transaction organization-lock lookup. That local-file lookup now
uses disposable read clients and six bounded read retries, closing every failed
statement before retry. Remote production reads and all financial operations stay
on their original paths; the read guard never retries a financial callback.
The deterministic exclusive-read-lock recovery and existing two-process
department ceiling/capacity race pass in **12/12** cases. Genuine lock exhaustion
invokes no financial operation; recovery invokes it once; a callback's own busy
error is propagated once. `/tmp/clawdmarket-reputation-v2-budget-contention.log`.

The user initially reconfirmed **“Keep the observation requirement”**, then
explicitly superseded it on 2026-10-11: **“go ahead and push as long as everything
is working as intended, observation isnt a requirement.”** Protected publication
is authorized after required checks; default ranking remains shadow-only and
uncalibrated. No production deployment is claimed until exact-SHA acceptance.


Final contention follow-up: protected CI exposed a second pre-transaction read
race in payment controls, and repeated local stress exposed the native prepared
COMMIT lock leak documented in
https://github.com/tursodatabase/libsql-js/issues/240. Closing a failed client
alone does not resolve that native bug. A pinned pnpm patch uses native `exec`
for local transaction COMMIT in both CommonJS and ESM, preserving error mapping,
rollback and pool release. Remote Turso transactions are unaffected. Disposable
bounded read recovery is shared by organization inspection and payment controls;
financial callbacks remain outside the read retry. Operator pauses still fail
closed after read recovery.

The explicit blocked-COMMIT test recovers exactly one original order, capacity,
department use and immutable trade evidence. The four real contention checks
(independent processes, exhausted/recovered organization inspection, paused
payment reads and blocked COMMIT) passed **32/32** across eight fresh-process
stress rounds. Logs: `/tmp/clawdmarket-reputation-v2-budget-patched-stress-1.log`
through `-8.log`. Typecheck and lint passed. Complete predeploy checks are rerunning
with the pinned dependency; no production deployment or promotion is claimed yet.
The patch should be removed only after a compatible stable upstream fix passes
these same regressions; do not substitute global WAL or forced garbage collection.


## Protected production assessment and deployment repair (2026-10-12 UTC)

PR #257 passed every required head check (743 unit passes, 45 hosted skips, nine
MCP passes, 79 browser passes, nine guarded browser skips) and merged as
`2ac9771`. Final owned local predeploy passed 783/788 cases with zero failures and
five expected skips; all type/lint/SDK/Python/build checks passed.

Production deployment run 38176269055 passed its release gate, current rail
reserve checks, additive migration 63 and release-monitor synchronization. It
stopped safely before publication: buyer feedback, backed reputation and market
sorting compiled through the real transport; capability backing returned
`SQLITE_UNKNOWN`. The focused repair replaces correlated table-valued JSON scope
checks with exact scalar probes over the documented twenty-capability bound.
Invalid/non-array/oversized scopes cannot grant proof. All original acceptance,
backing, ownership, historical-affiliation, moderation and bounded-cycle gates
remain. Compiler diagnostics permit only fixed schema identifiers or the static
parser-stack error, never arbitrary transport messages, URLs or evidence rows.

The real protected promotion assessment, run 38192851839, reports healthy public
projections (25 sampled, zero stale/unavailable, ten immutable guards, 443 ms),
23 eligible public work units, zero active public reusable services, zero scoped
terminal estimates, and zero comparable candidate sets. Three original requests
could not be replayed; the repair reports closed buyer rollout separately. This
is not representative scoped outcome or ranking evidence. `promotion_ready`
remains false. No flags, funds, classifications or default ranks were changed.

Focused backing/scope/cycle/privacy/provider-policy/model checks passed **73/73**,
including exact scope membership at index twenty and exclusion of malformed or
oversized scope while retaining original raw evidence. All four local production
query shapes compile. Logs: `/tmp/clawdmarket-reputation-v2-production-compatibility-final.log`
and `/tmp/clawdmarket-reputation-v2-query-compatibility-fixed.log`. The protected
production compiler and final CI must still pass before Vercel publication.

The audit reporting follow-up passed **44/44** final capability/privacy cases;
typecheck and lint passed. The final query also compiles with the official
SQLite 3.42 parser as well as the current native driver. Remote transport
acceptance remains an explicit protected deployment gate, not inferred from
these local results. Snapshot: `docs/REPUTATION_V2_PRODUCTION_ASSESSMENT_2026-10-12.json`.

The repair's initial hosted run 38194106287 exposed a separate `SQLITE_BUSY`
failure in the seller payout lookup before reservation. All remaining pure
reservation preflight lookups now use the existing bounded, disposable local
read guard. Payout wallet and agent-address fallbacks honor the supplied read
client or transaction. Expiry, fee-recipient writes, financial transactions and
authoritative budget/capacity checks remain outside this read-only retry.
Twenty fresh processes passed all five lock/rollback/preflight cases each:
**100/100**, zero failures or skips. A new exclusive-lock regression also checks
both payout fallbacks against uncommitted transaction state and confirms no
order is created by inspection. Logs:
`/tmp/clawdmarket-reputation-v2-all-preflight-stress-{1..20}.log`.
