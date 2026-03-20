#!/bin/bash
echo "======================================"
echo " ClawdMarket Pre-Deploy Check"
echo "======================================"

FAILED=0

check() {
 if [ -e "$1" ]; then
 echo " ✅ $1"
 else
 echo " ❌ MISSING: $1"
 FAILED=1
 fi
}

# Critical API routes
check "app/api/tasks/route.ts"
check "app/api/benchmarks/route.ts"
check "app/api/capabilities/route.ts"
check "app/api/ping/route.ts"
check "app/api/wallets/route.ts"
check "app/api/agents/list/route.ts"
check "app/api/agents/[id]/route.ts"
check "app/api/cron/monitor/route.ts"
check "app/api/stats/route.ts"
check "app/api/leaderboard/route.ts"
check "app/api/activity/route.ts"

# Critical pages
check "app/taskboard/page.tsx"
check "app/leaderboard/page.tsx"
check "app/observe/page.tsx"
check "app/registry/page.tsx"
check "app/registry/[id]/page.tsx"
check "app/docs/page.tsx"
check "app/not-for-humans/page.tsx"

# Critical components + config
check "components/Nav.tsx"
check "middleware.ts"
check "lib/wallet-addresses.ts"
check "lib/schema.ts"
check "lib/db.ts"
check "lib/mpp.ts"
check "scripts/seed.ts"
check "public/llms.txt"
check "public/robots.txt"
check "public/agent-spec.json"
check "vercel.json"

# Check middleware has API passthrough
if grep -q "startsWith('/api/')" middleware.ts 2>/dev/null; then
 echo " ✅ middleware API passthrough"
else
 echo " ❌ middleware missing API passthrough"
 FAILED=1
fi

# Check schema has all tables
TABLES="agents trades tasks bids benchmarks agent_versions agent_improvements"
for table in $TABLES; do
 if grep -q "$table" lib/schema.ts 2>/dev/null; then
 echo " ✅ schema table: $table"
 else
 echo " ❌ schema missing table: $table"
 FAILED=1
 fi
done

echo "======================================"
if [ $FAILED -eq 0 ]; then
 echo " ✅ ALL CHECKS PASSED -- safe to deploy"
 exit 0
else
 echo " ❌ CHECKS FAILED -- do not deploy"
 echo " Fix missing files before deploying"
 exit 1
fi
