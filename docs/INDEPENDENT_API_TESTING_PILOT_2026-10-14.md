# Prepared pilot: finite API contract checks

Status: setup materials only. There are no enrolled independent providers or
paying pilot customers in this work. Do not register, purchase, review, fund,
contact prospects or enable global execution as part of preparation.

Use one independently reviewed organization task-board purchase with an accepted
provider bid and the existing funded workspace. HTTP 1.117's accepted local task
authority freezes explicit buyer acceptance and disables automatic confirmation.
Ordinary task workspaces retain legacy automatic release and cannot provide that
guarantee merely by adding acceptance prose. Do not use an ordinary task checkout
as a fallback for this pilot.

This reviewed task path is included in the local candidate, not deployed production
1.116. It requires enterprise readiness and the buyer's existing execution gate.
No current permission for a real pilot buyer is demonstrated. A scoped operational
canary is not independent-pilot admission; do not change global flags or place a
customer into a canary identity. Obtain a separately reviewed admission decision
and deploy the accepted path before opening this pilot. Until then it is setup
material only. Use the same narrow offer and one original task/trade reference
per actual customer job; do not add an execution platform.
The provider and buyer must be actual separate participants. Operator fixtures
remain visible as reference/canary cohorts and never become adoption evidence.

## Offer and acceptance

One job costs **$2.00** plus the existing **$0.10** buyer platform fee; the exact
server quote controls. At most three concurrently admitted customers, one active
job per provider, maximum five paid pilot jobs before review. This is a proposed
cohort limit, not an enabled deployment flag or an approved funding budget.

Inputs, private to the selected funded provider:

- One buyer-owned staging API origin and explicit authorization to test it.
- At most five GET-only paths, expected status codes, required JSON fields and
  at most ten finite assertions. No destructive methods, arbitrary network targets,
  production credentials or customer personal data.
- A versioned OpenAPI document or equivalent agreed schema as a private artifact.
- A buyer-selected deadline within 24 hours and an explicit artifact retention choice.

Deliverables: one JSON report and one short Markdown explanation, each under
64 KiB. The report records tested API origin/path identifiers, method, observed
HTTP status, schema/assertion results, response timing, tool/version and test time.
Include hashes for the agreed inputs and produced artifacts. Redact credentials,
authorization headers and private response bodies. No private report material is
sent to analytics or public receipts.

Acceptance requires the agreed report schema, all agreed finite assertions evaluated
and truthfully recorded (including failures in the buyer's API), an
artifact hash matching the reviewed delivery, and **explicit buyer acceptance of
that exact delivery hash**. A failed assertion is a reported finding, not evidence
of provider fault by itself. A report can honestly identify a buyer API defect.
These tests cover only specified requests at specified times. They do not certify
security, semantic accuracy, general reliability or independence. An authenticated
external verifier report does not prove application-observed sandbox execution.

## Rails and provider readiness

Initial pilot rail: **MPP on Tempo/pathUSD (chain 4217)** with the reviewed task
v2 authority, deployment readiness and the provider's explicit rail confirmation.
Reviewed task v1 supports Ethereum L1 only, not Base; no configured production L1
token was demonstrated, so it is excluded from the initial offer. Prepaid
credit is excluded from this pilot to keep provider proceeds externally settled.
No incidental withdrawal feature or custody change is permitted.

Before admission, the provider must supply a current owner-linked identity,
reviewed cohort evidence (otherwise ownership remains unknown), confirmed seller
rails, a verified intended payout destination, exact input/output schema, finite
verification policy including buyer_review, an actual delivery contact/process,
capacity one, a 24-hour delivery deadline, and a documented outage escalation.
No representative evidence is claimed from a registration or a local fixture.
The real buyer also needs the existing linked organization/assignment/budget
setup, a current owner and a distinct authorized purchase reviewer who does not
own the provider. This reviewer separation is purchasing control, not evidence
that buyer/provider ownership or customer demand is independent.

Inspect the actual provider profile, confirmed seller rails and payout destination.
Create a task only for an actual consenting buyer and set its finite requirements
before bidding begins. Explicitly accept the real provider's agreed bid. The owner
then proposes the exact task/bid at `/api/organizations/{id}/task-authorizations`;
the selected authorized reviewer approves its immutable authority hash. Recover
and fund only its original `/checkout`, never the generic task `/fund` endpoint.
Follow [the reviewed task contract](ORGANIZATION_REVIEWED_TASK_PURCHASING.md)
for separate payment-scoped credentials, bounded Tempo fees, original private
buyer/provider journals and explicit exact-hash acceptance. Confirm
public task/API quota readiness and any separate platform-usage charge before
admission. Preserve deployment gates. A reusable service must additionally satisfy
its DTO readiness, rollout and capacity checks; do not put real customers into a
controlled-canary identity merely to bypass a gate. If no provider is ready, the
pilot is not open and reusable inventory remains empty.

Persist original client reference and body before checkout. Inspect the original
order on uncertain responses; never create a replacement payment merely because
a reply was lost. Recovery and refunds use the original trade, intent, claim,
delivery and settlement transfer references. No automatic schema/test result
substitutes for explicit required acceptance.

Missed acknowledgment/delivery follows existing timeouts and dispute/refund
procedures. Stop new admissions during payout/refund anomalies. Buyer rejection,
full refund, split resolution and retained fees must be reported according to their
actual financial records. Do not promise a full fee refund when that path retains
the original platform fee. Customer communication requires separate authorization.

## Minimum funnel and economics

Use existing analytics and authoritative order records. A client may report a
public task view after actual discovery; the browser workspace emits this when a
task first loads (service_discovery remains available for an actually enabled reusable service):

```http
POST /api/analytics/track
Content-Type: application/json

{"event_type":"task_discovery","metadata":{"task_id":"ACTUAL_PUBLIC_TASK_ID"}}
```

This is a self-reported public task view, not a unique person or a paying customer. Pre-task buyer discovery and recruitment coverage belong in the opt-in operator ledger; do not mislabel a provider viewing a task as buyer acquisition. Metadata
is allowlisted and bounded. No prompt, query free text, input/output artifact,
endpoint credential, private URL or secret is allowed. Missing analytics is
missing discovery coverage, not a zero-customer conclusion.

`inspectPilotFunnel` measures selected actual tasks or services using separate stored facts
for checkout, funding, delivery, exact-delivery acceptance, financial settlement
and repeat purchasing. Output contains aggregate controlled, unknown and currently
reviewed ownership cohorts. The existing public-trade predicate excludes private
service orders and private/archived agent parties; an organization-reviewed public
task may qualify when that predicate permits it. Private approval, input and
artifact contents never enter this aggregate. Repeat account
counts are not independent people. The local report command is deliberately
restricted to a disposable database; production report access requires the operator's
existing authorized read-only channel:

```sh
node --conditions=react-server --import tsx scripts/pilot-funnel-report.ts --tasks ACTUAL_TASK_ID
```

Record an operator ledger per real order with: original reference, intervention
category, minutes, reason, recovery outcome, provider fulfillment cost, actual rail
fees in native units and the dated conversion used for any USD cost. Keep it in
the existing restricted operations records, not public analytics. Until reviewed
costs exist, contribution margin and operator minutes remain **null**, never zero.
Contribution margin = recorded platform fee minus actual processing/rail costs,
provider subsidy and allocated intervention cost. Gross volume is not revenue.
An empty [restricted-ledger template](pilot/api-testing-operator-ledger.template.csv)
and [task requirements template](pilot/api-testing-task-requirements.template.json)
are prepared. They contain no customers, purchases, reviews or operational claims.
The requirements JSON is submitted before bids; the reviewed purchase must freeze
those exact requirements and explicit acceptance. A written requirement alone does
not change an ordinary task's legacy settlement semantics.

Review after five paid jobs or two weeks, whichever comes first: completion and
acceptance rates with denominators; settlement/refund anomalies; repeat accounts
by cohort; median intervention minutes; contribution margin; provider and buyer
concentration; discovery-to-checkout coverage and conversion. Continue only when
independent participants actually receive the agreed deliverables and proceeds.

## Measurable recruitment plan — prepared, not executed

After explicit outreach approval, use one opt-in developer channel and a single
offer: finite contract checks for a buyer-owned staging API. Seek three genuine
prospects and one qualified external provider. Record invitations, opt-ins,
eligible API inputs, quoted jobs, actual paying participants and repeats. Keep
contact information outside analytics. Report controlled/unknown cohorts separately.
An opt-in or registration is not a purchase. Do not write testimonials or reviews
on anyone's behalf. No outreach or fabricated traction is authorized here.
