# Buyer route orchestration (local contract 1.76)

A buyer-operated worker drives the existing economic route after the owner grants a bounded mandate. It uses the saved selected provider; it never creates its own price, checkout, payout distribution or verifier authority. Provider handlers execute on the provider's machine through the existing leased worker.

## Run a bounded pass

```sh
node scripts/buyer-route-worker.mjs private-approval.json private-shared-state
```

Use the private pinned approval file and buyer-only environment variables from [buyer payment mandates](BUYER_PAYMENT_MANDATES.md). Linux, Node 24 and the shared private wallet state directory are required. Repeating a pass resumes the same economic IDs; an authorized fallback has its own saved operation after exact original refund reconciliation. A file without a mandate only reads the owned plan. Automatic payment supports the documented EVM fee adapters or Tempo pathUSD root accounts; no sponsored/signing relay, swap or replacement payment is supported. An original mandate with positive retry authority can use [reconciled funded fallback](FUNDED_ROUTE_FAILOVER.md).

The worker funds the original selected checkout, requests one lifecycle advance, and returns a current phase/next action. Funded dispatch uses the existing queued provider attempt and signed webhook pointer; repeated observation cannot create another attempt or work order. The provider acknowledges, heartbeats and delivers through its own worker. A plan or unknown payment never dispatches private work.

When output exists, the buyer worker retrieves `/api/routes/{id}/result`. It saves inline private output as a mode-0600 result file and downloads linked artifacts from authenticated fixed-origin trade paths. It checks unique IDs, declared byte count, 64 KiB per file, 256 KiB total, eight files, timeout, no redirects and exact SHA256. Private file names use receipt IDs and hashes; provider names/URLs are never used as host paths. Existing verified private files survive restart and expired server retention. The stdout result contains local file paths and hash metadata, not private contents.

## Explicit acceptance

Read the private result and check the agreed criteria. Supply a separate private decision file:

```json
{
  "version": 1,
  "route_id": "<original route UUID>",
  "decision": "accept",
  "content_hash": "<current delivery SHA256>"
}
```

```sh
node scripts/buyer-route-worker.mjs private-approval.json private-shared-state private-decision.json
```

The worker verifies the current hash and saves the checked decision before submission. The server rechecks the hash and required verification inside the buyer-decision transaction. A stale hash cannot release funds. Observation never creates acceptance. Once a decision may have been submitted, restart replays that same decision; a different file conflicts. Existing trade dispute APIs remain available before the settlement lock. A deterministic or isolated report cannot substitute for the buyer decision or independently establish semantic truth.

## Authoritative settlement and receipt

`GET /api/routes/{id}/advance` is buyer-only/read scope and has no mutation. `POST` requires buyer identity, `payments:write` for named credentials and CSRF for cookies. Commands are strict version-1 `action: observe`, or `action: accept` with the current `content_hash`. One bounded pass repairs funded dispatch and resumes already accepted payout through the shared existing buyer-confirmation implementation. An original payout still confirming returns HTTP 202 and `settling`; escrow/capacity remain held. Timeouts preserve the same outbox and original signed payout. Terminal completion releases capacity through the existing exactly-once transaction.

Migration 42 stores one immutable private route receipt. A completed status flag alone is insufficient. Receipt creation requires matching canonical funding and confirmed payout records (or matching backed-credit settlement entries), committed buyer acceptance, current delivery, terminal order/route and recorded capacity release. Missing financial evidence returns `financial_uncertainty` without a backed receipt. The worker independently checks the receipt fingerprint, original route/trade, mandate/terms hash, accepted delivery, financial kind and release before reporting completion.

The receipt links objective/input/result hashes, selected service/provider protocol, economic/provider attempt IDs, agreed price/fee/total, rail, delivery/artifact hashes, verification categories, buyer decision and financial receipt/transaction references. It excludes raw objective/input/output, artifact names/contents, source URLs, ownership/wallet addresses and credentials. It explicitly reports semantic/provenance/benchmark proof and remote isolation observation as unavailable. Private output retrieval is separate and authenticated.

After a lost response or SIGKILL, rerun the original approval with the same state directory. A settled route retrieves its existing receipt without another payment/payout or capacity decrement. Do not clear journals, create another checkout or assume a timeout means failure. Paid production evidence/global rollout stays deferred to preserve site wallet reserves.

Local contract 1.78 adds [routing admission and monitoring](ROUTING_ADMISSION_CONTROL.md). New routed reservations and send authority can return `ROUTE_EXECUTION_PAUSED`; resume the same route/operation after health recovery. Existing original-payment proofs, delivery review and settlement remain available.
