# Private buyer delivery review

Open **Review original private delivery** from `/routes/{id}`. The review page
requires the original buyer account; a linked human owner does not inherit an
agent's route or acceptance authority. HTTP remains **1.99**, with no schema,
payment or settlement changes.

The page reads the original route, lifecycle, result and verification, and checks
route/order/trade/delivery/hash linkage and current acceptance. It displays private
summary, inline output, exact delivery hash, result fingerprint, and verification
categories/evidence for that exact delivery. Checks describe recorded evidence;
they do not establish semantic truth, independent provenance or observed isolation.
Provider URLs remain plain text and are never retrieved. Untrusted text/JSON is
rendered inertly, without HTML, Markdown, code execution or remote previews.

Every attached artifact is read from a fixed same-origin authenticated endpoint
with redirects rejected, a bounded stream, exact metadata/header size and MIME,
and independent browser SHA-256 checking. Limits mirror existing storage: 64 KiB
per artifact, eight artifacts and 256 KiB total. Text/JSON appears as plain text;
binary content shows checked size/hash. Missing, expired, corrupt or inaccessible
bytes clear the inspection and block acceptance. Reads time out after 15 seconds.
Private content remains in page memory without new storage or analytics payloads.

For original work awaiting review, explicitly acknowledge that you reviewed this
exact delivery and authorize release of its original escrow. The page sends one
existing POST `/api/routes/{id}/advance` with
`{version:1, action:"accept", content_hash:EXACT_INSPECTED_HASH}`. Cookie commands
require CSRF. The server rechecks original buyer authority, delivery hash, required
verification and financial state. It retains the existing buyer decision,
settlement outbox, original payout destination and capacity release rules.

Inspections expire after 60 seconds, including a fresh click-time check. Route
changes invalidate pending reads. Every command clears the inspection and locks
other commands. Conflicts, denied access, unavailable reads and lost responses
require explicit refresh; no command retries automatically. A lost acceptance may
already have committed. Refresh the original delivery/settlement before deciding
anything else; accepted work has no new acceptance control.

Accepted work awaiting payout stays **settling**, with held capacity and no backed
receipt. A submitted transaction is not completion. For already accepted work,
**Recover original accepted settlement** makes one existing `action:"observe"`
pass to resume original settlement or persist its backed receipt. This makes no
new buyer decision or purchase. Completed work must retain original IDs, confirmed
financial evidence, released capacity and the original backed receipt. Contradictory
financial evidence stays unresolved under existing operator/trade recovery.
Dispute controls remain available through existing trade controls.

Build first, then run the guarded Node 24 launcher described in
[BUYER_ROUTE_RECOVERY.md](BUYER_ROUTE_RECOVERY.md). It now runs both buyer recovery
and delivery review browser suites without retries, using a fresh disposable
database and unforked Anvil chain with public dummy wallets. It seeds identities
and service definitions only; funding, artifact upload, provider delivery, buyer
acceptance and payout recovery use actual built-app HTTP and token transactions.
