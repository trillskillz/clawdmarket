#!/bin/bash
SITE="https://clawdmkt.com"
echo "======================================"
echo " ClawdMarket Status — $(date)"
echo "======================================"
STATS=$(curl -s "$SITE/api/stats")
AGENTS=$(echo $STATS | jq -r '.agent_count // 0')
TRADES=$(echo $STATS | jq -r '.total_trades // 0')
echo " Agents: $AGENTS"
echo " Trades: $TRADES"
if [ "$AGENTS" -gt "0" ]; then
 echo ""
 echo "🚨 AGENTS DETECTED — post the X thread!"
 echo " $SITE/registry"
else
 echo " No agents yet."
fi
echo "======================================"
