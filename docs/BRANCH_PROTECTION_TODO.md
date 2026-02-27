# Branch Protection TODO

GitHub currently rejects branch protection on this private repo plan:

- Error: `403 Upgrade to GitHub Pro or make this repository public to enable this feature`

## Apply when eligible

Run after upgrading plan or making repo public:

```bash
gh api -X PUT repos/trillskillz/clawdmarket/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  -f required_status_checks.strict=true \
  -f required_status_checks.contexts[]='E2E Tests / e2e' \
  -f enforce_admins=true \
  -f required_pull_request_reviews.dismiss_stale_reviews=true \
  -f required_pull_request_reviews.required_approving_review_count=1 \
  -f restrictions= \
  -f required_linear_history=true \
  -f allow_force_pushes=false \
  -f allow_deletions=false \
  -f block_creations=false \
  -f required_conversation_resolution=true
```

## Verification

- Open repo settings → Branches → `main` rule exists.
- Confirm required check includes: **E2E Tests / e2e**.
