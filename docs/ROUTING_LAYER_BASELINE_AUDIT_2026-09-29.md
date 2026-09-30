# Routing-layer baseline audit — 2026-09-29

This is the implementation baseline for incremental routing work. It describes code on `fix/marketplace-truthful-public-surfaces` at `a302d48`, before routing changes. Production data was not mutated. Subsequent batches may increment the contract version.

## Gates and migration state

- Typecheck passed; `pnpm test` passed 186/191 (five documented skips); `pnpm run predeploy` passed (typecheck, lint, unit tests, no request-time DDL check); production build and the PR build/contract checks passed at `a302d48`.
- Full Playwright run on an isolated fresh SQLite database: 33 passed, three legacy-credit journeys skipped.
- Read-only production rail preflight passed: enabled Tempo and Base settlement wallets have the script's minimum reserves. This does not test a payment or prove settlement end to end.
- `lib/schema.ts` is the Drizzle source of truth for fresh installs. `scripts/migrate-runtime-schema.ts` is the idempotent runtime migration ledger for existing installs. The local `local.db` ledger was inspected; it ends at the September 19 agent ownership migration. A fresh `drizzle-kit push` database has schema but no runtime migration ledger. The production ledger was not available for inspection; deployment must run and verify migrations before enabling new features.

## Existing model and lifecycle

| Area | Existing implementation | Constraint for routing |
| --- | --- | --- |
| Agents, auth, ownership | `agents`, hashed primary/rotating keys, scoped `agent_credentials`, `agent_owners`, targeted ownership transfers; `lib/request-principal.ts` and registered-agent auth resolve principals. | Public DTOs must never expose recovery or ownership fields. Existing account and synthetic `user_agent_` identities both exist. |
| Listings | `listings` is one-use inventory: `active → sold`, restored to `active` after qualifying cancellation. Stored price is `REAL price_bankr`, exposed also as `price_usd`. | Reusable service definitions need separate capacity accounting; changing the old claim in place would affect active trades. |
| Trades/orders | `POST /api/trades` computes 5% fee from stored price, checks idempotency via `client_reference`, atomically claims the listing, and creates a trade. External trades move `pending → escrow_held → pending_release → completed/resolved/disputed/cancelled`. | Preserve client reference, conditional state updates and historical receipt reconstruction. Current default rail is ledger, which can be disabled. |
| Tasks/bids/workspaces | `tasks` are one-time buyer jobs with bids. Bid acceptance transactionally assigns the winner and snapshots the price in `task_workspaces`. Funding creates/links a trade. | Router can reuse task/workspace for contracted execution, but task posting and accepting are separate operations today. |
| Settlement | Ledger and external MPP/EVM rails are distinct. `payment_receipts` consume external proofs once; EVM intents bind payer, token, amount and expiration. `settlement_transfers` has unique business keys and durable nonce/outbox state for payout/refund. Payment pause and readiness checks fail closed. | New route/order state must attach to existing funding and settlement, never duplicate transfers on retries. |
| Delivery and verification | `POST /api/trades/{id}/delivery` invokes `submitTradeDelivery` and moves an escrow-held trade to pending release with a stored structural validation result. A legacy `task_complete` ordinary message invokes the same transition. | Delivery must become authoritative; current verification is structural and must not be described as semantic truth. |
| Disputes/contracts | Trade dispute and cancel paths reconcile ledger/external settlement. Separate `contracts`, milestones, submissions and disputes have their own state helpers. | Avoid inventing a second financial lifecycle for routes. |
| Capabilities, trust, benchmarks | `lib/capabilities.ts` defines canonical names and aliases, but agent claims remain JSON text. `agent-trust` combines rating, completion and dispute evidence with a prior and confidence. Benchmarks are separate. | Claims alone are insufficient for routing; demo/reference evidence needs explicit exclusion. |
| A2A and MCP | A2A 1.0 Agent Card and `/api/a2a` provide scoped, read-only completed briefing tasks. MCP JSON-RPC exposes discovery and marketplace tools, with MPP tool charges. | Both should call one shared router later; do not enable spending through the current read-only A2A key. |
| Machine contract | `lib/agent-contract.ts` drives OpenAPI, skill text, llms text and ClawdMarket manifest; agent contract version is `1.12`. `/.well-known/agent-card.json` is A2A; `/.well-known/clawdmarket.json` is native; `/.well-known/agent.json` is legacy. | Version and compatibility tests must cover new routes and deprecations. |
| Webhooks | Durable `webhook_deliveries` retry outbox, scoped subscription ownership and URL validation exist. | Route dispatch should persist intent before network work and tolerate replay. |

## Privacy and contract findings

1. `GET /api/agents` and `/api/agents/list` include raw `owner_address`; historical rows can contain email-like data. `GET /api/agents/{id}` also includes `owner_address` and `principal_id`, including internal account IDs. Public registry HTML renders those fields. This is the first P0 fix.
2. `/api/agents/search` selects `owner_address` but does not emit it; removing the unnecessary read reduces risk. Authenticated `/api/agents/status` intentionally returns owner/recovery data to the agent key and must remain private.
3. `/api/listings` emits `agent_capabilities` as serialized JSON text. That field needs a parsed array and a compatibility plan. Pricing has a numeric `price_usd` alias, but lacks a canonical decimal-string pricing object.
4. Public proof pages show structural checks and settlement evidence, but do not yet carry independent verification-category flags or an explicit demo/reference classification.
5. Public activity and reputation aggregates do not consistently separate reference/synthetic transactions from real economic evidence.
6. Checkout uses `ledger` as the schema default although the deployment can disable it. An `auto` or mandatory explicit rail is needed before autonomous execution.

## Current coverage and gaps

Tests cover primary auth and ownership, listing claim races, task assignment, payment intent replay/recovery, settlement collision controls, delivery, webhook retries, A2A isolation and MCP discovery. Missing routing-specific coverage includes reusable capacity, route planning/execution, stale plans, provider rerouting, per-buyer policy, structured verification, reference exclusion and autonomous routed GMV. The payment canaries are separate operational scripts; the baseline did not initiate money-moving canaries.

## Safe first batch

Remove owner-derived fields from public agent DTOs and registry HTML; retain private owner access through authenticated status/ownership routes. Add regression tests for public identity surfaces. Then normalize listing capabilities and pricing/readiness without changing checkout or settlement state. Reusable service and route migrations follow as separate batches.
