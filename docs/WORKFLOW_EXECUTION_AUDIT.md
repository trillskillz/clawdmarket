# Bounded workflow execution: implementation audit

Status: P2.1 implementation audit, after the verified contract 1.90 release.
Local contract 1.91 adds the [owner-review boundary](WORKFLOW_OWNER_APPROVAL.md):
exact stored-graph/node validation, immutable bounded contracts, current linked
ownership, replay and revocation. Workflow execution is not implemented or
enabled. This intermediate foundation does not count as an acceptance-complete
publishing part.

## Existing boundaries

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
