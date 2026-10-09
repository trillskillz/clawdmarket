# Departmental purchasing ceilings — local contract 1.94

The organization owner can set additional per-execution, UTC-day and UTC-month
USD ceilings for an existing team at
`PUT /api/organizations/{id}/teams/{teamId}/budget`. Existing buyer, deployment,
mandate, workflow and organization checks continue to apply. A team assignment
or ceiling grants no new purchasing authority. Delegated purchasing roles,
purchase approvals, private providers and spending service-account credentials
remain unfinished P2.2 work.

```json
{
  "expected_version": 0,
  "max_per_execution": "5.00",
  "max_daily": "20.00",
  "max_monthly": "100.00"
}
```

Each ceiling is a positive whole-cent decimal string or null. Null removes that
departmental ceiling; it does not remove any other policy. A changed update must
match the current version. Exact current-value replay returns the original
version without another event. Changes persist old/new values and an organization
audit event atomically. Bodies are limited to 2048 bytes; cookie writes require
CSRF. Owner-only `GET` returns current ceilings, conservative usage and remaining
daily/monthly allowance, with private no-store headers. Agent, viewer and
organization read keys do not gain budget access or update authority.

Writes use the existing enterprise foundation flag. Previously set limits stay
enforced when that flag is closed; private owner inspection remains available.
Archived departments retain inspection/history and reject updates. Cross-organization
team IDs return 404. Budget-management transactions use disposable connections
with bounded SQLite contention retries, leaving the financial pool unchanged.
Persistent contention returns retryable 503; resume the same original values and
version. No raw credential or private delivery bytes enter budget evidence.

Trade reservation records the current valid organization, department, cost
center and full fee-inclusive integer-cent total in its original attribution.
Department and organization ceilings are checked in the same transaction as
wallet/order/capacity/policy reservation. Failure rolls back those effects.
Listing, task, reusable-service, route and workflow purchases share this existing
attribution boundary. MPP and EVM pending checkouts count toward exposure;
cancellation alone cannot free their allowance. They follow the existing
organization rule and release cancelled exposure only when its refund state is
recorded. Workflow gross budgets remain append-only and never recycle refunds.

Account-credit contract funding now also freezes original department/cost-center
attribution alongside the existing original organization. Its full escrow amount
shares department usage with trades. Failed funding rolls back the draft claim,
attribution and credit debit. Reassignment or removal cannot move a previously
attributed trade or contract. Funded contracts remain conservatively counted;
this change does not alter their release/refund state machines. Historical
un-attributed trades and funded organization contracts are conservatively counted
against currently assigned departments; this is not reconstruction of an unknown
historical department. Migration 57 creates only additive tables and rewrites no
financial history.

Apply migration 57 before publishing the new application. Keep production flags
closed until the existing controlled rollout gates pass. If configured department
limits exist, pause fresh purchases before rolling back to an older application
that cannot enforce them; retain original attribution and money recovery. Closing
enterprise configuration alone is not a substitute for enforcing saved ceilings.

Fresh external funding permission rechecks the original attributed department
and organization, including listing/task checkouts. Lowering a limit or moving
the agent to another department cannot enlarge an original checkout's permission.
Already-broadcast original proof recovery retains its existing path. Unsupported
or malformed stored department ceilings fail closed.

Local validation includes actual API handlers, independent agent and owner
process races, order/capacity rollback, MPP reservation and uncertain cancellation,
owner/agent/outsider/CSRF/body isolation, optimistic updates, archived history,
original funding permission and verified-deposit-backed contract/trade credit
checks. MPP reservation evidence is not an actual MPP transfer. The built-app
Chromium journey verifies owner configuration, registered-agent checkout limits,
exact original replay and private history after reassignment. The master plan
records final gate results. No live funds, global flags, push or deployment.
