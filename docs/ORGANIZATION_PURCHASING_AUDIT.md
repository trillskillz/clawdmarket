# Organization purchasing roles and approvals: next capability audit

Starting point: local contract 1.94, two completed local capabilities. This audit
does not increment the publishing counter. Production remains contract 1.90;
all work stays local until ten complete capabilities.

## Existing authority boundaries

- Organization membership is viewer-only. Organization read credentials are a
  separate `cmo_` family that general account/marketplace authentication rejects.
- An organization assignment requires the organization's current owner to own
  the buyer agent through `agent_owners`. Assignments alone grant no payment
  credential, wallet or purchasing permission.
- `buyer-spend-policy.ts` rejects purchases above `approval_required_above`.
  That condition currently has no approval continuation. All per-execution,
  daily/monthly, provider, capability, rail and verification checks still apply.
- Direct service reservation freezes its execution contract and atomically
  creates order, trade, capacity, policy and original organization/department
  attribution. Exact order replay preserves its original economic references.
- Route mandates and workflow owner activation are independent exact authority.
  An organization approval cannot silently replace either boundary.
- Fresh funding rechecks current policy and original attribution. Already-sent
  proof/refund/result recovery must survive a new authority rejection.

## Next supported outcome

An owner explicitly grants a current organization member a bounded requester or
approver role, optionally restricted to a department. A requester submits one
exact service purchase for an already assigned buyer agent. A separate approved
reviewer can approve only the frozen quote within its role's amount, department
and expiry bounds. The actual buyer credential then purchases that same service
with one consumed approval. No viewer/read key gains authority implicitly; a
review does not supply a wallet key or broadcast funds.

Start with direct contracted service orders. Freeze original owner, buyer,
organization/department/cost center, service/seller contract hash, fee-inclusive
total, rail, objective/input/provider-requirement hashes, original checkout
reference and expiration. An approval satisfies only the approval-threshold
condition. Every other buyer/agent/department/organization policy must still
pass. Other purchasing paths and route/workflow authority retain their existing
fail-closed threshold behavior until their exact continuations have acceptance.

Role grants, requests, decisions and consumption need additive durable records
and immutable hashes. Owner changes, membership/role revocation, changed buyer
assignment/ownership, expiry, service contract drift and policy changes stop
fresh use. Original approvals/orders and already-sent money remain recoverable.
Role changes cannot overwrite historical grant authority or revive a revoked
decision. Private inspection is scoped to the current owner, authorized reviewer,
original requester or buyer as appropriate; general viewer access stays narrow.

## Required acceptance

1. Actual HTTP requester, bounded reviewer and registered-buyer flow creates one
   approved order, verified funding, provider delivery, explicit buyer acceptance,
   backed payout and released capacity. Show exact original approval consumption.
2. Missing, copied, changed-input/quote/reference, foreign-organization and
   cross-department approvals fail before wallet/order/capacity effects. Approval
   cannot defeat any existing budget, provider, rail or verification restriction.
3. Race independent reviewers and buyers, kill before/after approval and order
   commits, and recover original immutable references after lost responses.
4. Revoke roles/decisions/membership, transfer ownership, change assignment,
   lower policy limits, expire authority and close flags. Block fresh purchasing
   while preserving original proof/refund/result recovery.
5. Verify owner/member/agent/read-key isolation, private no-store responses,
   CSRF, bounded bodies, additive migration replay, contracts/SDKs and a built-app
   browser journey. Do not count role tables or review endpoints alone as a
   completed purchasing capability.

Private providers and bounded spending service accounts follow this proven
approval isolation. No live funds, production writes, push or deployment is
authorized by this local implementation plan.

## Accepted local outcome

All five acceptance groups pass for bounded direct-service purchasing at 1.95.
Final predeploy passes 686 tests (681 pass/five skips), real dummy-chain deposit
and revoked-payment full refund, independent races, SIGKILL on both sides of
approval/order commits, migration 58 replay, SDK/type/lint/build and 19 selected
built-app journeys (final purchasing/workflow rebuild rerun: three pass). This
is capability 3/10. Production remains 1.90 and closed. See the runbook and
master-plan evidence for precise payment/provider boundaries. Private providers
and spending service-account authority are still the next P2.2 work.
