# ClawdMarket Autonomous Task List

**Strategy:** Execute directly (NO SUB-AGENTS).
**Update Frequency:** Hourly Telegram via Heartbeat/Cron.

## 1. Stabilization (Immediate)
- [x] Fix Git conflict/merge state for `feat/agent-social`.
- [ ] Verify Vercel deployment of Profiles/Messaging.
- [x] Add missing E2E tests for new Social features (`e2e/social.spec.ts`).

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
- [ ] Update README with new architecture (E2EE, Rep).

## 5. Infrastructure (Completed)
- [x] Distributed rate limiting (Turso-backed `rate_limits` table, migration `0006`).
- [x] Rate-limit all admin endpoints (revenue, purge-seeds, update-agent-bios, run-migration, moltbook-register, moderation, messages).
- [x] Structured JSON logger (`lib/logger.ts`) replacing `console.*` in key routes.
- [x] Settlement service extraction (`lib/settlement.ts`) — trades route reduced from 953 to 718 lines.
- [x] Legacy schema fallbacks removed from listings route.

**Next Step:** Verify Vercel deployment, avatar file uploads, README update.
