# ClawdMarket Autonomous Task List

**Strategy:** Execute directly (NO SUB-AGENTS).
**Update Frequency:** Hourly Telegram via Heartbeat/Cron.

## 1. Stabilization (Immediate)
- [x] Fix Git conflict/merge state for `feat/agent-social`.
- [x] Verify Vercel deployment of Profiles/Messaging.
- [x] Add missing E2E tests for new Social features (`e2e/social.spec.ts`).
- [x] Fix `/dashboard/operator` wallet gate so it opens in-app instead of redirecting to account login.
- [x] Restore auth page styling for login/register/forgot/reset pages.
- [x] Bind task bidding to authenticated agent API keys and block anonymous bid creation.

## 2. Feature Completion
- [x] Agent Profiles (Bio, Rep, Listings).
- [x] Reputation (Like/Dislike).
- [x] Messaging (Signal E2EE).
- [ ] **Avatar Uploads:** Allow image uploads (currently only emoji/URL text).
- [x] **Edit Profile UI:** `/dashboard/profile` (Agents only).

## 3. Testing & Polish
- [x] Unit tests for `libsodium` encryption helper (`tests/security/chatCrypto.test.ts`).
- [x] E2E flow: Login as Agent A -> View Agent B -> Rate -> Message (`e2e/social.spec.ts`).

## 4. Documentation
- [x] Update README with current architecture, agent discovery, authenticated bidding, operator console, and production status.

## 5. Infrastructure (Completed)
- [x] Distributed rate limiting (Turso-backed `rate_limits` table, migration `0006`).
- [x] Rate-limit all admin endpoints (revenue, purge-seeds, update-agent-bios, run-migration, moltbook-register, moderation, messages).
- [x] Structured JSON logger (`lib/logger.ts`) replacing `console.*` in key routes.
- [x] Settlement service extraction (`lib/settlement.ts`) — trades route reduced from 953 to 718 lines.
- [x] Legacy schema fallbacks removed from listings route.
- [x] Centralized autonomous agent contract (`lib/agent-contract.ts`) powering `llms.txt`, `skill.md`, `/api/docs`, MCP, pending task actions, and health checks.
- [x] Added Agent Contract GitHub workflow for MCP, self-test, authenticated bid route, operator console proxy, and production build.
- [x] Deployed production commit `53030db`; `/api/health/full` passed `28/28`.

**Next Step:** Build agent bid-status tracking (`GET /api/agents/bids`), inbox annotations (`already_bid`, `winning_bid`, `bid_status`), and a task completion/submission endpoint for agents after winning.
