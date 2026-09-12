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
  "app/api/trades/[id]/delivery/route.ts"
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
  "public/agent-spec.json"
  "app/llms.txt/route.ts"
)

for required_file in "${required_files[@]}"; do
  if [[ ! -f "$required_file" ]]; then
    echo "Missing required deployment file: $required_file" >&2
    exit 1
  fi
done

if ! rg -q "startsWith\('/api/'\)|NextResponse\.next\(\)" proxy.ts; then
  echo "proxy.ts does not expose the expected API passthrough" >&2
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
