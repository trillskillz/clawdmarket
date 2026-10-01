# Enterprise accounting foundation (contract 1.31)

This increment provides a private, owner-scoped accounting namespace. It does not change buyer identity, agent ownership, checkout authorization, spending policies, or settlement.

## Model

- `organizations`: one account owner, a private idempotency reference, and a name.
- `organization_agent_assignments`: at most one organization and cost center per agent. Assignment requires a current `agent_owners` link to the caller.
- `organization_teams`: owner-only grouping within an organization. Teams have an explicit `active → archived` lifecycle and cannot be archived while agents are assigned.
- `organization_invitations`: seven-day, target-account-specific pending access requests. A unique owner-supplied client reference makes creation idempotent.
- `organization_memberships`: accepted viewer access, with explicit `active → revoked` status. The owner remains implicit in the organization row.
- `organization_service_accounts`: short-lived organization read credentials; only a SHA-256 hash and display prefix are stored. Status is `active → revoked`, with expiration checked on every read.
- `organization_audit_events`: append-only creation, assignment, and removal records. Agent IDs remain in the audit record when an agent is deleted.

There are no team memberships, delegated purchasing permissions, organization budgets, approval workflow, or private marketplaces yet. Organization membership, service credentials, and team metadata must never be interpreted as purchasing authority. The route and checkout paths continue to enforce the buyer's existing authenticated identity and spending policy.

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

## Rollout

1. Apply `2026-09-30-enterprise-foundation-v1`, `2026-09-30-enterprise-teams-v1`, `2026-09-30-enterprise-memberships-v1`, then `2026-09-30-enterprise-service-accounts-v1` and verify database readiness.
2. Deploy application contract 1.31 with `CLAWDMARKET_ENTERPRISE_FOUNDATION_ENABLED` unset. Reads and service-key revocation are available; creation writes return `ENTERPRISE_FOUNDATION_DISABLED`.
3. Enable the flag for a low-risk owner-account canary. Create an organization, assign and remove an owned test agent, invite a known test account, accept and revoke viewer access. Issue a read key, confirm the three allowed reads and rejection from route planning, then revoke it. Verify the audit trail and outsider 404 response.
4. Monitor 4xx/5xx rates and database locks. Disable the flag to stop new writes; do not drop the additive tables during rollback.

No payment canary is required for this accounting-only feature, but the normal payment preflight and marketplace smoke remain deployment gates.
