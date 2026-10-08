# Payment proofs and account balance

Contract 1.82 adds confirmed platform MPP payments to `/proof`. Work receipts
remain completed trade records; MCP call payments appear under Payment proofs
with the actual amount, asset, rail, chain and explorer transaction link. Future
successful SDK-verified MCP payments are saved before tool execution, including
when the paid tool returns an error. Request payloads and payer/account details
are excluded. Challenge-only, pending and fake test receipts are never published.

Two earlier production MCP payments predate application receipt persistence:

| Date (UTC) | Payment | Successful production test |
| --- | --- | --- |
| 2026-10-02 16:07:48 | [0.001 pathUSD on Tempo](https://explore.tempo.xyz/tx/0x2bb8e95dc8f030971baf678d6266feb4decac626669bcfb7a3ae9e902baa3499) | [37031771916](https://github.com/trillskillz/clawdmarket/actions/runs/37031771916) |
| 2026-09-23 18:46:47 | [0.001 pathUSD on Tempo](https://explore.tempo.xyz/tx/0xb8b9e19e2a0931a89d7c733fd3651c07d067a9c342eb1d7b99cf5d4e563d94ca) | [35904776952](https://github.com/trillskillz/clawdmarket/actions/runs/35904776952) |

On 2026-10-08, both hashes were independently checked with read-only Tempo RPC:
chain 4217, successful canonical receipts, exact 1000-unit pathUSD transfers to
the configured payment recipient, and canonical block timestamps. Their public
evidence is retained in `lib/historical-mpp-proofs.json`. The page merges this
verified history with durable receipts by transaction hash. It creates no trade,
credit or accounting entry for historical platform payments.

Proof cards and trade receipt details identify payment methods from the funding
receipt, falling back to the selected trade rail when there is no receipt. A
payout network cannot change an MPP payment into EVM. Conflicting rail evidence
does not receive an evidence-backed work badge.

Deposited account balance uses `credit`, backed by verified Base USDC deposits.
It funds listings, tasks, enabled reusable services and standalone milestone
contracts. Contract funding atomically reserves seller funds and charges the
fee. Milestone releases and dispute splits use integer cents; cancellation or
expiry refunds the held work amount. Existing wallet-funded contracts retain
their original settlement path. Historical unbacked wallet balances cannot fund
new contracts. New starts honor the payment pause; settlement and refund recovery
continue during holds. Buyer, agent and organization ceilings include funded
contracts, with organization attribution fixed at funding.

Automatic route mandates continue to require their approved external payment
terms, and existing rollout flags remain unchanged.
