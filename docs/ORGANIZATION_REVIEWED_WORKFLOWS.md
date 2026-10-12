# Independently reviewed organization workflows

HTTP 1.116 adds separate Ethereum L1 v1 and configured Tempo/pathUSD v2 workflow
authority. This capability is accepted locally as part 6/10; publication remains gated by
ten accepted capabilities.
Legacy workflow approval v1 and organization route v1-v4 preserve their original
hashes and economic meaning. Execution remains behind existing closed rollout gates.

The assigned buyer first creates a bounded `/api/workflows/plan` DAG. The current
linked organization owner proposes its exact graph and original owner approval
body at `POST /api/organizations/{id}/workflow-authorizations`:

- `version`, `client_reference`, `workflow_id`, `reviewer_role_id`.
- `approval`: original exact plan hash, expiry, immutable node/static input and
  declared dependency-artifact mappings, approved providers, explicit buyer review,
  payment wallet/treasury/reserves and whole-workflow gross/fee limits.
- `max_daily`, `max_monthly`, `max_lifetime`: original USD gross ceilings shared
  with standalone reviewed route purchases for the same organization/buyer.
- `max_lifetime_chain_fee_units`: native wei for L1 or fee-token base units for Tempo.
- Optional `private_nodes`: exact node keys and distinct accepted provider share IDs.
  Both original owners, consent references, fingerprint, service and expiry freeze.

Only one attempt per child and zero paid retries are accepted. Pending proposals
reserve no funds or capacity and cannot activate. The selected independent current
purchasing reviewer inspects `/workflow-authorizations/{authorizationId}` and POSTs
`/approval` with the exact version, saved decision reference, authority hash and
`approve:true`. The current owner or selected authorized reviewer can DELETE the
original grant to close fresh commitments.

The organization proposal request is bounded to 16384 bytes, including its nested
approval; node-count and per-input limits also apply. Save proposal and decision
bodies before submission. Owner GET of the collection
with `client_reference` recovers the original proposal after a lost response.
Explicit decision replay uses the same hash/reference and never reopens revoked
state. Both SDKs expose proposal, recovery, inspection, approval and revocation;
mutations are never retried automatically and credentials never gain wider scope.

After approval the existing explicit owner activation uses the original underlying
approval ID and contract hash at `/api/workflows/{workflowId}/execute`. The existing
buyer workflow worker resumes that original run. Child plans/mandates derive from
the frozen graph and current original providers; no standalone grant or supplied
share can authorize a child. Actual dependent artifacts are bound by original
accepted upstream delivery and confirmed financial evidence before preparation.
The assigned spending-scoped buyer may inspect the exact executable child through
its preparation endpoint; ordinary route DTOs redact private candidates/work input,
and read-only credentials cannot inspect private workflow approvals or mandates.
Full private proposal inspection remains owner/selected reviewer only.

Fresh preparation, reservation, intent, claim and SDK send recheck current owner,
buyer assignment, reviewer, department, original consent and service contract.
Atomic child exposure also consumes the same original organization/buyer gross
and same-currency fee history used by standalone routes; workflow ledger records
are counted once. Refunds, cancellation and revocation never recycle that history.
Original paid output, claims/proofs/refunds and confirmed aggregate receipts retain
their original recovery semantics. Existing private artifact recipient permissions
and explicit buyer delivery acceptance remain required.

The private desktop/mobile review lives at
`/organizations/{id}/workflow-authorizations/{authorizationId}`. It displays the
original DAG, budgets, dependency mappings, frozen providers/consents and correct
payment units. The reviewer explicitly confirms; session storage retains only the
original decision identity, and denied inspection clears private content.

Migration `2026-10-12-organization-reviewed-workflows-v1` adds only the independent
review table. Existing workflow/route exposure tables and settlement transitions
remain authoritative. Product, task-board and contract purchases require their
own separately bounded authority and acceptance.
