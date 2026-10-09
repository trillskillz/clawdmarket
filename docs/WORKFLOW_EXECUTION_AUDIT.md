# Bounded workflow execution: implementation audit

Status: local contract 1.93 implements the bounded execution model below.
The [owner-review boundary](WORKFLOW_OWNER_APPROVAL.md),
[atomic budgets](WORKFLOW_EXECUTION_BUDGET.md),
[private grants and worker](WORKFLOW_EXECUTION_LOCAL.md) and
[original fee observations](WORKFLOW_CHAIN_FEES.md) compose one capability.
Production activation stays closed. The final acceptance run and publishing
counter are recorded in the master plan; intermediate commits are not separate
capabilities.

## Boundaries retained from the planning-only implementation

- `lib/workflow-planning.ts` normalizes explicit DAGs with at most sixteen nodes,
  three dependency edges, summed integer-cent budgets and ordered deadlines.
  `workflowDto` correctly advertises `execution_available: false`.
- `workflows` and `workflow_nodes` in `lib/schema.ts` store plans only. Their
  states cannot represent execution, recovery or aggregate settlement.
- `lib/route-payment-mandate.ts` binds owner approval to one exact route ID and
  authority hash. Its reservation transaction checks current ownership, expiry,
  provider, rail, verification, latency, per-attempt and gross retry budgets.
  A parent's mandate cannot authorize another route by copying its terms.
- `lib/route-funded-retry.ts` permits a new paid attempt only after the original
  attempt's exact confirmed refund. Cancellation without payment proof retains
  possible late-payment exposure.
- `lib/route-lifecycle.ts` assembles financial, acceptance, artifact and capacity
  evidence for one route. A saved receipt is historical evidence; it cannot
  replace current backing checks before launching a dependent node.
- `lib/private-artifacts.ts` binds encrypted bytes to immutable trade metadata.
  Current downloads authorize the original trade's buyer/seller only; dependency
  transfer needs an explicit recipient grant, not a public URL or copied access.
- `lib/route-execution-timing.ts` normally starts a single route's deadline at
  verified funding. A workflow needs a persisted common deadline so later node
  funding cannot extend the approved objective runtime.

## Required execution model

An authenticated owner approves the canonical DAG and its buyer account or
currently linked agent. The approval freezes node contracts, static inputs,
explicit dependency mappings, permitted artifact sharing, eligible providers,
verification requirements, rail and token terms, retry limits, node money caps
and a parent gross money envelope. No model may add nodes, alter those contracts
or turn a result into purchasing authority. Agent credentials cannot create or
expand owner approval.

At the first execution transaction, persist a common objective deadline and
stable references for the workflow, node, child route and attempts before any
external side effect. Node deadlines are anchored to that common start and
bounded by the parent deadline. Existing route deadlines and retry checks must
respect the inherited absolute bound. Replays return the original references;
they never create another child or reset the clock.

Reserve the original trade's complete buyer cost, including marketplace fees,
against the node and parent in the same transaction as its existing order,
capacity and buyer/agent/organization policy reservations. Reserve gross retry
costs cumulatively. Confirmed refunds are recorded separately and do not recycle
the approved gross budget. Keep native gas and Tempo fee-token ceilings in their
own integer units, with explicit parent aggregate and per-attempt limits; USD
caps cannot silently authorize repeated copies of a chain-fee allowance.
Unknown broadcasts and late-payment possibilities retain their exposure.

Before every fresh reservation or broadcast, recheck current owner links,
revocation, expiry, inherited contract hashes, provider readiness, financial
admission controls, all spending policies and remaining runtime. Expiry,
revocation, cancellation or a routing pause stops new purchases. Original
funding proofs, refunds, payouts, private results and inspection remain
recoverable through the existing state machines.

A dependent node can launch only after every prerequisite's exact delivery,
required verification, explicit buyer acceptance, current financial backing and
exactly-once capacity release are established. Persist selected artifact IDs and
hashes as dependency inputs. Grant only the explicitly approved selected
provider access to those bytes, with integrity, retention and recipient checks.
Changed or invalid prerequisite evidence blocks fresh dependent sends; already
sent work remains an economic recovery obligation.

The aggregate receipt records the frozen plan and authority hashes, original
child references, delivery/dependency hashes, all attempts, buyer totals and
marketplace fees, known chain fees, confirmed refunds/payouts and capacity
releases. Uncertain amounts remain explicit. Whole-workflow completion requires
every required node to have its accepted, backed settlement and no unresolved
financial obligation. Preserve adverse or failed outcomes rather than treating
a partial graph as a successful objective.

## Acceptance gate

1. Complete an actual multi-node HTTP/provider loop on disposable chains. Use
   explicit owner approval, exact upstream artifacts, buyer review and confirmed
   payouts; verify the aggregate receipt against every original trade.
2. Race independent processes at node and parent limits, including retries and
   fee ceilings. Prove atomic reservation, exactly-once capacity and policy
   enforcement without relying on a single process lock.
3. Kill the executor before and after child creation, send, delivery and receipt
   persistence. Recover the original node/route/attempt references; uncertain
   network responses must not duplicate economic side effects.
4. Exercise revoked/transferred ownership, expiry, global pause, stale provider
   contracts, dependency rejection, swapped/purged artifacts and withdrawn
   backing. Fresh work must fail closed while original money recovery continues.
5. Verify original refunds before retries, no budget recycling, common deadline
   preservation and failed-dependency reconciliation without orphaned capacity.
6. Verify owner/agent inspection privacy, CSRF, bounded requests and recovery
   while rollout flags are closed. Update machine contracts and recovery clients
   only for transitions demonstrated by these tests.

This work does not authorize production wallet spending or global rollout flags.
Independent production provider quality and calibration remain separate gates.

## Local acceptance evidence

| Gate | Executed evidence |
| --- | --- |
| Actual paid DAG | `buyer-worker.test.ts` runs real HTTP handlers with a registered buyer agent's named scoped credential, separate owner approval/activation, distinct upstream/downstream provider accounts and processes, explicit hash-bound review and a loopback unforked Anvil EVM. Two original funding transfers, two payouts, one recipient grant and one aggregate receipt match exact token/native wallet changes. The downstream provider cannot download the original source trade artifact. |
| Concurrent budgets | `workflow-execution-budget.test.ts` races independent activation/prepare processes, distinct root checkouts, duplicate retry operations and another root checkout. Atomic ledger/counters retain all original gross cents and beyond-64-bit fee ceilings. Late failure and grant failure roll back order, capacity, policy and mandate exposure. |
| Process death | Actual buyer/provider processes receive SIGKILL after child preparation commits, after wallet claim, after a real accepted broadcast before its response, after delivery commits, before receipt persistence and after receipt commits before its response. Restart recovers original references and exactly one receipt without new economic effects. |
| Adverse evidence | Approval/budget/mandate tests cover current owner transfer, revocation, expiry, cancellation, pause, stale/expanded child contracts, required runtime, missing acceptance, changed dependency basis, purged/swapped encrypted artifacts and withdrawn backing. Historical receipts cannot unlock fresh dependencies. |
| Refund/fallback | The second Anvil HTTP loop funds a prerequisite whose provider declines. Its dependent remains blocked. Explicit dispute resolution confirms the original buyer refund before the bounded approved fallback runs. Closed execution flags preserve original inspection/refund and stop retry. Three original attempts and six transfers reconcile gross 315 cents, refund 100, payouts 200, fees 15, zero unresolved money and released capacity; refunds never recycle gross or chain-fee allowance. The dependent binding references the successful fallback trade. |
| API/client isolation | Owner review and activation are separate from agent payment scope; private inspection, cookie CSRF, bounded writes, exact workflow/run references and recovery under closed flags have API and built-app Chromium coverage. SDK drift and migration replay are required predeploy checks. |

The independent-process budget race uses trusted proof fixtures and no RPC;
the actual payment/refund cases use the disposable EVM. Only Ethereum L1 native
fees have verified complete measured models. Base, Tempo and incomplete fee
observations remain null with an explicit measurement status. Tempo inherited
fee-token terms and existing single-route recovery have coverage; a real
multi-node Tempo payment run is not claimed by this EVM acceptance evidence.
No production provider independence, semantic quality or live canary is implied.
