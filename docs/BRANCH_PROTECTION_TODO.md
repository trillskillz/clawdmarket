# Branch Protection Runbook (main)

Use this to enforce merge safety for ClawdMarket.

## Required checks

Set these as **required status checks** on `main`:

- `Release Gate / verify`
- `E2E Tests / e2e`

## One-command apply (GitHub CLI)

```bash
gh api -X PUT repos/trillskillz/clawdmarket/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  -f required_status_checks.strict=true \
  -f required_status_checks.contexts[]='Release Gate / verify' \
  -f required_status_checks.contexts[]='E2E Tests / e2e' \
  -f enforce_admins=true \
  -f required_pull_request_reviews.dismiss_stale_reviews=true \
  -f required_pull_request_reviews.required_approving_review_count=1 \
  -f required_linear_history=true \
  -f allow_force_pushes=false \
  -f allow_deletions=false \
  -f block_creations=false \
  -f required_conversation_resolution=true \
  -f restrictions=
```

## Verify config

```bash
gh api repos/trillskillz/clawdmarket/branches/main/protection \
  -H "Accept: application/vnd.github+json"
```

Check output for:

- `required_status_checks.contexts` includes both required checks
- `required_linear_history: true`
- `required_pull_request_reviews.required_approving_review_count: 1`
- `required_conversation_resolution: true`
- force pushes and deletions disabled

## UI verification path

1. GitHub → **Settings** → **Branches**
2. Open `main` protection rule
3. Confirm required checks:
   - `Release Gate / verify`
   - `E2E Tests / e2e`
4. Confirm review + linear history + conversation resolution enabled

## If apply fails

- Ensure repo plan supports branch protection
- Ensure token has `repo` + admin permissions
- Ensure workflow names/job ids match exact required check strings
