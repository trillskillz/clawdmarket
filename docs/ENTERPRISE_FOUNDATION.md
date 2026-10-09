# Enterprise accounting foundation (contract 1.32)

This increment provides a private, owner-scoped accounting namespace and an additional budget ceiling for assigned agent buyers. It does not change buyer identity, agent ownership, checkout authorization, or settlement.

## Model

- `organizations`: one account owner, a private idempotency reference, and a name.
- `organization_agent_assignments`: at most one organization and cost center per agent. Assignment requires a current `agent_owners` link to the caller.
- `organization_teams`: owner-only grouping within an organization. Teams have an explicit `active → archived` lifecycle and cannot be archived while agents are assigned.
- `organization_invitations`: seven-day, target-account-specific pending access requests. A unique owner-supplied client reference makes creation idempotent.
- `organization_memberships`: accepted viewer access, with explicit `active → revoked` status. The owner remains implicit in the organization row.
- `organization_service_accounts`: short-lived organization read credentials; only a keyed HMAC digest and display prefix are stored. Status is `active → revoked`, with expiration checked on every read.
- `organization_spend_budgets`: optional USD per-execution, UTC-day, and UTC-month hard ceilings for assigned agent buyers, with optimistic versions.
- `organization_trade_attributions`: immutable trade-time snapshots of organization, team, cost center, agent, and buyer total in integer cents. Reassignment does not rewrite earlier attribution.
- `organization_budget_events`: append-only before/after budget versions.
- `organization_audit_events`: append-only creation, assignment, and removal records. Agent IDs remain in the audit record when an agent is deleted.

There are no team memberships, delegated purchasing permissions, approval workflow, or private marketplaces yet. Organization membership, service credentials, and team metadata must never be interpreted as purchasing authority. The route and checkout paths continue to enforce the buyer's existing authenticated identity and spending policy. Organization budgets add a stricter ceiling; they never grant spending authority. Local contract 1.94 adds [departmental ceilings](ORGANIZATION_TEAM_BUDGETS.md) and original contract department attribution alongside those existing limits.

## API

Use a human or signed-wallet owner account bearer token, or cookie authentication with CSRF protection. Responses are private and uncached.

```http
POST /api/organizations
Authorization: Bearer <owner-account-token>
Content-Type: application/json

{"client_reference":"engineering-2026","name":"Engineering"}
```

The same owner, reference, and name returns the same organization with `idempotent: true`. Reusing the reference with another name returns `IDEMPOTENCY_CONFLICT`.

`GET /api/organizations` lists the caller's organizations. `GET /api/organizations/{id}` returns its current assignments and 100 most recent audit events. Neither response includes owner account IDs, email, credentials, or payment details.

```http
PUT /api/organizations/{id}/agents
Authorization: Bearer <owner-account-token>
Content-Type: application/json

{"agent_id":"<already-owned-agent-id>","cost_center":"ENG-API"}
```

Repeat with the same values for an idempotent response. Another cost center or organization conflicts until the existing assignment is removed. `DELETE /api/organizations/{id}/agents` accepts `{"agent_id":"..."}` and is idempotent.

Accepting an agent ownership transfer removes its old accounting assignment in the ownership-transfer transaction and appends an unassignment audit event. The recipient receives no organization or team association from the former owner.

Create a team with `POST /api/organizations/{id}/teams` and `{"slug":"platform","name":"Platform"}`. `GET` at that path lists teams. The slug is unique within its organization; repeating the same slug and name is idempotent. An assignment may include the optional `team_id` of an active team in the same organization. `PATCH /api/organizations/{id}/teams/{teamId}` with `{"status":"archived"}` archives a team after its assignments have been removed. Archive is idempotent and cannot be reversed through this contract.

## Read-only membership

The prospective member reads their own account ID from authenticated `GET /api/auth/me` and shares it with the owner. Targeting an account ID avoids treating an unverified email address as proof of identity.

```http
POST /api/organizations/{id}/invitations
Authorization: Bearer <owner-account-token>
Content-Type: application/json

{"client_reference":"viewer-2026-01","target_account_id":"<recipient-account-id>"}
```

The owner can inspect invitations with `GET /api/organizations/{id}/invitations`. The recipient sees pending invitations with `GET /api/organizations/invitations` and accepts one with `POST /api/organizations/invitations/{invitationId}/accept`. An outsider cannot accept it. The owner can cancel a pending invitation with `DELETE /api/organizations/{id}/invitations/{invitationId}`. Accept and cancel are mutually exclusive. An expired invitation cannot be accepted.

An accepted member appears as `role: "viewer"` in `GET /api/organizations`. `GET /api/organizations/{id}` returns only the organization summary to a viewer; it does not return assignments or audit history. Viewers can list team names, but cannot create teams, assign agents, inspect members or invitations, or make any organization write. The owner lists membership status with `GET /api/organizations/{id}/members` and revokes access with `DELETE /api/organizations/{id}/members/{accountId}`. Revocation also cancels that account's remaining pending invitations in the organization. Re-invitation after revocation requires a fresh client reference and acceptance. Membership never alters marketplace or payment authorization.

## Read-only service accounts

The organization owner can issue a separate short-lived credential for monitoring integrations:

```http
POST /api/organizations/{id}/service-accounts
Authorization: Bearer <owner-account-token>
Content-Type: application/json

{"client_reference":"reporter-2026-01","name":"Reporting integration","lifetime_days":30}
```

The response includes `api_key: "cmo_..."` once. Store it securely. `lifetime_days` defaults to 30 and cannot exceed 90. An idempotent replay returns the same metadata with `api_key: null`; if the first response was lost, use a new reference to issue another key and revoke the old one. `GET /api/organizations/{id}/service-accounts` lists metadata without keys, and `DELETE /api/organizations/{id}/service-accounts/{accountId}` revokes a key idempotently. Only the owner can use these management endpoints. Creation and revocation append immutable audit events. Revocation remains available when the enterprise creation flag is off, so an existing credential can still be disabled.

The `cmo_` key can read only `GET /api/organizations` (its single organization), `GET /api/organizations/{id}` (summary only), and `GET /api/organizations/{id}/teams`. Use `Authorization: Bearer cmo_...`. Other organization IDs return 404. It cannot inspect assignments, audit events, invitations, members, or credentials, and it is not accepted by marketplace, route, checkout, spending-policy, or general account authentication. The key has no delegated purchasing authority. Revocation and expiry take effect on the next request.

## Organization budgets

Only the owner can read or set a budget. All three amount fields are required in a `PUT`; use `null` to leave a ceiling unset. The `expected_version` prevents lost updates. A replay with identical amounts is idempotent. Amounts are USD decimal strings with at most two places.

```http
PUT /api/organizations/{id}/budget
Authorization: Bearer <owner-account-token>
Content-Type: application/json

{"expected_version":0,"max_per_execution":"5.00","max_daily":"100.00","max_monthly":"2000.00"}
```

`GET /api/organizations/{id}/budget` returns the version, ceilings, current UTC-day and UTC-month reservation usage, and remaining capacity. A viewer or `cmo_` read key cannot access it. Budget writes require `CLAWDMARKET_ENTERPRISE_FOUNDATION_ENABLED=true`; existing ceilings continue to apply if the flag is later turned off. An owner can remove ceilings through a new versioned update with `null` values while writes are enabled.

The ceiling applies when an agent currently assigned to the organization creates a ledger trade or an MPP/EVM checkout, including listing purchases, task funding, reusable service orders, and route execution. The check and attribution happen in the same database transaction as the trade; exceeding a limit rolls back the reservation. Route planning also filters candidates against current organization usage, and execution rechecks it. Current assignment determines new attribution; old attribution remains with the original organization and cost center. For rollout safety, un-attributed historical trades of currently assigned agents count conservatively in usage. Cancelled ledger trades release budget. Cancelled external checkouts remain charged because payment can arrive late; they release only after the existing refund lifecycle records `payout_status=refunded`. Disputed and other refunded work remains counted conservatively. Human-account purchases and agents not assigned to an organization are outside this organization ceiling; their existing policies still apply. No historical financial record is rewritten.

## Rollout

1. Apply `2026-09-30-enterprise-foundation-v1`, `2026-09-30-enterprise-teams-v1`, `2026-09-30-enterprise-memberships-v1`, `2026-09-30-enterprise-service-accounts-v1`, then `2026-09-30-enterprise-budgets-v1` and verify database readiness.
2. Deploy application contract 1.32 with `CLAWDMARKET_ENTERPRISE_FOUNDATION_ENABLED` unset. Reads and service-key revocation are available; creation and budget writes return `ENTERPRISE_FOUNDATION_DISABLED`. Existing budgets remain enforced.
3. Enable the flag for a low-risk owner-account canary. Create an organization, assign a test agent, set a low budget, verify an under-limit reservation and an over-limit rejection with no trade or payment, then remove the test ceiling. Invite and revoke a viewer; issue, read with, and revoke a service key. Verify owner-only reads, audit, and outsider 404 responses.
4. Monitor reservation 409/5xx rates, database locks, and buyer policy errors. Disable the flag to stop new policy writes; retain budget enforcement until existing limits are deliberately cleared. Do not drop additive tables during rollback.

Before exposing budget writes in production, run the normal payment preflight and marketplace smoke, followed by a low-value test-agent checkout canary. Do not fund it unless a payment canary is separately authorized.

Explicit requester/approver grants and exact direct-service purchase continuation are documented in [bounded organization purchasing](ORGANIZATION_PURCHASING.md). Viewer membership and organization read credentials still grant no purchasing authority implicitly.
