# Original reviewed contract adjudication recovery (next local dependency)

This is an implementation plan, not an enabled capability. The current migration77
foundation separately labels admin decisions and checks frozen original use/amount
inside their financial transaction. It still has no immutable original admin
receipt or recovery endpoint. Complete that boundary before reviewed funding.
Keep the accepted listing/pilot candidates unchanged. Do not publish, move real
funds, change custody/production flags or contact participants.

Use the original dispute UUID as the saved adjudication reference. Preserve the
existing authenticated-admin policy: buyer_win, seller_win, split and redo. A
selected organizational reviewer is not an administrator, and an administrator's
ruling must never create or be relabeled explicit buyer acceptance. Ordinary
historical contract disputes keep their current behavior; do not backfill inferred
admin operations, buyer consent or financial proof.

Add an append-only operation for NEW reviewed resolutions, bound to original
dispute/contract/milestone/use/authority, authenticated deciding account, exact
ruling (and split percentage), original whole-cent milestone amount and actual
buyer-refund/seller-credit amounts. Pin the exact original contract-settlement
and seller-sale ledger row IDs for financial rulings; redo has no money movement.
Record it in the SAME transaction as dispute closure, original credit distribution
and milestone state. Failure to append must roll all effects back. Protect the
new operation and its original resolved dispute from update/deletion. Preserve
seller submissions and all earlier immutable buyer decisions across redo.

An exact original reference read validates the original use, frozen amounts,
resolved dispute and pinned ledger entries. It must refuse missing/contradictory
financial evidence; raw PAID/COMPLETED/resolved state cannot mint a receipt. A
buyer-directed release operation cannot adopt an admin payout, and an admin
outcome cannot pay an already settled original milestone again. Keep original
financial references and the upfront fee, and retain gross after refund.

Provide separate private participant recovery and authenticated-admin recovery
using the same original dispute ID. Organization ownership/reviewer membership
alone grants no seller output or participant receipt access. Expose the ruling,
actual measured credit distribution, current selected submission/state, observation
time and remaining held principal; do not include private dispute artifacts in
analytics or owner review DTOs. Mutually exclude saved submission, acceptance and
adjudication selectors. Responses are private/no-store. Exact repeated resolution
may retain the legacy409 policy if the original result is recoverable by GET;
never automatically resubmit a changed ruling after an uncertain reply.

Add focused actual API controls for all four rulings, exact pinned financial proof,
wrong actor/foreign reference, a lost committed reply and subsequent read, unchanged
ordinary dispute behavior, injected append failure/rollback, and real admin redo
with identical replacement bytes requiring a new submission-ID-bound acceptance.
Complete migration/replay/local baseline preservation and actual evidence queries.
A new migration, internal helper or passing focused test is not capability9 or
proof of a complete public paid journey, live canary or customer demand.

Then finish public saved-reference seller submission/release adapters and their
SDKs, reviewed funding/use plus durable cross-scope consumed inventory, finite
buyer/provider journals/restarts and private human UI. Only actual multi-milestone
public-path deposit-backed economics, process/HTTP recovery, original refund,
full enabled predeploy/build/browser and accurately failing security gates can
support the eventual local contract release. External risk/provider/inbox/pilot/
publication/live-payment dependencies remain separately recorded.
