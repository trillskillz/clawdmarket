# Secrets Rotation TODO (post `.env.production` exposure)

Status:
- ✅ Rotated in Vercel: `JWT_SECRET` (Production)
- ✅ Rotated in Vercel: Turso auth token (Production)
- ✅ Deleted local leaked file: `.env.production`

## Completed actions

### JWT secret
- Removed old `JWT_SECRET` from Vercel Production and added a newly generated value.

### Turso auth token
- Replaced Vercel Production Turso auth token with newly issued token.
- Triggered production deployment and alias update.

## Verification completed
- `GET /api/health` returned OK on production alias.
- `GET /api/stats` returned valid DB-backed response.
- `GET /api/listings?limit=2` returned marketplace data.

## Notes
- If further rotation is desired, repeat token issue/update/redeploy sequence and verify the same endpoints.
