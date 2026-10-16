# Dependable purchasing, truthful information and an independent paid pilot

User-supplied plan, 2026-10-14. This plan takes priority over the earlier routing
and listing-purchasing plan until its requirements are complete. Keep changes
local under the current publication policy. Accepted task checkpoint: `a8f870f`.
The unfinished listing review foundation is parked separately at `e876e58` in
`/home/void/Work/clawdmarket-reviewed-listings`; it is not included automatically.
Current worktree: `/home/void/Work/clawdmarket-dependable-pilot`, branch
`work/local-dependable-pilot-2026-10-14`, with no upstream.

The user's requirements below are the source of truth; baseline observations
are hypotheses to recheck, not declarations of current deployment state.

---

You are the engineering agent for ClawdMarket: https://clawdmkt.com and https://github.com/trillskillz/clawdmarket.

Your task is to address the verified technical, operational, and product issues below, then prepare a concrete release candidate. Prioritize reliable purchasing, truthful public information, and measurable independent adoption.

Work autonomously through investigation, implementation, and verification. Follow the repository's current instructions and publication policy. Keep changes local unless existing authorization explicitly permits publication. Do not move real funds, enable global execution flags, change custody arrangements, or create customer activity without explicit authorization.

## 1. Establish the current baseline

The following observations came from October 14, 2026. Recheck them before changing anything; some may already be fixed:

- Live agent contract: 1.116.
- Latest inspected main commit: "96a017b".
- Public statistics: 89 network profiles, 47 registered agents, 15 online agents, nine payment-ready listings, 21 completed trades, $0.92 recorded volume, and $0.02 recorded platform fees.
- All 15 online agents matched the platform-operated reference fleet.
- Public reusable-service and instant-service discovery returned no services.
- Qualifying autonomously routed GMV was zero.
- Account credit was enabled but nonredeemable.
- Password-reset email was not configured.
- Production reputation ranking was enabled while representative evidence review and calibration remained pending.
- GitHub's description still advertised recursive self-improvement despite its retirement.
- The October 13 security-maintenance workflow failed during dependency auditing.
- The October 11 fresh paid canary stopped before execution because its dedicated buyer lacked minimum funding.

Inspect current code, live read-only endpoints, CI results, and release records. Distinguish implemented, tested, deployed, enabled, and independently demonstrated capabilities.

Do not mistake historical documentation for current state. Produce a brief evidence-backed issue register, then implement the necessary fixes.

## 2. Triage and resolve the security-maintenance failure

Inspect workflow run:
https://github.com/trillskillz/clawdmarket/actions/runs/38445060809

The observed finding was a high-severity "braces" stack-exhaustion advisory through:
"eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch → braces".

Reproduce the current dependency finding. Establish affected versions, production versus development exposure, input reachability, and available upstream fixes.

Prefer a compatible upstream upgrade or removal of the vulnerable dependency path. Do not blindly force an incompatible transitive version.

If no fix exists, document a narrowly scoped mitigation or exception with:

- Exact advisory and affected dependency path.
- Exposure analysis and compensating controls.
- Owner, expiration, and reevaluation condition.
- A clear distinction between acknowledged risk and remediation.

Do not disable auditing, suppress unrelated findings, or mark unresolved risk "fixed." Ensure any exception follows existing policy.

Acceptance: the finding is resolved or explicitly tracked with justified treatment, and security reporting accurately exposes remaining risk.

## 3. Make marketplace metrics honest and useful

Separate:

- All public profiles.
- Public registered agents.
- Platform-operated reference/demo/canary agents.
- Other agents whose independence remains unverified.
- Recently online agents in each category.
- Listings, active listings, payment-ready listings, and executable reusable services.
- Recorded transaction volume versus qualifying independent or autonomous economic activity.

Use authoritative cohort metadata, not display-name matching. Preserve historical identities and financial records.

Never label an agent "independent" merely because it is not recognized as platform-controlled. Unknown ownership remains unknown.

Inspect the current "services_listed" and "services_online" fields: they appear to count listing records, which can be confused with executable service definitions. Introduce precise, backward-compatible terminology and explain legacy aliases.

Update homepage, marketplace, registry, Observe, API schemas, and documentation consistently. Reference agents can remain visible, but their status must be obvious.

When upstream data fails, display unavailable or stale with a timestamp rather than silently converting errors into zero activity.

Acceptance: users can distinguish operational fixtures, available inventory, and economic adoption without interpreting internal field names.

## 4. Fix payment-rail suitability and credit disclosures

Trace credit-funded purchases through seller acceptance and settlement.

Prepaid credit is currently nonwithdrawable. Do not implement withdrawals as an incidental fix; that requires separate accounting, custody, reconciliation, and security design.

Instead:

- Clearly disclose nonwithdrawability before deposit and purchase.
- Explain what sellers receive on each rail.
- Check whether seller rail preferences are machine-enforced.
- If needed, add explicit supported-rail settings and enforce them server-side across listings, tasks, service orders, checkout, and routing.
- Preserve existing funded orders and their original settlement terms.
- Prevent checkout from selecting prepaid credit when the seller requires external settlement.
- Ensure API and human interfaces expose the same restrictions.

Do not derive binding preferences automatically from listing prose. Existing prose-only restrictions should be flagged for owner confirmation or migration review.

Acceptance: a buyer cannot fund a new order using an unsupported seller rail, and neither party can mistake prepaid credit for withdrawable funds.

## 5. Restore dependable account recovery

Verify current password-authentication and recovery paths.

If password-reset delivery is unconfigured, implement or repair the integration and expose the dependency accurately in operational readiness. Do not claim a global outage if wallet/API flows remain healthy.

Verify:

- Generic responses that avoid account enumeration.
- Rate limiting.
- Expiring, single-use reset tokens stored safely.
- Invalidation and session behavior consistent with existing policy.
- Safe handling of email-provider failure.
- Preservation of agent ownership and credential-recovery rules.

Test delivery through a sandbox or approved test inbox. Never email real users during testing.

Acceptance: configured deployments support a complete recovery journey; unconfigured deployments provide accurate status and an actionable operator instruction.

## 6. Align verification claims with actual guarantees

Audit every public use of "verified," "trusted," "proof," "quality," and "autonomous."

Clearly distinguish:

- Valid output structure.
- Declared source metadata.
- Artifact integrity.
- Passing an agreed finite test suite.
- Authenticated verifier reports.
- Explicit buyer acceptance.
- Confirmed financial settlement.
- Semantic accuracy or real-world independence, where unmeasured.

Do not imply that a report proves remote sandbox execution if the application cannot observe it. Do not let passing schema or finite tests independently authorize payment where explicit acceptance is required.

Preserve existing isolated-verification and financial safeguards.

Acceptance: labels, receipts, API fields, and marketing describe the evidence actually collected.

## 7. Make reputation's limitations operationally visible

Preserve the explicitly authorized production ranking policy unless a concrete defect requires a separately justified change.

Do not manufacture calibration, infer independence from account count, or promote controlled fixtures into positive marketplace evidence.

Expose:

- Evidence scope and freshness.
- Observed buyer-group breadth.
- Known concentration.
- Unproven-provider status.
- Model version and calibration status.
- Pending representative-evidence review.

Evaluate the existing promotion audit. Add only missing measurements needed to compare ranking with price/history baselines, inspect exclusions, and detect provider concentration.

Keep ranking separate from authorization, budget limits, acceptance, and settlement.

Acceptance: operators can assess the policy using real outcomes, while users cannot mistake model estimates for measured capability guarantees.

## 8. Remove obsolete product claims

Search active public surfaces, metadata, manifests, SDK descriptions, README, and promotional drafts for retired recursive-improvement, training, lineage, and versioning claims.

Update them to match current behavior. Preserve historical records and retired endpoint semantics.

Prepare corrected GitHub repository-description text if changing remote metadata is outside current authorization.

Also remove unsupported "unlimited capacity" or general-availability claims where provider capacity is absent or rollout remains restricted.

Acceptance: the project consistently describes its actual deployed offering.

## 9. Separate health checks from economic proof

Maintain distinct operational records for:

- Configuration readiness.
- RPC availability.
- Treasury operating reserves.
- Settlement-worker health.
- Outstanding payout/refund anomalies.
- Last successful end-to-end paid canary.
- Independently attributable customer activity.

A successful readiness check must not refresh the timestamp of a paid canary.

Prepare a minimal, capped canary using dedicated test identities. Specify exact maximum funding, expected fees, checkpoints, original-reference recovery, and expected terminal balances. Exclude it from independent adoption metrics.

Run the complete journey on disposable infrastructure first. If live funding or execution is not authorized, leave a reviewable command and funding requirement rather than executing it or reporting success.

## 10. Enable a focused pilot without fabricating traction

Prepare one narrow pilot using the existing architecture, preferably reproducible API testing or structured data extraction.

Define:

- Exact inputs and deliverables.
- Acceptance criteria and verification limits.
- Supported payment rails.
- Provider onboarding and readiness requirements.
- Delivery deadlines and failure/refund handling.
- Contribution margin and operator-intervention measurements.

Instrument the minimum funnel needed to measure discovery, checkout, funding, delivery, acceptance, settlement, and repeat purchasing. Preserve privacy; do not place private artifacts or credentials in analytics.

Distinguish paying customers from controlled accounts and unknown cohorts.

Do not create synthetic reviews, purchases, providers, or testimonials. Do not contact prospects or providers without authorization. Deliver pilot setup materials and a measurable recruitment plan.

## Implementation and completion requirements

Use small, coherent changes. Preserve original financial references, immutable delivery evidence, authorization boundaries, historical settlement semantics, and backward compatibility.

Add targeted tests for changed behavior and satisfy existing release gates. Avoid broad refactors or new infrastructure without a concrete need.

Before stopping, provide:

1. Each finding and its current disposition.
2. Changes implemented and why.
3. Tests actually run, including failures, skips, and limitations.
4. Current local/deployed/enabled status.
5. Remaining external dependencies or decisions.
6. Release and rollback instructions.
7. Any exact action awaiting publication or live-payment authorization.

Success means the existing product is more dependable, transparent, and ready for a small independent paid pilot. Do not substitute additional feature count or passing tests for evidence of customer demand.
