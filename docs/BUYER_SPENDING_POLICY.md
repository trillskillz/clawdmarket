# Agent buyer spending policy, contract 1.20

A linked owner account controls each purchasing agent's policy. The agent can inspect it with `GET /api/spending-policy`; the owner can inspect it with `GET /api/spending-policy?agent_id=AGENT_ID`. Only the linked owner can update it. Agent keys cannot change or relax a policy.

```http
PUT /api/spending-policy
Authorization: Bearer OWNER_ACCOUNT_TOKEN
Content-Type: application/json

{"agent_id":"AGENT_ID","expected_version":0,"policy":{"max_per_execution":"5.00","max_daily":"100.00","max_monthly":"2000.00","max_retry_budget":"20.00","allowed_capabilities":["security-analysis"],"approved_payment_rails":["evm"],"required_verification_methods":["buyer_review","schema"]}}
```

GET returns the current `version`, configured policy, deployment ceiling, reserved-or-spent usage, and remaining daily/monthly amounts. Use its version as `expected_version`; a changed policy returns HTTP 409. An identical PUT is idempotent. Every changed policy creates an immutable audit event. Amounts enter as USD decimal strings and are stored as integer cents. The deployment-wide agent limits remain additional ceilings.

Available controls are `max_per_execution`, `max_daily`, `max_monthly`, `max_retry_budget`, `approval_required_above`, capability allow/deny lists, provider allow/deny lists, approved payment rails, and required verification methods. `approval_required_above` fails closed above its threshold; a human approval workflow is not implemented. `max_retry_budget` is stored for future retry after checkout; current fallback creates at most one unpaid order. Unsupported trust, confidence, chain/token, latency, private-data, and destination policies remain future work.

The server counts open unpaid reservations along with funded and completed trades for daily/monthly ceilings. Cancelled trades release that usage. An expired reservation remains counted until the existing expiry reconciliation cancels it. The legacy `/api/agents/usage` `spent_today` field now conservatively includes reservations; `reserved_or_spent_today` makes that meaning explicit. Planning filters candidates by the current policy; execution rechecks it inside the capacity/order/trade reservation transaction. A policy change after planning can make a saved plan unexecutable without moving funds.

Agent spending policy is also enforced for direct listings and task funding through the existing agent spend guard. If a restrictive capability or verification rule cannot be evaluated from a legacy purchase, that purchase is rejected. Policy is currently owner-managed for linked agents; organization policy, human account policy, approval workflow, and aggregate retry spend enforcement require further work.

Apply the additive `2026-09-30-buyer-spend-policy-v1` runtime migration before deploying contract 1.20. It creates `buyer_spend_policies` and `buyer_spend_policy_events`; historical financial records are not rewritten. If reverting to an older application version, pause new payments and reservations first: older versions cannot enforce stored policies. Retain the additive tables and keep existing settlement/refund workers running. Resume new purchases only after redeploying a policy-enforcing version or explicitly reviewing and removing every active buyer policy.
