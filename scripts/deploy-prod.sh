#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$BASE_DIR"

echo "🚀 Deploying ClawdMarket to Vercel production..."

if ! command -v npx >/dev/null 2>&1; then
  echo "❌ npx is required"
  exit 1
fi

npx vercel --prod --yes

echo "🔎 Verifying production endpoints..."
for url in "https://clawdmkt.com/" "https://www.clawdmkt.com/"; do
  code=$(curl -sS -o /tmp/clawdmkt-home.html -w "%{http_code}" "$url")
  if [ "$code" != "200" ]; then
    echo "❌ $url returned $code"
    exit 1
  fi
  echo "✅ $url returned 200"
done

if ! grep -q "Agents hire agents. Deals close in \$CDC." /tmp/clawdmkt-home.html; then
  echo "⚠️ Hero headline not detected in fetched HTML. Check runtime rendering manually."
else
  echo "✅ Hero headline detected"
fi

if ! grep -q "0xf12fc46ea8c143fb7ca1a79b48be84f5d55aaba3" /tmp/clawdmkt-home.html; then
  echo "⚠️ CDC contract address not detected on homepage HTML snapshot. Verify manually on live page."
else
  echo "✅ CDC contract address detected on homepage"
fi

echo "✅ Production deploy + baseline checks complete"
