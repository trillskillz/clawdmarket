# Agent and economic lifecycle audit — 2026-10-16

Baseline: fetched main `a17494d5392631c882b1c37fc130421ea6b8a4bb`.
Work stays on local `audit/agent-economic-lifecycle-2026-10-16`.

## Access contract and stop-and-report gates

The current user request authorizes local implementation, disposable tests and
read-only inspection of the named public repository and website. Earlier release
permissions in AGENTS.md apply to their releases, not this audit.

| Boundary | Permitted now | Stop and report before |
| --- | --- | --- |
| Repository | Fetch main; isolated local branch; code, tests, docs | Push, PR publication, merge, release or deployment |
| Public production | Bounded unauthenticated GETs; browser rendering; public assets | Registration, heartbeat, checkout, claim, credential change, funding, job execution or other live mutation |
| Private production | Identify required evidence from source | Reading secrets, using a discovered token, private DB/log queries, backups or authenticated admin calls without a named read scope |
| Local test data | Explicit disposable `/tmp/clawdmarket-workspace-test-*` DB, dummy credentials, test rails | Running a script with inherited/ambiguous DB URL, real RPC signer, payment key or production environment |
| Money and external execution | Disposable fixtures with no real value | Real funds, top-ups, paid model calls, funded live canaries or external work execution |
| Infrastructure/security | Inspect checked-in configuration | Live migrations, security/ownership/payment configuration, rollout flags, account billing or custody changes |
| Visual changes | Read design system; capture public baseline before changes; existing components/tokens | Declaring visual acceptance without rebuilt and compared responsive evidence |
| Market validation | Analyze supplied and public evidence | Prospect contact, real-user email, independent-user enrollment or claiming measured demand without evidence |

At a gate, record the exact blocked action, missing scope/evidence, safety impact,
reviewable artifact and prerequisite for resumption. Continue independent safe
work. Unavailable observations remain unknown, never zero. A failing test blocks
acceptance of its affected capability; do not suppress it or relabel old results.

No production database, runtime-log or private infrastructure access is assumed
from the presence of local credentials, connector access or historical reports.
No production identity or financial data will be copied into a test fixture.

## Evidence status

Investigation and validation are in progress. Historical repository reports are
context, not newly executed acceptance evidence. Findings and gate results
are appended below with commands and artifact locations.

## Continuation — 2026-10-17 (box clone, branch `void/lifecycle-plan-2026-10-17`)

All times CT (UTC-5). Source: the uncommitted omarchy worktree draft
(14 modified files, +264/-35, five untracked files) was exported read-only as a
patch/tarball, applied on a fresh box clone at main `a17494d`, and verified to
match (same file list and diffstat). No omarchy checkout was modified.

### Authorization change recorded

On 2026-10-17 the user asked to complete the plan, verify it, and then publish
to GitHub/Vercel. The user then set a hard rule: **no push, PR, merge or
deployment without their explicit authorization at that point**. All work below
is committed locally only. G1 (publication) remains a stop gate.

### Fresh read-only public production observation (11:45 CT)

Command: `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/google-chrome node
scripts/audit-public-lifecycle.mjs <dir>` — unauthenticated GETs and page renders
only; no registration, heartbeat, checkout or other mutation. Artifacts (30 PNGs +
`public-api.json`) are kept on the box at
`/workspace/evidence-2026-10-17/production-baseline/`; PNGs (~24 MB per capture
set) are not committed to git. The 2026-10-16 `public-api.json` is committed.

| Observation (`/api/stats`, 16:45Z) | Value | Interpretation |
| --- | --- | --- |
| network/marketplace profiles | 223 | discovered + registered public profiles |
| public registered agents | 181 (18 platform_reference + 163 ownership_unverified) | marketplace identities |
| active public registered (`registered_agent_count` legacy alias) | 49 | active subset; alias name is ambiguous but documented in `legacy_aliases` |
| recently online | 15 reference / 0 unverified (16 Oct: 15 / 1) | reference presence is produced by `/api/cron/reference-fleet` every 2 min, not by observed workers |
| independence_verified | 0 | no reviewed independent ownership; not proof of zero demand |
| listings total / active / external-payment-ready | 357 / 84 / 10 | published ≠ purchasable |
| executable reusable services | 0 | no public service currently executable via `/api/services` |
| trades total / completed; volume | 23 / 21; $0.92 (mpp 0.68, evm 0.24); fees $0.02 | 0 independently attributed; 0 trades in 24 h |
| open tasks | 0 | |

Health/readiness 200; enabled rails credit, mpp, evm; ledger disabled; payments
not paused. Renders: 30/30 HTTP 200, fonts loaded, no horizontal overflow, except
`registry-768.png`, which captured loading skeletons and is **not** a valid
baseline for that viewport (capture timing, not a production defect). The sticky
header appears mid-page in full-page captures (capture artifact).

### Evidence map — lifecycle stage → authority → status

| Stage | Authority (source) | Status |
| --- | --- | --- |
| Discovery | `/llms.txt`, `/.well-known/agent.json`, `/api/mcp`, `lib/agent-contract.ts` | observed public (200) |
| Registration | `app/api/agents/register/route.ts` | defect confirmed + fixed (F1) |
| Activation | `activation_mode`, `/claim/{code}`, `agents.status` | verified in tests; default `owner_claim` keeps agents inactive — product friction, not a defect |
| Availability | `agents.last_seen_at`/`is_online` (API activity); new `worker_state`/`worker_last_seen_at` lease | defects confirmed + fixed (F2, F3) |
| Service publication | `listings`, `service_definitions`, `lib/service-definitions.ts` | 0 executable services publicly; root cause not established (needs private data, G3) |
| Buyer discovery | `/api/agents/search`, `/api/services`, `/api/listings` | observed public |
| Authorization/funding | spending policy, `/api/trades`, MPP/EVM/credit rails | not exercised live (G4: real funds) |
| Execution → settlement | trades, work orders, contract workspaces | existing repo tests only; no live trace (G2/G3/G4) |
| Repeat purchase | — | no measurable independent repeats (0 independent trades) |

### Confirmed defects (Deliverable A)

**F1 — non-idempotent registration (high).** `POST /api/agents/register` created
a random `agent_<uuid>` on every call; a lost/timed-out reply led clients to
re-register, producing duplicate economic identities and stranded keys.
Fix: optional `Idempotency-Key` (caller-saved 32 random bytes, 64 lowercase hex).
`lib/agent-registration-replay.ts` derives id and key with domain-separated
peppered HMACs; only the canonical request hash is stored, in the `registered`
lifecycle event. Same key + identical command → 200 `idempotent: true` with the
original identity; different command → 409 `registration_reference_conflict`;
rotated/revoked/archived → 409 `registration_replay_closed` (no credential
returned). Concurrent primary-key races recover the committed row only. Inserts
use one atomic `db.batch`. Tests: four cases in `tests/api/agent-onboarding-e2e.test.ts`
(lost reply, 4× concurrent, conflict/rotation/no name merging, malformed secrets).
Risk: low; the header is optional, existing clients are unchanged. Rollback:
revert the route; replay-created rows are ordinary agents.

**F2 — status/self-test inspection fabricated presence (medium).** Read-only
`GET /api/agents/status` and `/api/agent/self-test` refreshed `last_seen_at`, so
inspecting an agent made it look online. Fix: `recordPresence: false` on those
lookups. Test: readiness case asserts `api_availability: 'unknown'` and null
`last_seen_at` after inspection.

**F3 — API activity conflated with worker availability (medium).** Any
authenticated call counted as "online". Fix: additive nullable columns
`agents.worker_state` / `worker_last_seen_at`; explicit heartbeat body
`{ worker_state: available|busy|stopped }` (default available); 180 s lease;
`lib/agent-presence.ts#agentWorkerPresence` (never_checked_in / available / busy /
stopped / offline / inactive). The reference-fleet cron calls
`recordAgentHeartbeat` without a worker state, so it **does not** create worker
leases. Tests: logic + e2e lease expiry. Behaviour change: a non-JSON heartbeat
body now returns 400 `invalid_heartbeat` (empty body and `{}` still accepted).

**F4 — no machine-readable onboarding state (medium, product).** Agents could not
determine their next permitted step. Fix: `lib/agent-onboarding.ts` projects
existing authorities (no new state machine, nothing persisted) into
`activation_state`, `ownership_state`, `api_availability`, `worker_presence`,
`seller_ready`, `buyer_ready`, structured `blockers` and `next_action`. If the
projection cannot be observed, status still returns identity/claim data with
`readiness_state: 'unavailable'` and `blockers: null` (never an invented "not
ready"). SDK helpers added in TypeScript and Python.

### Hypotheses and evidence gaps (not confirmed)

- H1: 0 executable reusable services because sellers do not complete payout +
  capacity + rollout prerequisites. Needs a private DB read (G3).
- H2: 163 ownership-unverified registrations with 0 recently online suggests
  agents register without running workers; F3 makes this measurable after
  deployment. Not inferable from current counts.
- H3: low trade volume reflects demand/supply rather than a payment defect — no
  failed-checkout evidence is publicly visible; needs private funnel data (G3).

### Migration safety

`2026-10-16-agent-worker-presence-v1` only runs `ensureColumns`, adding two
nullable columns to `agents` (no backfill, rewrite or index). Idempotent;
covered by `tests/logic/runtime-schema-migration.test.ts` (80 migrations).
Old code tolerates the columns, so migrate-then-deploy and code rollback are safe.
