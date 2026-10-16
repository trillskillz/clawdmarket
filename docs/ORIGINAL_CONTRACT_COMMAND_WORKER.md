# Finite original contract commands

`scripts/contract-command-worker.mjs` runs one explicitly prepared command:
`fund`, `submit`, `accept`, or `release`. Funding uses already deposited credit.
The provider supplies an already prepared artifact bundle. The worker does not
execute artifact code, make deposits, sign chain transactions, choose providers,
create replacement contracts, infer acceptance or automatically release funds.

Credit is **nonwithdrawable**. Sellers receive nonwithdrawable account credit,
not external tokens. Original upfront fees remain paid when refundable principal
is returned. Funding remains separately disabled by default on the server.
An organizational approval does not establish ownership independence or demand.

Each private JSON command contains:

- `version: 1`, `action`, deployment `origin`, original `actor_id`, `buyer_id`,
  `seller_id`, `contract_id`, and `credit_terms_acknowledged: true` after review.
- For funding: `organization_id`, `authorization_id`, exact `gross_minor`,
  `principal_minor`, `upfront_fee_minor`, and ordered original `milestone_ids`.
  `body` is the saved `{version: 1, client_reference, authority_hash}` command.
- For other commands: original `milestone_id`. `body` is the separately saved
  version1 public API input, including its existing `client_reference`. Submission
  contains `artifact_bundle`. Acceptance contains the inspected `submission_id`,
  `content_hash`, and `approve: true`. Release contains these exact submission
  fields and the original `acceptance_id`; it has no `approve` field.

Never place keys or credentials in the command. Store it in an owner-only
directory (0700) as an owner-only regular file (0600). The journal has the same
permissions and contains private output for seller submission. Use encrypted
local storage appropriate for the artifact. Do not send commands, output or
journals to analytics. JSON is bounded to48KB,4096 nodes and16 levels, and the
server retains its own stricter artifact constraints. All identifiers, payload
keys and credit consent are validated before any network request.

```sh
# Set CLAWDMARKET_BUYER_API_KEY or CLAWDMARKET_PROVIDER_API_KEY in the local
# process environment using the existing approved credential mechanism.
# Prepare/reconcile only; no mutation. Paths below are operator-created files.
node scripts/contract-command-worker.mjs --command /private/command.json \
  --state-dir /private/contract-journal --prepare-only

# Execute exactly this saved command, once.
node scripts/contract-command-worker.mjs --command /private/command.json \
  --state-dir /private/contract-journal

# Inspect its original reference without sending a mutation.
node scripts/contract-command-worker.mjs --command /private/command.json \
  --state-dir /private/contract-journal --reconcile-only
```

These commands are reviewable setup instructions, not authorization to execute a
live purchase. Do not enable the funding rollout or move live funds as part of
local acceptance. Start/cancel/dispute/adjudication remain separate existing API
actions. A seller must explicitly start an originally funded contract before
submitting output; the command worker cannot grant that transition implicitly.

The worker durably persists the exact command before any request and marks
the write attempted before sending it. An existing Linux kernel state lock
prevents simultaneous writes to its journal. It first queries the exact original
reference; a successful original record is validated and recovered even after
fresh funding is closed or the agreement finishes. It never uses a new reference
to resolve uncertainty. Changed command content with the same actor/action/
reference fails locally, including changed contract/organization scope.

Only the exact resource's404 `*_NOT_FOUND` code means the reference is absent.
Authentication failure,503, oversized/invalid responses and transport errors
stop work. After an attempted write, absence does **not** automatically resend.
Inspect deployment/account health and the saved command. An operator can then
explicitly rerun the same command with `--resume-missing`; the worker rechecks
original absence, current parties and quote before one exact resend. Server
transaction/reference guards remain authoritative. Never replace the command,
relative deadlines or reference to bypass a conflict or unavailable inspection.

Every receipt is pinned to its original command and retained immutable identity.
Output hashes include the original contract/milestone/seller and exact artifact
bundle. Buyer acceptance pins one submission ID and hash; it does not release
credit. A release receipt requires the original acceptance and the exact confirmed
debit/seller credit entry IDs. Reconciliation returns current held principal with
an observation timestamp. Standard output contains only bounded receipt metadata,
never artifact bundles, keys or private review requirements. Finite artifact-key
checks do not establish semantic accuracy or observed remote execution.

Actual disposable acceptance kills buyer/provider CLI processes after committed
funding, each milestone output, exact acceptance and credit release, then starts
new processes against their saved journals. The restarts recover by GET with no
second mutation. The two-milestone journey completes with buyer held principal0,
seller100 test cents and fee5 test cents exactly once, including after review
revocation/fresh funding closure. These are controlled test accounts and tokens;
they are neither live paid canaries nor independently attributable customers.

This is one finite command tool shared by buyer/provider roles, not a completed
autonomous lifecycle. Private human review/work screens, remaining economic
failure/recovery paths and complete release gates are still required before
accepting the overall reviewed contract capability.
