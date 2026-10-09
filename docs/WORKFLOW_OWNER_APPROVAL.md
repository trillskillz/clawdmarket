# Workflow owner review

Local contract 1.91 implements the owner-review boundary for bounded workflow
execution. It is an intermediate P2.1 foundation. Execution, aggregate financial
reservation, dependency artifact grants and settlement are still unfinished;
this work does not count as a completed publishing part.

A buyer first creates the explicit graph using `POST /api/workflows/plan`. The
current owner then calls `GET /api/workflows/{id}/approval` to inspect the private
graph and its `plan_hash`. An owner account controls its own buyer or an agent
through the authoritative current `agent_owners` link. Agent keys can read their
own review but cannot approve or revoke it. Cookie mutations require CSRF.

`POST /api/workflows/{id}/approval` freezes the reviewed hash and exact contracts.
The machine-readable body is in `/api/docs` under `approve_workflow`. It requires:

- `version: 1`, a durable `client_reference`, the reviewed `plan_hash`, and an
  `expires_at` timestamp ending `.000Z`, in the next 24 hours.
- `max_gross_minor`, in integer USD cents, including marketplace fees and gross
  retries. It must cover summed node budgets without exceeding the graph budget.
  Refunds cannot recycle that approved gross allowance.
- The existing explicit EVM or Tempo `payment` terms, with payer, chain, token,
  treasury, reserve floors and per-attempt gas/fee limits. The configured rail and
  token terms are checked when recording review. Token decimals/price are saved.
- `max_chain_fee_units`, a separate integer-string aggregate cap: gas wei for
  EVM, fee-token base units for Tempo. It must cover the sum of each node's fee
  ceiling multiplied by its permitted attempts. Tempo requires fee-token terms
  and does not accept historical EVM gas fields.
- `private_data: "selected_provider_only"` and exactly one contract per graph
  node. Each fixes `static_input`, `provider_requirements` with approved sellers,
  `verification` with explicit buyer acceptance, `max_per_attempt_minor`,
  `max_retry_minor`, `max_attempts`, `max_latency_seconds`,
  `max_chain_fee_per_attempt_units`, and `dependency_inputs`.

Original attempt plus gross retry allowance cannot exceed a node's saved budget.
Latency cannot exceed that node's deadline. Attempt limits are one to three;
multiple attempts require a positive gross retry allowance. Every immediate
prerequisite needs an explicit `{source_node, artifact_index, target_field}`
mapping. Artifact indices are zero to seven; target fields cannot overwrite
static inputs, another mapping or prototype/constructor fields. Execution must
later resolve each index against the exact accepted delivery's ordered artifact
IDs, persist its immutable ID/hash and check integrity/retention/current backing
before sending dependent work. Review alone grants no artifact access.

Request size is bounded to 196,608 bytes; static JSON input remains bounded to
8,192 characters per node and verification policy to 8,192 UTF-8 bytes. Graphs
remain capped at sixteen nodes and three dependency edges. Array order of node
contracts, approved providers, verification methods and input mappings is
normalized. Identical references/bodies replay the original approval ID/hash;
changed authority conflicts. Another workflow cannot reuse the owner's reference.

Private inspection returns the frozen original plus current plan integrity,
current ownership, expiry and cancellation observations. A changed graph cannot
gain approval through a stale hash. Saved graph JSON and materialized nodes are
cross-checked. Historical review remains inspectable if the current graph drifts.
Current ownership is rechecked on each request: a former owner loses access after
transfer, and the new owner can revoke the original review with DELETE. Revocation
records the current actor without replacing the original approving owner.

Fresh approval requires workflow planning to be enabled. Original inspection,
exact replay and revocation remain available when planning closes or review
expires; they cannot reopen a revoked review or extend its expiry. Every response
advertises `execution_available: false` and `spending_authority: false`. Approval
IDs are separate from route payment mandate IDs and cannot authorize checkout.
No child route, order, payment, reservation or artifact recipient grant is created.

The additive `2026-10-09-workflow-owner-approval-v1` migration preserves existing
workflow and financial history. Next work must implement the atomic parent/node
exposure boundary and stable child execution/recovery references before any
approval can be consumed. The complete acceptance gate remains in
[WORKFLOW_EXECUTION_AUDIT.md](WORKFLOW_EXECUTION_AUDIT.md).

Validation on 2026-10-09: 627 predeploy cases (622 passed/five host skips),
SDK/typecheck/lint/build, real external verifier isolation, thirteen focused
workflow cases including independent-process races and lock exhaustion recovery,
eight readiness/legacy replay checks, and sixteen actual HTTP/browser journeys
passed. The new review journey proves that a workflow approval ID cannot be used
as route payment authority. These gates do not establish multi-node execution.
