# Owner enterprise workspace — local contract 1.98

Open Enterprise in the dashboard, then an organization you currently own.
`/organizations/{id}` privately inspects organization/department budgets, UTC
reserved-or-spent usage, current owner-linked assignments, original purchase
history and recent configuration audit. Viewer membership supplies no owner
configuration or purchase-history authority. The interface reads the existing
organization, team, owned-agent and budget APIs; it creates no financial lifecycle.

Budget forms send the displayed `expected_version`, with fee-inclusive USD
limits. A blank field explicitly removes that ceiling; every other buyer, agent,
organization and department restriction remains authoritative. Selecting a
department inspects its independent budget. Changes preserve historical usage.
Department creation retains the original slug/name idempotency. Agent movement
requires explicit unassignment followed by assignment of an already linked agent,
an active department and cost center. Existing transactional APIs and cookie CSRF
checks govern all commands. There is no automatic two-command reassignment.

Refresh after a conflicting or uncertain command. The interface sends once,
clears its inspection on command start, and refreshes only after a confirmed
success. A lost response may already have committed. It never automatically
retries a write; manual inspection precedes another command. Failed, denied,
unavailable or 60-second-old inspection prevents commands. Freshness is checked
again on submit, including when background timers have stopped. Superseded reads
cannot restore private data. No inspection is stored in browser persistent storage.

`GET /api/organizations/{id}/purchasing/requests` adds current-owner-only metadata
history. Human account authentication is required; active viewers, purchasing
participants and `cmo_`/`cmos_`/registered-agent credentials gain no list authority.
Reads remain available when enterprise writes close. Responses are private and
no-store, vary on Authorization/Cookie, and omit private inputs, objectives,
credential material, actor identities and request/decision hashes.

History uses original request department/cost center, amount including fee,
buyer agent, request state/expiry/creation, approval state/expiry and consumed
original order/trade references. Moving an agent or revoking/expiring a grant does
not relabel its original purchase. Contradictory decision/use hashes, organization,
buyer or amount fail closed without returning partial history. Ownership transfer
removes the previous owner's list access; current owner inspection preserves the
original accounting history and confers no approval or payment authority.

Pagination is descending `created_at`, then descending request ID. `limit` is an
integer 1–50, default 25; `cursor` is the last request ID, which must belong to the
same organization. `next_cursor` is null at the end. Unknown/invalid query fields
are rejected. Page size bounds work; inventory APIs retain their existing bounds
(up to 100 departments, 200 current assignments, 100 recent audit events).

Each request links to the existing exact private purchase review. Private orders
retain their buyer/provider recovery paths; the workspace does not generate
public proofs for private work. Private-provider and spending-account management
links use their original controls. Sent payments, fulfillment, explicit buyer
review, refunds, payouts, capacity recovery and replay keep existing authority.

Acceptance evidence and local batch count live in
[the audit](OWNER_ENTERPRISE_WORKSPACE_AUDIT.md) and the master plan. No schema or
production flag changes, live wallet spending, push or deployment are required.
