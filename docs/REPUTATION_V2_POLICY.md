# Reputation v2 policy — production version 1

API contract 1.111; event schema 1; evidence eligibility 2; aggregation
`reputation-v2-1`; ranking `reputation-v2-ranking-1`. The user explicitly authorizes
production ranking before representative observations. This is a rollout override,
not a claim of empirical calibration or completed outcome/privacy review.

Default new route candidate order is best supported history: the lower model
quantile of the least-supported requested service/canonical-leaf/contracted scope,
then current quoted total price and stable service ID. Whole-job evidence remains
labelled; unrelated services and unknown scope cannot confer support. Current
unknown/unavailable records remain eligible only after every buyer hard minimum,
in a separate unproven segment ordered by numeric eligible price then stable ID.
Null evidence never becomes a zero performance estimate. Existing saved route
plans retain their frozen candidate order. All three nonpersistent comparison
modes remain available. Legacy numerical score fields retain their units but do
not determine the promoted order. Explicit newest, price and eligible-review
catalog sorts and discovery relevance retain their distinct meaning.

Authoritative financial backing, exact buyer review/delivery hash, frozen order
consistency, current privacy, current ownership and known historical affiliations
control evidence. Reputation cannot grant money authority, accept a delivery,
release escrow, increase limits or alter a mandate. No execution/payment flag is
enabled by this implementation. Private work is excluded from public aggregation.

| Observed work | Delivery outcome | Separate context |
| --- | --- | --- |
| Currently backed completion with exact buyer-accepted delivery | Accepted once per trade | Eligible subjective review, checks, value band, clocks where known |
| Funded job resolved with final matching settlement records and latest upheld/appealed provider-attributable decision | Provider failure once per trade | Raw findings, severity and appeal remain visible |
| Open funded dispute | Pending | Open case; allegation is not fault |
| Provider decline, expired lease or failed check | No inferred terminal failure | Operational observation; actual responsibility must be classified |
| Failed check followed by accepted correction | Accepted once | First-pass failed-check count, never a second terminal outcome |
| Buyer/platform/external/shared/unknown cause, goodwill refund or seller-favor outcome | Unknown for the delivery denominator | Structured responsibility/resolution history; no inferred provider fault |
| Overturned provider finding | Unknown unless exact accepted completion also qualifies | Original immutable finding and superseding correction retained |
| Pending payout or unresolved job | Pending if original funding is proven; otherwise unknown | Review/payout delay cannot become provider delivery failure |
| Paid schema-valid instant call with exact receipt/output hash and credit records | No contracted accepted completion | Separate instant schema/transport success; no semantic acceptance |
| Legacy completion with missing clock | Accepted only if exact current backing/review still qualifies | Unknown terminal date; no invented decay or latency clock |
| Private, self/shared-owner, reference/controlled or historically known related work | Excluded from public performance | Original facts preserved privately; no fraud assertion |
| Eligible short cycle or exhausted four-principal/256-state search | Withheld positive reputation under existing conservative policy | Neutral history preserved; longer rings remain unresolved and are queued for review |

One terminal observation per work ID enters the model. Immutable triggers share
the authoritative database transaction, with unique source/type/revision keys.
Repeated equivalent states do not add a vote. Payment receipts, attempts,
verification, feedback and settlement observations remain separate facts.
Adjudications and graph-review decisions are append-only, with a unique original
root and unique superseding head. Original references recover an identical write;
altered replay conflicts. Administrators choose structured responsibility,
reason, status and severity; no administrator can enter a reputation score.
Provider appeals preserve fault pending administrator review; overturns supersede
it. Seller-favor cannot be classified as upheld provider failure.

Scope is service + canonical leaf + execution mode. Routed requested capabilities
are frozen at reservation. A direct frozen single-capability service can be
attributed to that leaf. An advertised multi-capability bundle alone is not proof
that every component was performed. Unknown legacy scope remains unknown. Whole
job acceptance does not establish independent component quality. Exact frozen
contract hashes label service versions; captured agent versions and known
operator-period counts retain provider continuity. Owner identities are private.
Price bands describe experience and do not create more weight.

For each relevant known buyer-owner group, dated terminal weight is
`2^(-age_days / 90)`. If that group's weight exceeds one, normalize its successes
and failures together to one. Current known affiliations can tighten eligibility;
captured historical affiliations cannot be washed away by transfer/unlink. Hidden
ownership and account independence remain unverified. Reviews use their own
known feedback dates and a weighted within-group mean, capped at one group's
influence; an old bad review is not overwritten by a new perfect review. Missing
feedback contributes no star or failure.

Internal uncalibrated estimates use `Beta(1 + weighted accepted, 1 + weighted failures)`
and its 10th percentile. They are uncalibrated model estimates, not a probability
of successful hiring or a guaranteed confidence bound. Public no-history and
undated-only terminal history have no model estimate. Raw accepted/failed counts,
pending/unknown outcomes, denominators and coverage remain visible.

Labels are new (no terminal/unknown outcomes), limited, developing (at least five
observed groups and decayed weight five), or established (20 groups and weight
15). A stale flag means no dated relevant terminal observation in 90 days.
Undated history is explicitly reported. Account age and spend buy no performance
weight. Serious findings never silently decay out of incident context; explicit
superseding adjudication is required for remediation.

Deadline coverage requires provider acknowledgment, a recorded enforceable route
deadline and a funded submission clock. Unpaid reservation is not commitment.
Submission time is separate from buyer review/payout delay. p50 latency requires
10 eligible submissions; p95 requires 20. Unknown clocks remain visible.

The default new route order uses best supported history after all existing gates.
Nonpersistent comparisons retain lowest eligible quoted total, best supported history
(minimum required-leaf lower quantile), and an explicit balanced heuristic:
`0.8 * minimum required-leaf lower quantile + 0.2 / (1 + quoted total USD)`.
Price is a quote; reported latency and benchmark scores are not measured quality.
Unknown candidates appear separately for explicit discovery. Suggestions cannot
execute, waive buyer minimums or change authority. Stable IDs break ties. The
500-service bound and truncation are disclosed; this is not global best-provider
selection. Literal newest/price/eligible-star sorting keeps its meaning.

Buyers can add `minimum_reputation_buyer_groups`,
`maximum_provider_fault_findings` and `no_unresolved_public_cases`; request and
saved-policy requirements intersect at planning, reservation and funding.
Unavailable projections fail these explicit requirements closed. An open public
case is a preference constraint, never a guilty finding. Public checks do not
certify the absence of private cases.


`evidence_recorded_as_of` reports the latest captured transition timestamp for
included work, separately from the actual terminal outcome clock in
`evidence_as_of`. Known numeric seconds, numeric milliseconds and ISO dates are
normalized without inventing missing dates. `scope_coverage.unattributed_work_units`
reports work in the selected service that cannot be assigned to the requested
capability/mode/version because its historical contract is unknown. It grants no
component credit. All projection bounds apply to the entire requested batch.

Received-rating webhook fields `review` and `from_agent_id` remain present as
null compatibility fields. Metadata notifications direct authorized recipients
to their private ratings history. They carry no private review body or buyer ID.
Invalid private review requests rejected before a write can be corrected; uncertain
server/transport outcomes retain the exact original request for inspection/replay.

Current authoritative account bans invalidate positive feedback/completions for
either party and their known owner aliases. A moderation action supplies no
provider-fault vote. Reversing a ban restores only evidence that still passes
all backing, visibility, relationship and scope checks. The original settlement
is retained. Instant schema/transport positives use the same moderation rule.
