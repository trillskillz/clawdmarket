# Independently reviewed enterprise workflows — dependency audit and acceptance

The original dependency audit below has now been implemented and accepted as
capability 6/10, HTTP 1.116; see the final acceptance record at the end. It followed the
accepted private-provider routed capability (HTTP 1.115, local batch 5/10); no existing
route grant, direct-service approval or credential becomes workflow authority.

The local implementation already has exact owner-approved DAGs in
`lib/workflow-approval.ts`, bounded child preparation/reservation in
`lib/workflow-execution-budget.ts`, private original dependency grants in
`lib/workflow-artifact-grants.ts` and backed aggregate reconciliation. Existing
workflow approval v1 uses owner control of the buyer, not a selected independent
organization purchasing reviewer. Child preparation calls ordinary `planRoute`,
which intentionally excludes private providers and does not defer buyer approval.
Child mandates are created under the original workflow run/node, not under the
separately reviewed organization route grant. These are separate authority models.

The next complete usable outcome should allow an organization owner to propose a
finite contracted workflow, a separately selected currently authorized independent
reviewer to approve its exact graph and purchasing scope, and the assigned buyer
to complete its dependent public/explicitly shared private provider work over L1
or Tempo with original funding, buyer acceptance and confirmed settlement.

Acceptance requires:

1. Independently versioned owner proposal/reviewer decision binding organization,
   original owners, buyer assignment, department/cost center, reviewer role,
   immutable DAG/node contracts, declared dependency-input mappings, candidate
   contracts, any exact accepted private shares, payment/reserve terms, expiry,
   whole-workflow and original daily/monthly/lifetime gross/fee ceilings. Preserve
   historical workflow v1 and organization route v1-v4 hashes and meaning. Initial
   scope is one attempt per child and zero paid retries; paid fallback is separate.
2. Owner/selected reviewer inspection only of proposal candidates and private
   consent. Existing read/catalog/direct-service credentials stay in their scopes.
   Dependent input cannot be guessed during proposal: freeze its exact allowed
   mapping and require the original accepted upstream artifact/hash on preparation.
3. Internal child evidence deriving solely from the approved workflow/run/node,
   with no caller-supplied grant/share or reusable standalone-route authority.
   Atomically bind original child plan/mandate/order/use, capacity, department,
   organization-wide gross and per-currency fees. Define a single authoritative
   shared exposure history so workflow children neither bypass nor double-count
   existing route purchases. Recheck owner/reviewer/consent/dependency/deadline at
   every fresh child reservation, intent, claim and actual send boundary.
4. Genuine disposable L1 and Tempo multi-node execution with buyer/provider
   restart, original artifact handoff, explicit buyer acceptance per original
   delivery and independently reconciled confirmed payouts/aggregate receipts.
   Revoking consent/reviewer/owner authority stops fresh downstream obligations
   while paid prerequisite output, original claims/proofs/refunds and backed
   aggregate recovery remain available. Refunds never replenish original gross
   or fee exposure or silently approve a replacement child.
5. Cross-workflow/standalone gross, fee, department, capacity and shared-wallet
   races; before/after-commit SIGKILL with original lost-response recovery in both
   SDKs; private desktop/mobile review and all public privacy/evidence regressions;
   additive migration replay, immutable reputation guards, five evidence queries,
   production build and the complete enabled economic/security gate. Count only
   the fully demonstrated workflow outcome.

Task-board funding is separate: `app/api/tasks/[id]/fund/route.ts` binds an accepted
bid/workspace quote and attributes its existing trade; it has no enterprise route
mandate or independently reviewed DAG. Product/listing/contract purchases also
retain their own economic models. Their broader enterprise approvals require
separate bounded grants and acceptance; do not route them through service-order
scope or infer permission from this workflow dependency audit.

Publication retains one demonstrable capability per PR, ten accepted capabilities
per batch, protected CI, migration-first deployment and exact merged-SHA production
verification. No live funds, production flags or deployment are included.


## Complete local acceptance

HTTP 1.116 on `feat/enterprise-reviewed-workflows` derives from accepted parent
`0d9bcd4` in `/home/void/Work/clawdmarket-enterprise-reviewed-workflows`. Separate
L1 v1/Tempo v2 independent grants now bind original workflow approval, frozen
providers and exact accepted private consent. Internal child evidence and original
standalone/workflow history share gross and same-currency fees without double count.
No paid retries; existing workflow/route hashes and original recovery retain meaning.

All six genuine L1/Tempo settlement/refund/downstream-revocation journeys pass;
seven focused authority/privacy cases include four separate-process financial races
and ten before/after-commit SIGKILL boundaries. Build, 66 migrations/replay, integrity,
ten reputation guards and five evidence queries pass. The final forty built browser journeys and complete
852-case enabled gate pass: 847 passed, zero failed and five expected skips.
Eighteen Python cases and real both-SDK lost-response recovery pass. This complete
workflow outcome is accepted as local capability 6/10.
[Current acceptance record](ORGANIZATION_REVIEWED_WORKFLOW_AUDIT.md).

Next dependency audit: [task-board purchasing](ORGANIZATION_REVIEWED_TASK_PURCHASING_PLAN.md).
That audit is not another accepted capability.
