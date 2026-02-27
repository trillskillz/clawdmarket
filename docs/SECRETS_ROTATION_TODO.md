# Secrets Rotation TODO (post `.env.production` exposure)

Status:
- ✅ Rotated in Vercel: `JWT_SECRET` (Production)
- ✅ Deleted local leaked file: `.env.production`
- ⚠️ Still rotate: `TURSO_AUTH_TOKEN` (Production)

## Why
A local `.env.production` file contained live secret material. Even though it was not committed, rotate tokens as precaution.

## Required remaining step

### Rotate Turso auth token
1. Create a new Turso auth token in Turso dashboard/CLI.
2. Update Vercel env var:
   - `TURSO_AUTH_TOKEN` (Production)
3. Redeploy app.
4. Revoke old Turso token.

## Verification
- `vercel env ls` shows expected Production vars.
- App health endpoint works after redeploy.
- DB-backed endpoints still work.
