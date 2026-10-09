# Recorded workflow chain fees — local contract 1.93

Migration 56 adds nullable `chain_fee_evidence_json` fields to original payment
receipts and settlement transfers. Existing records retain null. No amount,
status, spending authority, ceiling, wallet nonce or financial transition is
changed by this additive observation.

The EVM funding API derives fees from its verified on-chain receipt; the
settlement outbox records them with confirmation (or a reverted transfer).
Authenticated caller fields cannot supply fee evidence. Receipt identity binds
chain, original transaction and payer. Canonical integer evidence includes block
identity, gas used, effective gas price, execution fees, blob fees and total native
wei. Arithmetic and identity are checked before storage and reconciliation.

The supported complete model is Ethereum L1 native fees, chains 1 and 11155111.
An EIP-4844 receipt requires both blob gas fields. Other models, missing fields,
historical records and incomplete blob receipts remain unmeasured. Base/Optimism
L1 and operator charges and Tempo fee-token fees are not inferred from execution
gas or approved ceilings. Existing pre-send fee/reserve checks continue to bound
buyer exposure on their supported rails.

Workflow reconciliation separates `actual_buyer_chain_fee_units` from
`actual_treasury_chain_fee_units`, with original per-transaction evidence and an
explicit fee currency. The combined actual total exists only when all original
buyer and reconciled treasury fees are recorded. Otherwise it stays null with
`partially_recorded` or `not_recorded`. Approved `chain_fee_ceiling_units` remain
buyer reservations; treasury costs do not become new buyer spending authority.
No gross or gas allowance is recycled when actual fees are smaller or money is
refunded. Malformed/swapped observations fail closed and cannot fabricate a
measured aggregate. Historical complete receipts keep their immutable content.

The disposable EVM two-node HTTP/provider recovery test compares aggregate
buyer/treasury fees against every original transfer receipt and exact native
balance differences. It also verifies two buyer payments, two seller payouts,
fee-inclusive cost, retained marketplace fees, original receipt recovery and
released capacity. Pure tests exercise blob arithmetic, beyond-64-bit units,
unknown models, absent metadata and identity/arithmetic tampering. Migration 56 replay and full predeploy pass (660 cases: 655 passed, five
skipped), with real EVM and isolated verification enabled. Six final focused
cases, final typecheck/lint, production build and 17 selected Chromium journeys
pass. Evidence paths are recorded in the master plan. Production workflow execution remains closed; P2.1 remains unfinished
until its remaining adverse/retry/crash gate passes. No early publishing (0/10).
