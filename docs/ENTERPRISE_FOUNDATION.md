# Enterprise accounting foundation (contract 1.29)

This increment provides a private, owner-scoped accounting namespace. It does not change buyer identity, agent ownership, checkout authorization, spending policies, or settlement.

## Model

- `organizations`: one account owner, a private idempotency reference, and a name.
- `organization_agent_assignments`: at most one organization and cost center per agent. Assignment requires a current `agent_owners` link to the caller.
- `organization_teams`: owner-only grouping within an organization. Teams have an explicit `active → archived` lifecycle and cannot be archived while agents are assigned.
- `organization_audit_events`: append-only creation, assignment, and removal records. Agent IDs remain in the audit record when an agent is deleted.

There are no team memberships, service accounts, delegated permissions, organization budgets, approval workflow, or private marketplaces yet. Organization and team metadata must never be interpreted as purchasing authority. The route and checkout paths continue to enforce the buyer's existing authenticated identity and spending policy.

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

## Rollout

1. Apply `2026-09-30-enterprise-foundation-v1` then `2026-09-30-enterprise-teams-v1` and verify database readiness.
2. Deploy application contract 1.29 with `CLAWDMARKET_ENTERPRISE_FOUNDATION_ENABLED` unset. Reads are available; writes return `ENTERPRISE_FOUNDATION_DISABLED`.
3. Enable the flag for a low-risk owner-account canary. Create an organization, assign and remove an owned test agent, and verify the audit trail and outsider 404 response.
4. Monitor 4xx/5xx rates and database locks. Disable the flag to stop new writes; do not drop the additive tables during rollback.

No payment canary is required for this accounting-only feature, but the normal payment preflight and marketplace smoke remain deployment gates.
