#!/usr/bin/env bash
set -euo pipefail

required_files=(
  "lib/platform-payment-proofs.ts"
  "lib/historical-mpp-proofs.json"
  "migrations/2026-10-08-contract-account-credit-v1.sql"
  "docs/PAYMENT_PROOFS.md"
  "lib/mcp-route-tasks.ts"
  "migrations/2026-10-04-mcp-routing-tasks-v1.sql"
  "tests/api/mcp-tasks.test.ts"
  "docs/MCP_ROUTING_TASKS.md"
  "lib/a2a-route-tasks.ts"
  "migrations/2026-10-04-a2a-routing-tasks-v1.sql"
  "tests/api/a2a-routing-writes.test.ts"
  "docs/A2A_ROUTING.md"
  "lib/route-control.ts"
  "lib/route-admission-health.mjs"
  "lib/routing-alerts.ts"
  "app/api/admin/routing/pause/route.ts"
  "migrations/2026-10-03-route-admission-control-v1.sql"
  "migrations/2026-10-03-instant-metered-sessions-v1.sql"
  "lib/instant-execution.ts"
  "tests/api/instant-execution.test.ts"
  "docs/INSTANT_EXECUTION.md"
  "lib/route-automation-evidence.ts"
  "migrations/2026-10-03-route-automation-evidence-v1.sql"
  "lib/route-funded-retry.ts"
  "lib/route-retry-reconciliation.ts"
  "lib/route-funding-steps.ts"
  "app/api/routes/[id]/retry/route.ts"
  "migrations/2026-10-03-route-funded-retry-v1.sql"
  "lib/buyer-trade-confirmation.ts"
  "lib/route-lifecycle.ts"
  "app/api/routes/[id]/advance/route.ts"
  "app/api/routes/[id]/result/route.ts"
  "scripts/buyer-route-worker.mjs"
  "migrations/2026-10-03-route-receipts-v1.sql"
  "migrations/2026-10-03-buyer-mpp-payment-claims-v1.sql"
  "lib/buyer-mpp-payment.ts"
  "app/api/trades/[id]/fund/mpp/intent/route.ts"
  "app/api/trades/[id]/fund/mpp/claim/route.ts"
  "scripts/buyer-mpp-worker.mjs"
  "scripts/buyer-tempo-adapter.mjs"
  "lib/account-credit.ts"
  "app/api/wallet/deposits/route.ts"
  "app/api/wallet/transfers/route.ts"
  "app/api/wallet/balances/route.ts"
  "migrations/2026-10-03-backed-account-credit-v1.sql"
  "app/api/agents/list/route.ts"
  "app/api/contracts/route.ts"
  "app/api/listings/route.ts"
  "app/api/services/route.ts"
  "app/api/services/[id]/route.ts"
  "app/api/services/[id]/orders/route.ts"
  "app/api/service-orders/[id]/route.ts"
  "app/api/routes/plan/route.ts"
  "app/api/routes/[id]/execute/route.ts"
  "app/api/routes/[id]/mandate/route.ts"
  "lib/route-payment-mandate.ts"
  "lib/marketplace-mpp-payment.ts"
  "lib/mpp-payment-proof.ts"
  "migrations/2026-10-03-route-payment-mandates-v1.sql"
  "app/api/routes/[id]/route.ts"
  "app/api/spending-policy/route.ts"
  "app/api/mcp/route.ts"
  "app/api/tasks/route.ts"
  "app/api/tasks/[id]/fund/route.ts"
  "app/api/trades/route.ts"
  "app/api/trades/[id]/cancel/route.ts"
  "app/api/trades/[id]/delivery/route.ts"
  "app/api/trades/[id]/verification/route.ts"
  "app/api/trades/[id]/artifacts/route.ts"
  "app/api/trades/[id]/artifacts/[artifactId]/route.ts"
  "lib/verification-jobs.ts"
  "lib/isolated-check-policy.ts"
  "scripts/isolated-verifier.mjs"
  "scripts/verifier-sandbox-launcher.mjs"
  "scripts/verification-worker.mjs"
  "migrations/2026-10-03-private-verification-jobs-v1.sql"
  "app/api/trades/[id]/verification-jobs/route.ts"
  "app/api/verification-jobs/[id]/route.ts"
  "app/api/verification-jobs/[id]/artifact/route.ts"
  "lib/private-artifacts.ts"
  "lib/artifact-crypto.ts"
  "migrations/2026-10-02-private-artifacts-v1.sql"
  "app/api/trades/[id]/fund/evm/route.ts"
  "app/api/trades/[id]/fund/evm/intent/route.ts"
  "app/api/trades/[id]/fund/evm/claim/route.ts"
  "migrations/2026-10-03-buyer-evm-payment-claims-v1.sql"
  "migrations/2026-10-03-buyer-payment-operation-v1.sql"
  "scripts/buyer-worker.mjs"
  "scripts/buyer-wallet-lock.mjs"
  "scripts/buyer-evm-adapter.mjs"
  "app/api/trades/[id]/fund/mpp/route.ts"
  "app/api/payments/config/route.ts"
  "app/api/admin/payments/pause/route.ts"
  "app/api/admin/routing/health/route.ts"
  "app/api/admin/reference-fleet/execution/route.ts"
  "app/api/payments/payout-address/route.ts"
  "app/api/health/ready/route.ts"
  "app/api/cron/webhooks/route.ts"
  "app/api/cron/agent-canaries/route.ts"
  "app/api/cron/reference-fleet-executor/route.ts"
  "app/api/agents/credentials/rotate/route.ts"
  "app/api/agents/credentials/previous/route.ts"
  "app/api/agents/credentials/route.ts"
  "app/api/agents/credentials/[id]/route.ts"
  "app/api/agents/ownership/route.ts"
  "app/api/agents/ownership/transfers/accept/route.ts"
  "app/api/agents/[id]/ownership/recover/route.ts"
  "app/api/agents/[id]/ownership/transfers/route.ts"
  "app/api/agents/[id]/ownership/transfers/[transferId]/route.ts"
  "app/ownership/accept/page.tsx"
  "components/dashboard/AgentOwnershipTab.tsx"
  "app/.well-known/agent.json/route.ts"
  "app/.well-known/mpp.json/route.ts"
  "app/docs/page.tsx"
  "app/marketplace/page.tsx"
  "app/taskboard/[id]/page.tsx"
  "app/work/page.tsx"
  "app/registry/page.tsx"
  "lib/db.ts"
  "lib/request-principal.ts"
  "lib/schema.ts"
  "lib/service-definitions.ts"
  "lib/service-order-state.ts"
  "lib/provider-requirements.ts"
  "lib/provider-evidence.ts"
  "lib/service-funding-eligibility.ts"
  "lib/service-execution-contract.ts"
  "migrations/2026-10-02-buyer-provider-requirements.sql"
  "lib/provider-acknowledgment.ts"
  "migrations/2026-10-02-provider-acknowledgment-deadline.sql"
  "lib/route-planning.ts"
  "lib/route-service-eligibility.ts"
  "lib/route-attempts.ts"
  "lib/route-payment-exposure.ts"
  "lib/route-inspection.ts"
  "lib/route-preview.ts"
  "lib/verification-policy.ts"
  "lib/verification-evidence.ts"
  "lib/capability-performance.ts"
  "lib/buyer-spend-policy.ts"
  "lib/service-order-reservation.ts"
  "lib/routing-feature-flags.ts"
  "lib/settlement.ts"
  "lib/external-settlement.ts"
  "lib/payment-config.ts"
  "lib/payment-control.ts"
  "lib/reference-fleet-control.ts"
  "lib/reference-fleet-executor.ts"
  "lib/database-readiness.ts"
  "lib/agent-credentials.ts"
  "lib/agent-credential-scopes.ts"
  "lib/agent-named-credentials.ts"
  "lib/agent-owner-auth.ts"
  "lib/agent-ownership.ts"
  "lib/runtime-readiness.ts"
  "lib/trade-funding.ts"
  "scripts/migrate-runtime-schema.ts"
  "scripts/reconcile-service-capacity.ts"
  "scripts/sync-release-monitor.ts"
  "scripts/prod-agent-canary.mjs"
  "scripts/provider-worker.mjs"
  "examples/providers/controlled-review.mjs"
  "examples/providers/controlled-private-review.mjs"
  "migrations/2026-09-12-production-settlement.sql"
  "migrations/2026-09-13-bid-counter-offers.sql"
  "migrations/2026-09-19-agent-lifecycle-canary.sql"
  "migrations/2026-09-19-agent-credential-rotation.sql"
  "migrations/2026-09-19-agent-scoped-credentials-ownership.sql"
  "vercel.json"
  "public/agent-spec.json"
  "app/llms.txt/route.ts"
)

for required_file in "${required_files[@]}"; do
  if [[ ! -f "$required_file" ]]; then
    echo "Missing required deployment file: $required_file" >&2
    exit 1
  fi
done

if grep -Fqx '/sdk/' .vercelignore; then
  echo "Vercel build excludes the TypeScript SDK source imported by tests/sdk; remove /sdk/ from .vercelignore" >&2
  exit 1
fi

if command -v rg >/dev/null 2>&1; then
  proxy_has_passthrough() {
    rg -q "startsWith\('/api/'\)|NextResponse\.next\(\)" proxy.ts
  }
  runtime_has_ddl() {
    rg -q "ALTER TABLE|CREATE TABLE IF NOT EXISTS|CREATE INDEX IF NOT EXISTS" app lib \
      --glob '*.ts' --glob '*.tsx'
  }
else
  proxy_has_passthrough() {
    grep -Eq "startsWith\('/api/'\)|NextResponse\.next\(\)" proxy.ts
  }
  runtime_has_ddl() {
    grep -REq --include='*.ts' --include='*.tsx' \
      "ALTER TABLE|CREATE TABLE IF NOT EXISTS|CREATE INDEX IF NOT EXISTS" app lib
  }
fi

if ! proxy_has_passthrough; then
  echo "proxy.ts does not expose the expected API passthrough" >&2
  exit 1
fi

if runtime_has_ddl; then
  echo "Runtime application code contains schema DDL; move it to scripts/migrate-runtime-schema.ts" >&2
  exit 1
fi

echo "Generating Next.js route types"
pnpm exec next typegen

echo "Checking TypeScript"
pnpm run typecheck

echo "Building TypeScript SDK"
pnpm run sdk:build

echo "Checking lint"
pnpm run lint

echo "Running automated tests"
pnpm test

echo "Pre-deploy checks passed"
