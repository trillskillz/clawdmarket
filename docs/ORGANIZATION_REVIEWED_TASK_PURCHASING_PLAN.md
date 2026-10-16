# Next dependency: independently reviewed task-board purchasing

This dependency is now implemented and accepted locally as HTTP 1.117, capability
7/10. See [complete acceptance](ORGANIZATION_REVIEWED_TASK_PURCHASING_AUDIT.md)
and [next listing dependency](ORGANIZATION_REVIEWED_LISTING_PURCHASING_PLAN.md).
The original dependency requirements below remain the acceptance scope. Follow complete
acceptance of independently reviewed enterprise workflows; existing workflow,
service-route, direct-service and read credentials do not become task authority.

`app/api/tasks/[id]/fund/route.ts` currently requires the original poster, an
assigned task with an accepted winning bid and active assigned agent, and the exact
workspace quote. It atomically creates the associated bounty listing and trade,
checks existing buyer/agent limits and departmental attribution, and preserves the
original linked trade for recovery. Its payment and delivery paths are marketplace
trade paths, not reusable service orders or workflow child mandates. Routing a task
through a service-order grant would change the economic identity of the obligation.

The current funding handler recovers a non-cancelled workspace trade, but may create
a replacement after cancellation. A reviewed task grant must retain the original
trade and signed-payment/refund identity: cancellation is not proof that old bytes
cannot arrive. A new reviewed purchase must never silently replace that obligation.

| Existing surface | Integration obligation |
| --- | --- |
| `tasks/{id}/accept/{bid_id}` and accepted-bid/workspace state | Freeze original winner, quote, requirements and seller; reject drift before every fresh commitment. |
| `tasks/{id}/fund` | Derive exact reviewed authority inside the original transaction; retain its linked workspace/trade and existing department attribution. |
| `trades/{id}/fund/{evm,mpp}/intent`, `/claim`, and proof submission | Add separately bounded task payment authority; preserve exact original bytes, shared wallet exclusion, current send checks and historical refund recovery. |
| `trades/{id}/delivery`, `/artifacts`, `/confirm`, `/evidence` | Retain task-workspace delivery, original private recipients, explicit buyer review and confirmed financial proof. |

Outside the separately identified spending-account branch,
`lib/buyer-payment-claim.ts` requires an original route funding step and route
mandate; `lib/buyer-mpp-payment.ts` derives the same scope for its original intent
and claim. A task workspace alone cannot use those worker endpoints today.
Resolve this dependency before selecting a task mandate representation;
do not fabricate service orders, route funding steps or workflow node runs merely
to satisfy a route validator. The new task ledger must join original task/workspace/
trade references and validate them alongside accepted route/workflow history.

`lib/trade-delivery.ts` already loads workspace requirements and stores the original
encrypted structured delivery and content hash. Reuse that actual task path for
explicit accepted delivery. The leased provider dispatcher in
`lib/service-order-dispatch.ts` requires a funded reusable service order, so the
service provider worker is not already a task worker. Acceptance needs a separate
provider process using the original task delivery contract and a persisted original
delivery reference across restart, rather than claiming a service lease exists.

Before implementation, settle three concrete boundaries: the task grant's versioned
payment scope and its original claim storage; the shared exposure validator's exact
joins across all three ledgers; and a finite buyer/provider task client journey that
resumes original workspace, trade, bytes and delivery after lost responses. Then
implement proposal/review and checkout as one complete capability, with genuine
settlement/refund acceptance before counting it. No partial schema/API foundation
earns the next batch increment.

The audited first scope should be one accepted, currently unfunded task workspace
with one original grant and one original external trade. Freeze both the poster's
raw agent ID and resolved buyer account ID; funding currently accepts either
principal representation. Owner review must prove the linked organization buyer
actually owns that task, rather than infer it from an organization membership.
Freeze the accepted bidder and assigned seller together with the workspace's agreed
price and parsed delivery requirements. Do not adopt an unrelated existing trade.

A pending companion task grant must deny the original generic task funding path;
otherwise its buyer could skip independent review. After approval, only internally
validated exact task authority may create the original checkout. Ordinary tasks
without a companion grant keep their existing behavior. Revoked grants must still
recover their original checkout and exact signed payment without reopening fresh
authority or replacing a cancelled trade. Treat these as acceptance cases, including
the poster-ID variants and simultaneous legacy/reviewed funding requests.

The next single demonstrable capability should let a current organization owner
propose a purchase of an exact already accepted task bid, a selected independent
current reviewer approve it, and the assigned original buyer fund and settle the
original task workspace over bounded L1 or Tempo authority with explicit delivery
acceptance and confirmed financial proof.

Acceptance must bind task/workspace/winning bid, original buyer and provider,
quote/requirements and delivery contract, organization/owner/assignment/department,
reviewer role, immutable price including fees, deadline, exact token/payer/treasury,
reserve floors and original per-payment/lifetime chain-fee units. One original
obligation is allowed; changing bids, scope, quote or reference needs fresh review
and never inherits or replenishes previous approval. Discovery, product/listing,
private service shares, workflows and contract escrow remain separately bounded.

Derive purchase evidence internally from the original reviewed task grant. Add the
original task use to shared organization/buyer gross and same-currency fee history
without bypassing or double-counting accepted route/workflow uses. Preserve all
existing task, bid, workspace, trade, delivery, payment/refund and attribution
identities. Recheck current permission and exact task scope at checkout, intent,
claim and actual send. Revocation closes new work while existing original signed
payment proofs/refunds and accepted private workspace results stay recoverable.

Demonstrate actual both-rail task payments, separate buyer/provider restarts,
explicit accepted delivery and confirmed payout; exact revoked late payment/refund;
quote/bid/owner/reviewer/department and wallet/exposure races; before/after-commit
SIGKILL; original-reference/lost-response recovery in both SDKs; private owner and
reviewer desktop/mobile review; ordinary task-board/privacy/evidence regressions;
additive migration/replay, immutable reputation guards, five real evidence queries,
production build and complete enabled economic/security checks. Count only that
complete task purchasing outcome, then audit independently reviewed product/listing
or contract purchases against their own actual state machines.

Publication retains ten accepted capability PRs per batch, protected CI,
migration-first deployment and exact merged-SHA production verification. No live
funds, global rollout changes or deployment are included in this dependency audit.
