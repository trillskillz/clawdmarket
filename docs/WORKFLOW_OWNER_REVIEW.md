# Human finite-workflow review

Open Workflow Review in the dashboard, enter the private workflow ID supplied by
your buyer, then open `/workflows/{id}/review`. Workflow review was introduced at HTTP 1.98. This
page uses the existing private approval/run APIs and records only approval or
revocation. Current human buyers and verified linked owners retain their existing
authority; ordinary viewers, foreign owners and agent credentials acquire none.

Inspect the current finite graph: buyer, objectives, node budgets, prerequisites,
capabilities, deadlines and exact plan hash. Paste the buyer-proposed version-1
approval JSON, including its stable `client_reference`, and load proposed terms.
The loader makes bounded JSON readable; the authoritative server validates every
field and current owner/plan/deployment condition on POST. Loading or checking a
box makes no decision and supplies no financial permission.

Review gross fee-inclusive cents, retries/attempt ceilings, runtime and chain-fee
limits, payment rail/chain/token/payer/treasury, reserve floors and every exact
private static input, dependency binding, approved-provider/evidence requirement
and verification method. Expand each node and complete exact terms as needed.
Editing the proposal discards its loaded review and acknowledgment. A proposal
for another plan hash cannot be submitted. The explicit review acknowledgment
and cookie CSRF precede sending the same in-memory JSON body once. The page never
changes references or substitutes terms automatically.

A frozen original decision replaces the proposal form. Original approval/contract
IDs, frozen terms, graph and token conversion configuration remain inspectable.
Current plan match, original-owner control and recorded expiry are separate.
Approval does not activate spending; activation and payer authorization remain
separate existing steps. This page has no activation, child preparation, payment,
wallet signing or financial settlement command.

Revocation requires a separate acknowledgment. It stops fresh use while preserving
original children and money. Existing run inspection displays gross reservations,
confirmed refunds/payouts, unresolved original buyer amount, actual chain-fee
measurement (unknown stays unknown), original attempt/order/trade IDs and capacity.
Incomplete work cannot be displayed as completed just because approval was revoked.
If a changed graph prevents run reconciliation, the original approval remains
reviewable/revocable and the page says that original money/capacity may remain
unresolved. It never treats failed reconciliation as an absent run or refunded money.

Lost/conflicting commands clear the observation and require manual original-state
refresh before another command. A lost response may already have committed; no
mutation is automatically retried. A subsequent read exposes the same original
approval, preventing a replacement grant. Denied/unavailable reads clear private
observation and proposal data. Inspections expire after 60 seconds, with a second
freshness check on click. Read generations and workflow identity prevent a late
response from restoring data in another workflow. Private JSON stays in memory,
with no local/session storage, URL query or analytics payload.

Current owner transfer removes former inspection/decision access. The current new
owner can inspect original accounting and revoke future use while the original
buyer/provider credentials retain original payment proof, delivery, buyer review,
payout/refund, capacity and private result recovery. No schema or API authority
changes, production flag changes, live wallet funds, push or deployment are needed.
See [the acceptance audit](WORKFLOW_OWNER_REVIEW_AUDIT.md).
