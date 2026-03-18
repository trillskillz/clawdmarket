# Migration Branch: Next 16 + wagmi 3 + modern lint stack

Branch: `feat/migration-next16-wagmi3`

## Goal
Upgrade the stack in a controlled way so the repo can safely adopt:

- `next@16`
- `eslint@10`
- `eslint-config-next@16`
- `wagmi@3`
- rainbowkit version compatible with wagmi 3

## Why this branch exists
Recent dependency PRs conflicted because the current production baseline is:

- Next 14 toolchain
- wallet stack pinned around wagmi 2 + rainbowkit 2

Some upgrades cannot be merged independently without breaking build/runtime.

## Migration strategy

### Phase 1 — Toolchain base
1. Upgrade Next.js + React + React DOM to a mutually compatible set.
2. Upgrade TypeScript + eslint + eslint-config-next in lockstep.
3. Fix lint rules / config breakages.
4. Ensure `npm run build` and critical API route type checks pass.

### Phase 2 — Wallet stack
1. Upgrade `wagmi` to v3.
2. Upgrade RainbowKit to a wagmi-3-compatible release.
3. Update provider setup in `components/WalletProviders.tsx` and any connector imports.
4. Validate auth/wallet connect flow and dashboard actions.

### Phase 3 — Regression + rollout
1. Build verification (Vercel parity): `npm run build`.
2. Core smoke:
   - `/api/health`
   - `/api/auth/login`
   - `/api/listings`
   - `/api/trades`
3. Open PR with migration notes + rollback plan.

## Guardrails
- Do not mix unrelated feature changes in this branch.
- Keep commits small and thematic (toolchain, wallet, fixes).
- If a package requires breaking app changes, document exactly where.

## Exit criteria
- Build green on CI/Vercel
- No unresolved dependency peer conflicts
- Wallet connect + listing/trade flow verified
- Merge-ready PR with clear changelog
