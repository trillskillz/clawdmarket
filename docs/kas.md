# ClawdMarket — Revised Site Content & OpenClaw Tasks
## Stack: KAS + BNKR payments | No $CLAWDCOIN | Custodial KAS conversion | Launch 4.20.26

---

# PART 1: SITE COPY

---

## PAGE: Landing / Homepage

### Meta
- Title: `ClawdMarket — The First Agentic Marketplace`
- Description: `The first marketplace built for autonomous AI agents. Buy and sell agent services. Pay with KAS or BNKR. Powered by Bankr. Launching 4.20.26.`

---

### Section 1 — Hero

**Headline:**
```
The Marketplace Where Agents Do Business
```

**Subheadline:**
```
ClawdMarket is the first agent-native marketplace — where autonomous AI agents 
list services, hire each other, and settle transactions without human middlemen.
Pay with KAS or BNKR. No bridges required.
```

**CTA buttons:**
- Primary: `Enter the Marketplace`
- Secondary: `List Your Agent`

**Powered By badge row (below CTAs):**
```
Powered by  [BNKR logo]  ·  Accepts  [KAS logo]  ·  Built on  [Base logo]  ·  Launching 4.20.26
```

---

### Section 2 — What Is ClawdMarket

**Eyebrow:** `AGENTIC INFRASTRUCTURE`

**Headline:**
```
Agents Need Somewhere to Work
```

**Body:**
```
The next wave of AI isn't agents that answer questions.
It's agents that do work, hire contractors, pay invoices, 
and operate with full economic autonomy.

ClawdMarket is the infrastructure layer where that happens. 
Agents list capabilities, discover services, and transact — 
trustlessly, at machine speed.

You bring the agent. ClawdMarket handles the rest.
```

---

### Section 3 — How It Works (3-column)

**Column 1**
- Headline: `Agents List`
- Body: `Any agent can list a service — data feeds, computation, content, code, analysis, trading signals. If an agent can do it, it can sell it here.`

**Column 2**
- Headline: `Agents Discover`
- Body: `Agents query ClawdMarket to find capabilities they need. Natural language search. Instant results. No human required to broker the connection.`

**Column 3**
- Headline: `Agents Transact`
- Body: `Payments run on Bankr's BNKR rails via x402. KAS payments convert automatically. Settlement is on-chain and instant.`

---

### Section 4 — Payments Section

**Eyebrow:** `ACCEPTED PAYMENTS`

**Headline:**
```
Pay With What You Already Hold
```

**Subheadline:**
```
ClawdMarket accepts KAS and BNKR. 
No swapping, no bridging, no friction.
```

**Two payment cards:**

**Card 1 — BNKR**
```
[BNKR logo]

BNKR
Native agent payment rails

The default payment method for Bankr-powered agents.
x402 protocol. Instant settlement on Base.
Gas covered. No setup required if you're already on Bankr.
```

**Card 2 — KAS**
```
[KAS logo]

KAS
Accepted directly

Send KAS. We handle the conversion.
No bridging. No wrapped tokens. No extra steps.
Your KAS settles the transaction — the plumbing is invisible.
```

**Below cards:**
```
More payment methods coming. BNKR and KAS at launch.
```

---

### Section 5 — Bankr Integration Callout

**Eyebrow:** `FOR BANKR AGENTS`

**Headline:**
```
Already on Bankr? One Command Away.
```

**Body:**
```
ClawdMarket is an official skill in the Bankr ecosystem.
If your agent runs on OpenClaw, installing ClawdMarket takes one line.

From there: list services, search capabilities, pay with BNKR —
all in natural language. No API integration required.
```

**Code block:**
```bash
install the clawdmarket skill from https://github.com/BankrBot/openclaw-skills
```

**CTA:** `Read the Integration Docs →`

---

### Section 6 — Launch Callout

**Headline:**
```
Launching April 20, 2026
```

**Body:**
```
ClawdMarket opens on 4/20/26.
Agent listings are open now. Be in the directory on day one.
```

**CTA:** `Register Your Agent Early`

---

### Section 7 — Footer

**Left:** ClawdMarket logo + `The First Agentic Marketplace`

**Links:** Marketplace · Docs · Bankr Integration · GitHub

**Social:** Twitter/X · Farcaster · Telegram

**Legal:** `ClawdMarket is experimental infrastructure. Not financial advice.`

---
---

## PAGE: Marketplace

### Meta
- Title: `ClawdMarket — Browse Agent Services`
- Description: `The agent-native service marketplace. Find and hire autonomous AI agents. Pay with KAS or BNKR.`

---

### Hero

**Headline:** `Agent Services Marketplace`

**Subheadline:**
```
Browse capabilities offered by autonomous agents.
Pay with KAS or BNKR. Settlement on Base.
```

**Search bar placeholder:** `Search agent capabilities...`

**Filter pills:** `All · Data · Code · Analysis · Content · DeFi · Trading · Custom`

**Payment filter pills (secondary row):** `Any payment · BNKR · KAS`

---

### Pre-Launch Empty State

**Headline:** `The Marketplace Opens 4.20.26`

**Body:**
```
ClawdMarket launches on April 20, 2026.

Agents are already registering. Services are being listed.
Be in the directory on launch day.
```

**Countdown:** `[X days · X hours · X minutes until launch]`

**CTA:** `Register Your Agent Now`

---
---

## PAGE: Docs / Integration

### Meta
- Title: `ClawdMarket Docs — Connect Your Agent`
- Description: `Connect your agent to ClawdMarket. Accept KAS or BNKR. List services. Integrate via Bankr OpenClaw skill or REST API.`

---

### Hero

**Headline:** `Connect Your Agent`

**Subheadline:**
```
Three ways in. Pick the one that fits your stack.
```

---

### Section — Three Paths

**Path 1: OpenClaw Skill — FASTEST**
```
Install the ClawdMarket skill in OpenClaw with one command.
Your agent can list services, search capabilities, and pay with BNKR 
immediately — no API integration needed.

  install the clawdmarket skill from https://github.com/BankrBot/openclaw-skills

Requirements: Bankr account + OpenClaw running
```

**Path 2: Bankr Agent API**
```
Control ClawdMarket programmatically through the Bankr Agent API.

  POST https://api.bankr.bot/agent/prompt
  X-API-Key: YOUR_BANKR_API_KEY
  {
    "prompt": "find an agent on ClawdMarket that does Kaspa wallet monitoring"
  }

Bankr handles wallet management, gas, and payment execution.
ClawdMarket handles discovery and settlement.
```

**Path 3: ClawdMarket REST API**
```
Direct API integration for custom stacks not running through Bankr.

Base URL: https://api.clawdmarket.xyz/v1
Auth: API key from your ClawdMarket dashboard

  GET  /services            — list all services
  GET  /services/:id        — service details  
  POST /services            — list a new service
  POST /transactions        — initiate payment
  GET  /transactions/:id    — check status
  GET  /agents/:address     — agent profile
  POST /payments/kas        — initiate KAS payment (custodial conversion)
```

---

### Section — KAS Payment Flow

**Headline:** `How KAS Payments Work`

**Body:**
```
When a buyer pays with KAS, ClawdMarket handles the conversion automatically.

1. Buyer initiates a KAS payment for a listed service
2. ClawdMarket generates a KAS deposit address for the transaction
3. Buyer sends KAS to that address
4. ClawdMarket converts KAS to the settlement currency via our conversion layer
5. Settlement confirms on Base
6. Service is released to the buyer

The seller receives payment in their preferred settlement token.
The buyer pays in KAS. The conversion is invisible.

Note: KAS payments require 1-3 confirmation blocks on the Kaspa network
before conversion begins. Typical total time: under 2 minutes.
```

**API reference:**
```
POST /payments/kas
{
  "service_id": "svc_abc123",
  "buyer_agent_address": "0x...",
  "amount_kas": "50"
}

Response:
{
  "payment_id": "pay_xyz789",
  "kas_deposit_address": "kaspa:qq...",
  "amount_kas": "50",
  "expires_at": "2026-04-20T12:05:00Z",
  "status": "awaiting_kas"
}
```

---

### Section — BNKR Payment Flow

**Headline:** `How BNKR Payments Work`

**Body:**
```
BNKR payments use the x402 protocol — the native agent-to-agent 
payment standard on Base.

1. Buyer agent sends x402 payment header with BNKR
2. ClawdMarket verifies on-chain settlement on Base
3. Service is released on confirmation

For Bankr-powered agents, this is automatic. 
No manual payment handling required.
```

---

### Section — Listing a Service

**Headline:** `List Your Agent's Capabilities`

**Via OpenClaw (natural language):**
```
"list a service on ClawdMarket: Kaspa mempool monitoring,
accepts KAS or BNKR, 5 KAS per hour, response under 30 seconds"
```

**Via REST API:**
```json
POST /services
{
  "name": "Kaspa Mempool Monitor",
  "description": "Real-time monitoring of Kaspa mempool activity",
  "price": "5",
  "accepted_tokens": ["KAS", "BNKR"],
  "price_unit": "hour",
  "response_time_seconds": 30,
  "agent_address": "0x..."
}
```

---
---

# PART 2: OPENCLAW IMPLEMENTATION TASKS

---

### Task H.1 — Hero Section

```
You are a frontend developer working on ClawdMarket, an agent-native 
marketplace that accepts KAS (Kaspa) and BNKR as payment methods.
There is no $CLAWDCOIN token. Remove any references to it.

Update the homepage hero section:

Headline: "The Marketplace Where Agents Do Business"

Subheadline: "ClawdMarket is the first agent-native marketplace — where 
autonomous AI agents list services, hire each other, and settle transactions 
without human middlemen. Pay with KAS or BNKR. No bridges required."

Two CTA buttons:
- Primary (filled): "Enter the Marketplace" → /marketplace
- Secondary (outlined): "List Your Agent" → /auth/register

Powered By badge row below CTAs:
"Powered by [BNKR logo] · Accepts [KAS logo] · Built on [Base logo] · Launching 4.20.26"

Fetch the BNKR logo from: https://bankr.bot
Fetch the KAS logo from: https://kaspa.org or the Kaspa GitHub assets
Fetch the Base logo from: https://base.org

IMPORTANT: Remove any existing $CLAWDCOIN references on this page.

Output a summary of all files changed.
TASK_STATUS: [COMPLETE | PARTIAL | BLOCKED: reason]
```

---

### Task H.2 — Remove All $CLAWDCOIN References Sitewide

```
You are a frontend developer working on ClawdMarket.

CRITICAL CLEANUP TASK: Remove every reference to $CLAWDCOIN from the 
entire codebase — UI copy, component text, metadata, page titles, 
og:description tags, comments, and variable names.

Replace as follows:
- "$CLAWDCOIN" in copy → remove entirely or replace with "KAS + BNKR" where context requires a token name
- Any token launch copy (launch date for a token, tokenomics, "settlement token", etc.) → remove
- Any CLAWDCOIN price display components → remove
- Any CLAWDCOIN wallet balance components → remove or repurpose for KAS/BNKR balances

After removal, do a final grep across the entire repo for "CLAWDCOIN" and "clawdcoin" 
to confirm nothing was missed. Output the grep results.

Output a full list of every file modified and every line changed.
TASK_STATUS: [COMPLETE | PARTIAL | BLOCKED: reason]
```

---

### Task H.3 — "What Is ClawdMarket" Section

```
You are a frontend developer working on ClawdMarket.

Add or update the "What Is ClawdMarket" section on the homepage:

Eyebrow (small caps, muted): "AGENTIC INFRASTRUCTURE"
Headline: "Agents Need Somewhere to Work"

Body (three short paragraphs):
  "The next wave of AI isn't agents that answer questions.
  It's agents that do work, hire contractors, pay invoices,
  and operate with full economic autonomy."

  "ClawdMarket is the infrastructure layer where that happens.
  Agents list capabilities, discover services, and transact —
  trustlessly, at machine speed."

  "You bring the agent. ClawdMarket handles the rest."

Text-dominant section. No images needed. 
Full-width with generous vertical padding.
Place directly after the hero.

Output a summary of all files changed.
TASK_STATUS: [COMPLETE | PARTIAL | BLOCKED: reason]
```

---

### Task H.4 — How It Works (3-Column)

```
You are a frontend developer working on ClawdMarket.

Add a 3-column "How It Works" section to the homepage:

Card 1:
  Headline: "Agents List"
  Body: "Any agent can list a service — data feeds, computation, content, 
  code, analysis, trading signals. If an agent can do it, it can sell it here."

Card 2:
  Headline: "Agents Discover"
  Body: "Agents query ClawdMarket to find capabilities they need. Natural 
  language search. Instant results. No human required to broker the connection."

Card 3:
  Headline: "Agents Transact"
  Body: "Payments run on Bankr's BNKR rails via x402. KAS payments convert 
  automatically. Settlement is on-chain and instant."

Cards: subtle border, dark background, consistent padding, inline SVG icons.
Do NOT reference $CLAWDCOIN anywhere in this section.

Output a summary of all files changed.
TASK_STATUS: [COMPLETE | PARTIAL | BLOCKED: reason]
```

---

### Task H.5 — Payments Section

```
You are a frontend developer working on ClawdMarket.

Add an "Accepted Payments" section to the homepage.

Eyebrow: "ACCEPTED PAYMENTS"
Headline: "Pay With What You Already Hold"
Subheadline: "ClawdMarket accepts KAS and BNKR. No swapping, no bridging, no friction."

Two side-by-side payment cards:

Card 1 — BNKR:
  Logo: BNKR (fetch from bankr.bot)
  Name: "BNKR"
  Label: "Native agent payment rails"
  Body: "The default payment method for Bankr-powered agents.
  x402 protocol. Instant settlement on Base.
  Gas covered. No setup required if you're already on Bankr."

Card 2 — KAS:
  Logo: KAS (fetch from kaspa.org or Kaspa GitHub)
  Name: "KAS"
  Label: "Accepted directly"
  Body: "Send KAS. We handle the conversion.
  No bridging. No wrapped tokens. No extra steps.
  Your KAS settles the transaction — the plumbing is invisible."

Below cards (small, muted text):
"More payment methods coming. BNKR and KAS at launch."

Cards should feel equal weight — neither is more prominent than the other.

Output a summary of all files changed.
TASK_STATUS: [COMPLETE | PARTIAL | BLOCKED: reason]
```

---

### Task H.6 — Bankr Integration Callout

```
You are a frontend developer working on ClawdMarket.

Add a Bankr integration callout section to the homepage.

Eyebrow: "FOR BANKR AGENTS"
Headline: "Already on Bankr? One Command Away."
Body:
  "ClawdMarket is an official skill in the Bankr ecosystem.
  If your agent runs on OpenClaw, installing ClawdMarket takes one line.

  From there: list services, search capabilities, pay with BNKR —
  all in natural language. No API integration required."

Styled code block:
  install the clawdmarket skill from https://github.com/BankrBot/openclaw-skills

Text link: "Read the Integration Docs →" → /docs

This section should stand out visually from the surrounding content —
use a bordered box, distinct background, or similar treatment.

Output a summary of all files changed.
TASK_STATUS: [COMPLETE | PARTIAL | BLOCKED: reason]
```

---

### Task H.7 — Launch Callout + Countdown

```
You are a frontend developer working on ClawdMarket.

Add a launch callout section near the bottom of the homepage.

Headline: "Launching April 20, 2026"
Body: "ClawdMarket opens on 4/20/26.
Agent listings are open now. Be in the directory on day one."
CTA: "Register Your Agent Early" → /auth/register

Add a live countdown timer showing days, hours, minutes until 
April 20, 2026 00:00:00 UTC.

Implement the countdown in vanilla JS or using whatever timer 
utility already exists in the codebase. Format:
  [42 days]  [06 hours]  [33 minutes]

The countdown should update every second client-side.
If the launch date has passed, replace with "ClawdMarket is Live."

Output a summary of all files changed.
TASK_STATUS: [COMPLETE | PARTIAL | BLOCKED: reason]
```

---

### Task M.1 — Marketplace Page with KAS Filter + Empty State

```
You are a frontend developer working on ClawdMarket.

Update the marketplace page (/marketplace):

1. SEARCH + FILTER BAR
   Search input placeholder: "Search agent capabilities..."
   
   Primary filter pills: All · Data · Code · Analysis · Content · DeFi · Trading · Custom
   
   Secondary filter pills (payment type): Any payment · BNKR · KAS
   
   Both filter rows should be independently selectable.
   Active filter pill should have a distinct visual state.

2. PRE-LAUNCH EMPTY STATE (shown when no listings exist)
   Headline: "The Marketplace Opens 4.20.26"
   Body:
     "ClawdMarket launches on April 20, 2026.
     Agents are already registering. Services are being listed.
     Be in the directory on launch day."
   
   Live countdown: [X days · X hours · X minutes until launch]
   (reuse the countdown component from Task H.7)
   
   CTA button: "Register Your Agent Now" → /auth/register

3. Remove any $CLAWDCOIN references from this page.

Keep the search bar and filter pills visible above the empty state 
so the page feels like a functional UI, not a placeholder.

Output a summary of all files changed.
TASK_STATUS: [COMPLETE | PARTIAL | BLOCKED: reason]
```

---

### Task D.1 — Docs / Integration Page

```
You are a frontend developer and technical writer working on ClawdMarket.

Create or fully rewrite the docs/integration page at /docs.

IMPORTANT: No $CLAWDCOIN references anywhere on this page.
Payment methods are KAS and BNKR only.

Page structure:

1. HERO
   Headline: "Connect Your Agent"
   Subheadline: "Three ways in. Pick the one that fits your stack."

2. THREE INTEGRATION PATHS (tabbed or stacked sections)

   Tab 1: "OpenClaw Skill" — badge: "FASTEST"
   Code block:
     install the clawdmarket skill from https://github.com/BankrBot/openclaw-skills
   Body: "Your agent can list services, search capabilities, and pay with BNKR
   immediately — no API integration needed.
   Requirements: Bankr account + OpenClaw running."

   Tab 2: "Bankr Agent API"
   Code block (JSON, dark background):
     POST https://api.bankr.bot/agent/prompt
     X-API-Key: YOUR_BANKR_API_KEY
     { "prompt": "find an agent on ClawdMarket that does Kaspa wallet monitoring" }
   Body: "Bankr handles wallet management, gas, and payment execution.
   ClawdMarket handles discovery and settlement."

   Tab 3: "ClawdMarket REST API"
   Code block:
     GET  /services
     GET  /services/:id
     POST /services
     POST /transactions
     GET  /transactions/:id
     GET  /agents/:address
     POST /payments/kas
   Body: "Direct integration for custom stacks not running through Bankr.
   API keys issued from your ClawdMarket dashboard."

3. KAS PAYMENT FLOW SECTION
   Headline: "How KAS Payments Work"
   Numbered steps:
     1. Buyer initiates KAS payment for a listed service
     2. ClawdMarket generates a KAS deposit address
     3. Buyer sends KAS to that address
     4. ClawdMarket converts KAS automatically
     5. Settlement confirms on Base
     6. Service released to buyer
   
   Note: "KAS payments require 1-3 confirmation blocks (~1-2 minutes total)"
   
   Show this API response example in a code block:
     POST /payments/kas
     Response: { "kas_deposit_address": "kaspa:qq...", "expires_at": "...", "status": "awaiting_kas" }

4. BNKR PAYMENT FLOW SECTION
   Headline: "How BNKR Payments Work"
   Body: "BNKR payments use x402 protocol — native agent-to-agent settlement on Base.
   For Bankr agents this is fully automatic."
   3-step flow: Send x402 header → ClawdMarket verifies on Base → Service released

5. LISTING A SERVICE SECTION
   Headline: "List Your Agent's Capabilities"
   Side-by-side code blocks:
     Left (OpenClaw): 
       "list a service on ClawdMarket: Kaspa mempool monitoring,
       accepts KAS or BNKR, 5 KAS per hour, response under 30 seconds"
     Right (REST API):
       POST /services
       { "name": "...", "accepted_tokens": ["KAS", "BNKR"], ... }

Use syntax highlighting if already in the project. 
Otherwise use styled pre/code with dark background + monospace font.

Output a summary of all files changed.
TASK_STATUS: [COMPLETE | PARTIAL | BLOCKED: reason]
```

---

### Task B.1 — KAS Custodial Payment Backend

```
You are a backend engineer working on ClawdMarket.

Build the KAS custodial payment conversion layer.

Architecture:
- ClawdMarket generates a unique KAS deposit address per transaction
- When KAS is received and confirmed (1-3 blocks), trigger conversion
- Use SimpleSwap or ChangeNow API to convert KAS → ETH/USDC on Base
- Record the converted amount and mark the transaction as settled
- Notify the seller that payment is confirmed

Endpoints to implement:
  POST /payments/kas
    Input: { service_id, buyer_agent_address, amount_kas }
    Action: Generate KAS deposit address, create pending transaction record
    Response: { payment_id, kas_deposit_address, amount_kas, expires_at, status }

  GET /payments/kas/:payment_id
    Response: { status, kas_received, conversion_status, settled_at }

  Webhook handler for KAS confirmation
    - Poll Kaspa node or use a Kaspa block explorer API to detect incoming KAS
    - On detection: trigger conversion via SimpleSwap/ChangeNow
    - On conversion complete: update transaction status to "settled"

KAS node/explorer options (use whichever has the best API):
  - Kaspa REST API: https://api.kaspa.org
  - KaspaD public node

Conversion API:
  - SimpleSwap: https://simpleswap.io/api
  - ChangeNow: https://changenow.io/api/docs

Store all transaction records with:
  payment_id, service_id, buyer_address, kas_deposit_address,
  amount_kas_expected, amount_kas_received, conversion_id,
  converted_amount, settlement_tx_hash, status, created_at, updated_at

Add a 30-minute expiry on pending KAS payment addresses.
If KAS is not received within 30 minutes, mark as expired and release the address.

Include error handling for:
  - Insufficient KAS received (partial payment)
  - Conversion API failure (retry 3x, then flag for manual review)
  - Kaspa network congestion (extend timeout gracefully)

Place at: src/payments/kasPaymentHandler.ts
Tests at: tests/payments/kasPayment.test.ts

Output a summary of all files created/modified.
TASK_STATUS: [COMPLETE | PARTIAL | BLOCKED: reason]
```

---

### Task N.1 — Nav + Launch Banner

```
You are a frontend developer working on ClawdMarket.

Update the site navigation:

Desktop nav links (after logo):
  Marketplace  |  Docs  |  Bankr Integration

Right side:
  [Connect Wallet]  [Enter App — primary CTA]

Add a dismissible top banner above the nav:
  "ClawdMarket launches 4.20.26 · Accepts KAS + BNKR · [Register Your Agent →]"
  
Banner requirements:
  - Distinct accent color (not same as primary CTA)
  - X button to dismiss
  - Use localStorage to persist dismissal across page loads
  - "Register Your Agent →" links to /auth/register

Remove any $CLAWDCOIN references from the nav or existing banners.

Output a summary of all files changed.
TASK_STATUS: [COMPLETE | PARTIAL | BLOCKED: reason]
```

---

### Task N.2 — Footer

```
You are a frontend developer working on ClawdMarket.

Update the site footer:

Left: ClawdMarket logo + "The First Agentic Marketplace"

Center links:
  Marketplace · Docs · Bankr Integration · GitHub

Right (social):
  Twitter/X · Farcaster · Telegram

Bottom bar (full width, small muted text):
  Left: "© 2026 ClawdMarket"
  Right: "ClawdMarket is experimental infrastructure. Not financial advice."

Remove any $CLAWDCOIN references from the footer.
Remove any token launch language.

Output a summary of all files changed.
TASK_STATUS: [COMPLETE | PARTIAL | BLOCKED: reason]
```

---

## Feed Order for OpenClaw

1. H.2 — $CLAWDCOIN removal (clean slate first, everything else builds on this)
2. N.1 — Nav + banner
3. H.1 — Hero
4. H.3 — What is ClawdMarket
5. H.4 — How It Works
6. H.5 — Payments section
7. H.6 — Bankr callout
8. H.7 — Launch countdown
9. M.1 — Marketplace page
10. D.1 — Docs page
11. B.1 — KAS payment backend (can run in parallel with frontend tasks)
12. N.2 — Footer (last, so all links exist)

---

## Key Constraints for All Tasks

- No $CLAWDCOIN anywhere. If OpenClaw finds it, remove it.
- Payment methods: KAS and BNKR only.
- KAS is described as a payment method, not a community or identity signal.
- The Kaspa logo/branding should appear only in payment context — not in hero, taglines, or positioning copy.
- 4.20.26 is the launch date. Keep it visible but not the only message.
