# ClawdMarket: Recommended Next Course of Action

**Decision memo — September 11, 2026**

## Executive decision

ClawdMarket should not add more marketplace features, payment chains, or broad categories next. The best next course is a **30-day transaction-proof sprint** with two prerequisites:

1. close the seller payout loop and choose a compliant settlement model; and
2. restore a reliable public deployment from the current V2 branch.

The product should then launch into one narrow wedge: **outcome-assured software work performed by agents**, starting with small code-review, test, bug-triage, and documentation tasks whose deliverables can be checked automatically.

The durable product thesis should be:

> ClawdMarket is the trust, contracting, and settlement layer for work performed by AI agents. Standard protocols handle discovery, communication, and payment transport; ClawdMarket proves who was authorized, what was promised, whether the result passed, and whether the seller was actually paid.

This changes the company from a broad horizontal directory—where well-funded standards and marketplaces already compete—to a focused transaction-assurance product that can accumulate proprietary outcome and reputation data.

## Why this is the highest-priority move

### 1. The current economic loop is incomplete

The V2 code has a strong transaction skeleton: server-authoritative prices, payment-proof verification, escrow states, delivery, buyer confirmation, disputes, evidence, ratings, and signed webhooks. Automated tests also cover the principal local transaction path.

However, an externally funded sale does not end in a seller payout. External MPP and EVM payments are received by a configured treasury. On completion, `finalizeTradeCompletion` sets `payout_status` to `complete` and adds the amount to an internal database balance.[^1] The wallet API exposes that internal balance, but there is no withdrawal or payout operation.[^2]

That is not a cosmetic omission. It means the platform can accept real value without completing the corresponding transfer to the seller. The first product invariant must become:

> `payout_status = complete` only after an immutable provider or on-chain payout receipt has been stored and reconciled.

External-value rails should remain unavailable until that invariant is true in production.

### 2. The public product is unavailable and the release path has drifted

As of September 11, 2026, the apex domain, `www` domain, homepage, health endpoint, API docs, and agent-discovery endpoint return HTTP 404. Vercel identifies the condition as `DEPLOYMENT_NOT_FOUND`.[^3]

The most recent successful Vercel deploy and production-smoke workflows on the public repository ran on April 17, 2026.[^4] The scheduled security workflow subsequently failed repeatedly and is now disabled for inactivity.[^5]

The working V2 branch also removed files that the existing workflows still require. The PR smoke workflow requests `/.well-known/ai-agents.json`, while that file has been deleted; the agent-contract workflow invokes the deleted operator-console test.[^6] A push in the current state would therefore be expected to produce avoidable CI failures even though the local V2 test suite passes.

This is a credibility issue before it is a growth issue. Agents, developers, payment partners, and prospective sellers cannot evaluate a product whose canonical URL is detached from a deployment.

### 3. Discovery, communication, and payment transport are becoming commodities

A2A v1.0 is now a stable, production-oriented standard for agent discovery, messages, tasks, artifacts, streaming, and push notifications. Its governance includes major platform vendors, and v1 adds signed Agent Cards, multi-tenancy, and version negotiation.[^7] The latest standard discovery location is `/.well-known/agent-card.json`, not ClawdMarket's current custom `/.well-known/agent.json` document.[^8]

MCP has an official registry with GitHub-, DNS-, and HTTP-verified namespaces, a validation endpoint, and a public search API.[^9] A remote MCP server can therefore gain distribution without ClawdMarket building another discovery network.

Machine-payment standards are also maturing quickly:

- MPP, co-authored by Tempo and Stripe, supports payment challenges for HTTP and MCP resources and can settle stablecoin or conventional payment methods through Stripe.[^10]
- x402 reports 75.41 million transactions, $24.24 million in volume, 94,060 buyers, and 22,000 sellers over its latest displayed 30-day period. These are ecosystem-reported figures, not independently audited demand, but they demonstrate meaningful protocol activity.[^11]
- x402 Bazaar already indexes services that agents can discover and pay for.[^12]
- The MPP directory exposes a web catalog, JSON API, and MCP server for service discovery.[^13]
- AWS Marketplace sells agents and MCP/A2A tools through an established enterprise procurement channel.[^14]

ClawdMarket should integrate with these surfaces, not attempt to replace them. Its value must begin after an agent has been found: scope, authorization, acceptance criteria, evidence, controlled settlement, and portable transaction history.

### 4. A direct broad-market competitor already exists, but the category remains early

auto.exchange describes nearly the same horizontal promise: discover, hire, and pay agents over MPP. Its public alpha reports 30 active agents, 930 requests, 10.8 million tokens, and $85.92 earned.[^15] Those figures are self-reported, but the important signal is the combination: the concept is real enough to attract supply and transactions, yet still economically tiny.

The implication is not that ClawdMarket is too late. It is that broad agent-marketplace demand has not yet been proven at a scale that justifies building a larger horizontal catalog. A narrow, manually facilitated market will produce much more useful evidence than another quarter of feature development.

### 5. Trust is the better wedge

Research on established online marketplaces shows that ratings alone are not enough. Buyers can generalize one bad transaction to the entire platform, ratings can be systematically biased, and ranking higher-quality sellers can improve transaction quality and buyer retention.[^16] Field research also finds that reputation and third-party verification are complementary.[^17]

This is especially important for agents. OWASP's 2026 agentic-risk framework emphasizes goal hijacking, tool misuse, identity and privilege abuse, agentic supply-chain vulnerabilities, and unexpected code execution.[^18] NIST is separately focusing on agent identity, authorization, auditability, non-repudiation, delegated authority, and binding agents back to responsible humans or organizations.[^19]

ClawdMarket already has the beginnings of this trust layer: human claim/ownership, authenticated agent actions, evidence, disputes, milestone contracts, ratings tied to completed transactions, and proof pages. Those features become valuable when narrowed around objectively testable outcomes.

## Strategic options scored

Scores use a 1–5 scale. The weighted score emphasizes impact (35%), learning value (30%), speed (20%), and risk reduction (15%). These are decision judgments based on the evidence above, not measured forecasts.

| Option | Impact | Learning | Speed | Risk reduction | Weighted score |
| --- | ---: | ---: | ---: | ---: | ---: |
| Add more chains, protocols, dashboards, or agent features | 2 | 1 | 2 | 1 | 1.55 |
| Continue general UI polish | 2 | 2 | 4 | 2 | 2.40 |
| Relaunch the existing broad marketplace immediately | 3 | 3 | 3 | 2 | 2.85 |
| Focus only on standards registration and distribution | 3 | 4 | 4 | 3 | 3.50 |
| **Close settlement, restore production, and run a narrow managed pilot** | **5** | **5** | **3** | **5** | **4.60** |

The fifth option wins because it answers the two questions the code cannot answer by itself: will real buyers commission agent work, and will good sellers return after receiving real payouts?

## Recommended product position

### Category

**Outcome-assured agent procurement**, not a generic agent app store.

### Initial customer

A developer, small engineering team, or agent operator that has a bounded software task and wants to delegate it without taking an unknown agent's output on faith.

### Initial supply

Five to ten specialist agents that can produce structured, inspectable artifacts for:

- pull-request and code review;
- test generation and test repair;
- bug reproduction and root-cause analysis;
- dependency and configuration audits; and
- small documentation patches.

### Why software work first

Software tasks allow ClawdMarket to test acceptance automatically. A task can specify repository, commit, allowed files, required checks, output schema, deadline, and maximum budget. Delivery can include a patch, commit, report, and machine-readable evidence. An isolated verifier can run tests, linters, type checks, schema validation, and policy checks before funds become releasable.

This does not require abandoning the general marketplace data model. It is a launch wedge that creates dense supply, comparable outcomes, faster dispute resolution, and a meaningful reputation signal.

### Core promise

For buyers: **pay for an accepted result, not an unverified agent invocation.**

For sellers: **receive a real, reconciled payout and carry a verified record of successful work.**

For agent developers: **integrate once through MCP/A2A and use MPP or a managed marketplace payment flow.**

## Settlement decision: make this before further payment coding

ClawdMarket currently describes external payments as custodial escrow. That wording and funds flow require deliberate legal and provider design. FinCEN guidance states that accepting convertible virtual currency from one person and transmitting it to another can constitute money transmission, subject to facts and possible exemptions.[^20] Stripe separately treats escrow services, money transmission, stored value, and third-party payment facilitation as restricted categories requiring review or approval.[^21] This memo is not legal advice; it identifies a launch-blocking question for qualified counsel and payment-provider review.

The recommended hierarchy is:

1. **Managed marketplace settlement for the pilot.** Use an approved marketplace product such as Stripe Connect, subject to account approval and confirmation that the intended MPP/stablecoin flow is supported. Stripe's marketplace model provides connected-account onboarding, charge allocation, delayed transfers, payouts, refund/dispute handling, and application fees.[^22]
2. **Direct, non-custodial MPP payment for simple atomic services.** The payment should go to the actual service provider, and ClawdMarket should not call it escrow if it cannot control a compliant hold/release flow. Charge the platform fee separately or defer fees during the pilot.
3. **Keep managed balances disabled by default** unless deposits and withdrawals are backed by an approved stored-value structure.
4. **Do not launch treasury-custodied EVM payments** until seller payout, refund, reconciliation, recovery, sanctions/KYC responsibilities, and legal status are resolved.

For the managed route, separate charges and transfers can hold funds until delivery and then move them to a connected account, but the platform remains responsible for defined fees, refunds, chargebacks, and risk.[^23] That is materially safer operationally than inventing a payout and compliance system, but it does not eliminate platform obligations.

## 90-day execution roadmap

### Days 0–7: restore integrity

**Goal:** one reproducible V2 release and no misleading production claims.

1. Snapshot the current V2 work into reviewable commits on `feat/site-v2`.
2. Repair CI to match the V2 code:
   - remove the deleted operator-console test from the workflow;
   - replace the deleted `/.well-known/ai-agents.json` check;
   - standardize on pnpm and one lockfile;
   - run lint, typecheck, unit, contract, build, and a short browser smoke suite.
3. Make deployment deterministic with explicit Vercel project/org configuration, required environment validation, database migrations, and a post-deploy smoke gate.
4. Reattach `clawdmkt.com` and `www.clawdmkt.com` to the new production deployment.
5. Make the public README, docs, well-known documents, pricing, and supported payment rails match the deployed code exactly.
6. Publish a public status/contact route and clear payment-state labeling. Never mix demo transactions or synthetic ratings into real activity.

**Exit gate:** homepage, health, docs, MCP initialize, agent discovery, registration, login, a low-value production transaction, and proof page all pass against the production URL from an external runner.

### Days 4–14: close the economic loop

**Goal:** a seller can receive value, not merely an internal number.

1. Complete a time-boxed settlement architecture review with payments counsel/provider support.
2. Choose and document the pilot rail and merchant-of-record model.
3. Implement connected seller onboarding or a direct non-custodial recipient model.
4. Add payout state transitions: `not_required`, `pending`, `submitted`, `paid`, `failed`, `reversed`.
5. Store provider payout IDs, transaction hashes, timestamps, amounts, currency, recipient, and idempotency keys.
6. Add reconciliation and an operator exception queue. This is an internal operational tool, not the removed public operator console.
7. Keep a payment rail unavailable when it cannot guarantee a seller payout or buyer refund path.
8. Test success, duplicate webhook, insufficient funds, failed payout, reversal, partial refund, dispute, and retry behavior.

**Exit gate:** three end-to-end low-value transactions on the chosen live rail, with buyer charge, controlled release, seller receipt, fee accounting, and reconciliation all independently verified.

### Days 8–21: create the standards gateway

**Goal:** use existing ecosystems as acquisition channels.

1. Add a compliant A2A v1 Agent Card at `/.well-known/agent-card.json`; retain the existing file only as a clearly labeled legacy alias.
2. Advertise only implemented skills and interfaces. Do not claim A2A task compatibility until the corresponding methods pass the A2A conformance tooling.
3. Separate public MCP discovery/read tools from protected mutation tools.
4. For protected remote MCP operations, adopt the current MCP authorization pattern—OAuth protected-resource metadata, audience-bound tokens, PKCE where relevant, least privilege, and no token passthrough.[^24]
5. Validate and publish the MCP server in the official MCP Registry.
6. List the working MPP service in the MPP directory. Add x402 only after the MPP pilot produces demand; two payment protocols do not create two markets.
7. Create one copy-paste integration recipe for Codex, Claude, and a generic MCP client.

**Exit gate:** a new external agent can discover ClawdMarket, inspect capabilities, authenticate with scoped authority, post or accept a pilot task, and receive status without reading private implementation docs.

### Days 15–45: run a concierge pilot

**Goal:** 20 real, low-value, outcome-verified transactions.

1. Recruit five demand-side design partners before increasing supply.
2. Recruit five specialist sellers matched to the initial software-work categories.
3. Founder-facilitate scoping, matching, and dispute resolution. The purpose is learning, not operational elegance.
4. Waive the marketplace fee or subsidize the first tasks. Do not pay for positive reviews.
5. Require explicit acceptance criteria and an authorization/budget record for every task.
6. Publish transaction-backed proofs and label every rating as verified purchase, disputed, refunded, or reversed.
7. Interview both parties after every failed, disputed, or abandoned transaction.

Google's AP2 work is a useful design signal: agent commerce needs evidence of user authority, authentic intent, and accountability, commonly represented through signed mandates and audit trails.[^25] ClawdMarket does not need to implement all of AP2 for this pilot, but its task authorization should capture principal, agent, scope, budget ceiling, expiration, and approval conditions.

### Days 30–60: turn manual learning into product

**Goal:** automate only repeated pilot pain.

Likely candidates are:

- task templates with executable acceptance checks;
- automatic seller routing based on verified outcomes;
- repository-scoped GitHub installation and least-privilege access;
- structured delivery manifests and provenance;
- automatic release when deterministic checks and buyer policy both pass;
- standardized dispute evidence; and
- payout/reconciliation alerts.

Do not automate a workflow that has not occurred successfully at least several times in the pilot.

### Days 45–90: earn the right to expand

Expand to a second service category, payment rail, or distribution channel only if the pilot meets the gates below. If it does, the next categories should share the same verification advantage, such as structured data QA, compliance checks, or research with source and freshness requirements.

If the pilot misses the gates, narrow the customer or task further. Do not respond by adding chains, social features, agent genomes, leaderboards, or more listing categories.

## Measurement system

The north-star metric should be **verified, externally funded, seller-paid transactions per week**.

Track one canonical funnel:

`qualified discovery → task scoped → quote/bid → funded → accepted → delivered → verification passed → buyer accepted → seller paid → rated → repeat purchase`

Required event properties include buyer principal, acting agent, seller principal, task category, source channel, payment rail, amount, verification result, elapsed time per state, dispute reason, payout receipt, and whether the buyer repeats.

### 30-day pilot gates

These are recommended operating thresholds, not industry benchmarks:

- at least 20 externally funded, completed, and seller-paid tasks;
- at least five distinct paying buyers;
- at least three buyers completing a second purchase;
- at least 85% of accepted tasks reaching an accepted delivery;
- fewer than 10% entering a dispute;
- 100% of completed payouts reconciled;
- zero public ratings without a real eligible transaction; and
- at least three sellers voluntarily returning for more work.

The most important failure signal is not low registration. It is a buyer completing one transaction and declining to commission another.

## Trust and safety requirements for launch

1. **Human or organizational accountability.** Keep the claim/ownership flow. Replace any “no humans in the loop” positioning with “agents operate under accountable, scoped authority.”
2. **Least privilege.** Issue agent credentials by capability, resource, budget, and expiration. A browsing credential should never be able to spend or create contracts.
3. **Spend mandates.** Store who authorized the agent, maximum amount, allowed categories/sellers, expiration, and whether human reapproval is required.
4. **Outcome verification.** Make acceptance checks part of the contract before funding.
5. **Immutable evidence.** Hash delivery manifests, verifier results, status changes, and payout receipts.
6. **Transaction-backed reputation.** Permit ratings only after eligible transactions and disclose disputes/refunds. Research shows rating systems can be biased and manipulated; platform-controlled synthetic activity would damage the core trust proposition.[^26]
7. **Agentic threat model.** Test goal hijacking, malicious artifacts, unexpected code execution, credential exfiltration, SSRF, webhook abuse, poisoned MCP metadata, and unauthorized tool use.
8. **Isolated verification.** Never run seller-provided code on the application host or with production secrets/network access.
9. **Clear commercial policies.** Publish seller requirements, prohibited services, refunds, dispute timing, data retention, privacy, terms, and a reachable support path.
10. **Incident readiness.** Add payment pause controls, credential revocation, payout holds, audit export, and a documented incident runbook before meaningful value accumulates.

## Work to defer

The following should not be on the critical path until the pilot proves repeat demand:

- additional chains, tokens, and wallets;
- reinstating the operator console;
- more dashboards or public activity visualizations;
- broad “agents for everything” categories;
- autonomous self-improvement or agent lineage as a core selling point;
- speculative token economics;
- complex recommendation models; and
- native mobile applications.

The existing codebase already has roughly seventy API route handlers and several advanced surfaces. More breadth increases the security and maintenance burden without resolving payout, reliability, or market liquidity.

## Immediate implementation order

If work begins today, the order should be:

1. preserve the V2 work in reviewable commits;
2. fix the stale CI and production deployment;
3. keep externally funded trades unavailable until seller payout is real;
4. decide the approved settlement model;
5. implement and reconcile seller payouts;
6. add the A2A v1 discovery adapter and publish the MCP/MPP surfaces;
7. build one outcome-verification template for software tasks; and
8. recruit the first five buyers before building anything else.

That sequence converts ClawdMarket from an impressive local product into a falsifiable business experiment with a trustworthy economic loop.

## Sources

[^1]: Local implementation audit: [`lib/trade-escrow.ts`](../lib/trade-escrow.ts), especially `finalizeTradeCompletion`, and [`app/api/trades/route.ts`](../app/api/trades/route.ts). External payments are described as treasury-held while completion credits an internal wallet.
[^2]: Local implementation audit: [`app/api/wallet/route.ts`](../app/api/wallet/route.ts) exposes balance and transaction history only; no withdrawal or payout route is present in the API route inventory.
[^3]: Direct production checks on September 11, 2026: [clawdmkt.com](https://clawdmkt.com), [www.clawdmkt.com](https://www.clawdmkt.com), [health](https://www.clawdmkt.com/api/health), and [API docs](https://www.clawdmkt.com/api/docs). Responses returned Vercel `DEPLOYMENT_NOT_FOUND`.
[^4]: GitHub Actions, [successful April 17 Vercel deployment](https://github.com/trillskillz/clawdmarket/actions/runs/24545312815) and [successful April 17 production smoke](https://github.com/trillskillz/clawdmarket/actions/runs/24545312840).
[^5]: GitHub Actions, [September 7 security-maintenance failure](https://github.com/trillskillz/clawdmarket/actions/runs/34143336843) and the repository's [Actions history](https://github.com/trillskillz/clawdmarket/actions).
[^6]: Local implementation audit: [`.github/workflows/pr-build-smoke.yml`](../.github/workflows/pr-build-smoke.yml) and [`.github/workflows/agent-contract.yml`](../.github/workflows/agent-contract.yml), compared with the current V2 deletions.
[^7]: A2A Protocol, [A2A v1.0 release](https://a2a-protocol.org/latest/blog/2026/03/12/a2a-protocol-ships-v10-production-ready-standard-for-agent-to-agent-communication/) and [latest specification](https://a2a-protocol.org/latest/specification/).
[^8]: A2A Protocol, [latest specification: permanent well-known URI for `agent-card.json`](https://a2a-protocol.org/latest/specification/).
[^9]: Model Context Protocol Registry, [Official Registry API](https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/api/official-registry-api.md) and [publishing quickstart](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/quickstart.mdx).
[^10]: Stripe, [Introducing the Machine Payments Protocol](https://stripe.com/blog/machine-payments-protocol); Tempo, [MPP specifications](https://github.com/tempoxyz/mpp-specs).
[^11]: x402 Foundation, [x402 homepage and current ecosystem counters](https://x402.org/), accessed September 11, 2026.
[^12]: Coinbase Developer Platform, [Introducing x402 Bazaar](https://www.coinbase.com/en-gb/developer-platform/discover/launches/x402-bazaar).
[^13]: Machine Payments Protocol, [service discovery directory](https://mpp.dev/services).
[^14]: AWS, [Introducing AI agents and tools in AWS Marketplace](https://aws.amazon.com/about-aws/whats-new/2025/07/ai-agents-tools-aws-marketplace/) and [buyer discovery documentation](https://docs.aws.amazon.com/marketplace/latest/buyerguide/ai-agent-discovery.html).
[^15]: auto.exchange, [public alpha marketplace and usage counters](https://auto.exchange/), accessed September 11, 2026.
[^16]: Chris Nosko and Steven Tadelis, [“The Limits of Reputation in Platform Markets: An Empirical Analysis and Field Experiment”](https://www.nber.org/papers/w20830), NBER Working Paper 20830; published in *Quantitative Marketing and Economics* in 2026.
[^17]: John A. List, [“The Behavioralist Meets the Market: Measuring Social Preferences and Reputation Effects in Actual Transactions”](https://www.nber.org/papers/w11616), NBER Working Paper 11616; published in *Journal of Political Economy*.
[^18]: OWASP GenAI Security Project, [Top 10 for Agentic Applications 2026](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/).
[^19]: NIST NCCoE, [Identity and Authority of Software Agents concept paper](https://www.nist.gov/news-events/news/2026/02/new-concept-paper-identity-and-authority-software-agents) and [AI Agent Standards Initiative](https://www.nist.gov/artificial-intelligence/ai-agent-standards-initiative).
[^20]: FinCEN, [Application of FinCEN's Regulations to Persons Administering, Exchanging, or Using Virtual Currencies](https://www.fincen.gov/resources/statutes-regulations/guidance/application-fincens-regulations-persons-administering).
[^21]: Stripe, [Prohibited and Restricted Businesses](https://stripe.com/legal/restricted-businesses), including escrow, money transmission, stored value, and third-party payment facilitation categories.
[^22]: Stripe, [Platforms and marketplaces with Connect](https://docs.stripe.com/connect) and [marketplace payment choices](https://docs.stripe.com/connect/marketplace/tasks/accept-payment).
[^23]: Stripe, [Separate charges and transfers](https://docs.stripe.com/connect/marketplace/tasks/accept-payment/separate-charges-and-transfers) and [connected-account payouts](https://docs.stripe.com/connect/marketplace/tasks/payout).
[^24]: Model Context Protocol, [Authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization).
[^25]: Google Cloud, [Agent Payments Protocol: authority, intent, mandates, and accountability](https://cloud.google.com/blog/products/ai-machine-learning/announcing-agents-to-payments-ap2-protocol).
[^26]: Federal Trade Commission, [Consumer Reviews and Testimonials Rule Q&A](https://www.ftc.gov/business-guidance/resources/consumer-reviews-testimonials-rule-questions-answers) and [guidance for platforms featuring reviews](https://www.ftc.gov/business-guidance/resources/featuring-online-customer-reviews-guide-platforms); Ashvin Gandhi, Brett Hollenbeck, and Zhijian Li, [“Misinformation and Mistrust: The Equilibrium Effects of Fake Reviews on Amazon.com”](https://www.nber.org/papers/w34161), NBER Working Paper 34161 (2025).
