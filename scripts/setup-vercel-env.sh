#!/bin/bash
# Run this script to set all wallet env vars in Vercel production
# Usage: VERCEL_TOKEN=your_token bash scripts/setup-vercel-env.sh
#
# Fill in your wallet addresses below before running

VERCEL_TOKEN="${VERCEL_TOKEN:-YOUR_VERCEL_TOKEN_HERE}"
PROJECT="jacob-millers-projects-09998dbb/clawdmarket"

# Your wallet addresses — FILL THESE IN:
TREASURY="0xYOUR_EVM_ADDRESS" # ETH, USDC, MATIC, BNB, etc.
SOLANA="6yVHdDNi9X3BqiQx9VxVfeutxoeaRFhHnQzXF1YQ2fz7" # SOL, USDC SPL, USDT SPL
BITCOIN="bc1qetkagszgdst37k30h4r4x6e2sjnkqds92jkwmv" # BTC on-chain
KASPA="kaspa:YOUR_KASPA_ADDRESS" # KAS
LITECOIN="YOUR_LTC_ADDRESS" # LTC
DOGECOIN="YOUR_DOGE_ADDRESS" # DOGE
XRP="YOUR_XRP_ADDRESS" # XRP
CARDANO="YOUR_CARDANO_ADDRESS" # ADA
POLKADOT="YOUR_DOT_ADDRESS" # DOT
COSMOS="YOUR_COSMOS_ADDRESS" # ATOM
MONERO="YOUR_XMR_ADDRESS" # XMR

set_var() {
 local name=$1
 local value=$2
 if [ -z "$value" ] || [ "$value" = "0xYOUR_EVM_ADDRESS" ] || \
 [[ "$value" == *"YOUR_"* ]]; then
 echo "⏭ Skipping $name (not set)"
 return
 fi
 echo "$value" | npx vercel env add "$name" production \
 --token="$VERCEL_TOKEN" --yes 2>/dev/null && \
 echo "✅ Set $name" || \
 echo "⚠️ Failed to set $name (may already exist — update manually)"
}

echo "🔑 Setting ClawdMarket wallet env vars in Vercel..."
echo ""

# EVM (used for all EVM chains)
set_var "TREASURY_ADDRESS" "$TREASURY"
set_var "NEXT_PUBLIC_TREASURY_ADDRESS" "$TREASURY"
set_var "MPP_RECIPIENT_ADDRESS" "$TREASURY"
set_var "BASE_RECIPIENT_ADDRESS" "$TREASURY"
set_var "NEXT_PUBLIC_BASE_RECIPIENT_ADDRESS" "$TREASURY"

# Solana
set_var "SOLANA_RECIPIENT_ADDRESS" "$SOLANA"
set_var "NEXT_PUBLIC_SOLANA_RECIPIENT_ADDRESS" "$SOLANA"

# Bitcoin
set_var "BITCOIN_RECIPIENT_ADDRESS" "$BITCOIN"
set_var "NEXT_PUBLIC_BITCOIN_RECIPIENT_ADDRESS" "$BITCOIN"

# Others
set_var "KASPA_RECIPIENT_ADDRESS" "$KASPA"
set_var "NEXT_PUBLIC_KASPA_RECIPIENT_ADDRESS" "$KASPA"
set_var "LITECOIN_RECIPIENT_ADDRESS" "$LITECOIN"
set_var "DOGECOIN_RECIPIENT_ADDRESS" "$DOGECOIN"
set_var "XRP_RECIPIENT_ADDRESS" "$XRP"
set_var "CARDANO_RECIPIENT_ADDRESS" "$CARDANO"
set_var "POLKADOT_RECIPIENT_ADDRESS" "$POLKADOT"
set_var "COSMOS_RECIPIENT_ADDRESS" "$COSMOS"
set_var "MONERO_RECIPIENT_ADDRESS" "$MONERO"

echo ""
echo "✅ Done. Redeploy for changes to take effect:"
echo " pnpm build && npx vercel --prod --token=\$VERCEL_TOKEN"
