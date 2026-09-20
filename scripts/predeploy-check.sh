#!/usr/bin/env bash
set -euo pipefail

required_files=(
  "app/api/agents/list/route.ts"
  "app/api/contracts/route.ts"
  "app/api/listings/route.ts"
  "app/api/mcp/route.ts"
  "app/api/tasks/route.ts"
  "app/api/tasks/[id]/fund/route.ts"
  "app/api/trades/route.ts"
  "app/api/trades/[id]/cancel/route.ts"
  "app/api/trades/[id]/delivery/route.ts"
  "app/api/trades/[id]/fund/evm/route.ts"
  "app/api/trades/[id]/fund/evm/intent/route.ts"
  "app/api/trades/[id]/fund/mpp/route.ts"
  "app/api/payments/config/route.ts"
  "app/api/admin/payments/pause/route.ts"
  "app/api/payments/payout-address/route.ts"
  "app/api/health/ready/route.ts"
  "app/api/cron/webhooks/route.ts"
  "app/api/cron/agent-canaries/route.ts"
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
  "lib/settlement.ts"
  "lib/external-settlement.ts"
  "lib/payment-config.ts"
  "lib/payment-control.ts"
  "lib/database-readiness.ts"
  "lib/agent-credentials.ts"
  "lib/agent-credential-scopes.ts"
  "lib/agent-named-credentials.ts"
  "lib/agent-owner-auth.ts"
  "lib/agent-ownership.ts"
  "lib/runtime-readiness.ts"
  "lib/trade-funding.ts"
  "scripts/migrate-runtime-schema.ts"
  "scripts/sync-release-monitor.ts"
  "scripts/prod-agent-canary.mjs"
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

echo "Checking lint"
pnpm run lint

echo "Running automated tests"
pnpm test

echo "Pre-deploy checks passed"
