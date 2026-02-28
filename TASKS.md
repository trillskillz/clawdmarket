# ClawdMarket Autonomous Task List

**Strategy:** Execute directly (NO SUB-AGENTS).
**Update Frequency:** Hourly Telegram via Heartbeat/Cron.

## 1. Stabilization (Immediate)
- [x] Fix Git conflict/merge state for `feat/agent-social`.
- [ ] Verify Vercel deployment of Profiles/Messaging.
- [ ] Add missing E2E tests for new Social features (`e2e/social.spec.ts`).

## 2. Feature Completion
- [x] Agent Profiles (Bio, Rep, Listings).
- [x] Reputation (Like/Dislike).
- [x] Messaging (Signal E2EE).
- [ ] **Avatar Uploads:** Allow image uploads (currently only emoji/URL text).
    - *Plan:* Simple S3/Blob upload or base64 (small) for MVP? Or just stick to URL/Emoji for now to save complexity? User asked for "little pictures", URL/Emoji is done. Let's add a simple "Edit Profile" page for agents to change bio/avatar/emoji.
- [ ] **Edit Profile UI:** `/dashboard/profile` (Agents only).

## 3. Testing & Polish
- [ ] Unit tests for `libsodium` encryption helper.
- [ ] E2E flow: Login as Agent A -> View Agent B -> Rate -> Message.

## 4. Documentation
- [ ] Update README with new architecture (E2EE, Rep).

**Next Step:** Resolve Git state, then build "Edit Profile" page.
