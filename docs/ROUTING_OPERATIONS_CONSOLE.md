# Routing operations console

Administrators open `/dashboard/admin/routing` from the dashboard's Admin tab.
The console reads the existing private aggregate routing health API and changes
only existing routing admission control. HTTP contracts and SDK operations remain
at local contract 1.97; this interface introduces no new economic API or schema.

## Inspect before acting

Refresh routing state to inspect effective admission, original control revision,
hold source/reason, financial reconciliation and monitor timestamps. Deployment
rollout is displayed separately: resuming database admission cannot open rollout
flags or authorize a buyer. Provider attempts, route progress, original funding,
backed receipts, credit anomalies, outboxes, verification and webhook worker
observations use aggregate counts. Account identities, private work, credentials,
transaction payloads and operator identities are not fetched by this interface.

Observations expire after 60 seconds. Expired, failed or unavailable inspection
disables mutations. Each command checks freshness again when clicked, including
when a background browser has delayed its timers. Refreshing replaces the
previous private observation; auth denial clears it. Read-response generations
prevent a superseded request from restoring stale data.

## Pause or resume

Pause new routing sends the exact displayed control revision to the existing
admin pause API. Only new routed reservations and payment authority are held.
Original payment proof, provider work, delivery, buyer review, refunds, payouts
and capacity recovery keep their existing paths. Other marketplace controls
remain separate. The existing monitor can automatically recover admission after
its independent healthy checks and recovery window; the console displays that
window and current sample count.

Healthy admission can resume only when financial reconciliation is healthy and
no environment hold applies. The server rechecks those conditions in its control
transaction and rejects an old revision. Browser cookie writes require CSRF;
ordinary accounts and organization/agent credentials acquire no admin authority.

After a revision conflict, rejected command or lost response, refresh to inspect
the original control state before another command. The console clears the old
observation and never retries a mutation automatically. A command whose response
was lost might already have committed; inspection reveals its original revision.
On success the console refreshes current state before another command.

## Acceptance

`e2e/routing-operations.spec.ts` uses the built application, actual admin/private
HTTP APIs and a guarded disposable database. It tests anonymous/viewer denial,
CSRF, exact pause/resume, another operator's revision conflict, a real committed
command with a discarded response, a real unbacked-credit anomaly that blocks
resume, stale observation, keyboard operation, clearing private data and mobile
overflow. A second case models an environment hold and closed rollout in the
browser response, then verifies unavailable observation fails closed without
issuing a command. Actual environment-hold authority is covered by the existing
`tests/api/route-control.test.ts`.

Existing route control, operator health and buyer-worker tests prove financial
holds, current revisions, automatic recovery and original paid/refund/payout
recovery. The console's local acceptance and publishing counter are recorded in
[the audit](ROUTING_OPERATIONS_CONSOLE_AUDIT.md) and the master plan. No production
wallet, rollout flag, GitHub push or deployment is needed for these checks.
