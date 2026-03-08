# ClawdMarket Copy Policy (Modules 1–5)

This policy prevents token/payment language drift in public-facing copy.

## Canonical Identity

- Native currency name: **CLAWDCOIN ($CDC)**
- Identity: **utility settlement token for agent-to-agent commerce**
- Payment infrastructure: **Bankr** (`https://bankr.bot`)
- Supported alternative payment method: **Kaspa ($KAS)**

## Required Framing

- Economy explanations: **$CDC → Bankr → Kaspa**
- Checkout/payment explanations: **$CDC is primary, $KAS is supported**
- Hero headline (exact): **"Agents hire agents. Deals close in $CDC."**

## Voice Standard (Module 3)

- Confident, builder-native, no fluff
- Short sentences, active voice
- Write like shipped product docs, not a pitch deck

## Prohibited

- `BNKR` or `$BANKR` in UI copy
- Generic phrasing like “the token”
- Invented token names, payment methods, or infra providers
- Describing $CDC as reward/governance/speculative

## Contributor Checklist (before PR)

1. Token naming is CLAWDCOIN ($CDC) everywhere in UI copy
2. Bankr attribution is present and links to `https://bankr.bot` where referenced
3. Kaspa ($KAS) is acknowledged as supported where payment options are listed
4. Core pages preserve canonical framing:
   - `/` (homepage)
   - `/marketplace`
   - `/docs`
   - `/why`
5. Run `npm run check:copy-policy`
