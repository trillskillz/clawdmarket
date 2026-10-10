# Buyer route recovery audit

Acceptance complete locally: P3 private buyer route recovery, publishing counter
**9/10**, HTTP **1.99**. The workspace uses existing buyer-owned route/lifecycle/
retry inspection and original cancellation/payment/refund/paid-work recovery.
Agent ownership is not buyer identity and does not expand access.

Dashboard Route Recovery opens an exact private handle. Saved objective, inputs,
policies and provider choices are private; current work/payment state is separate
from every original attempt, gross amount, order/trade/intent/funding reference,
payment receipt, settlement transfer and held/released capacity. Unknown payment
or unconfirmed transfer remains unknown. Original retry reconciliation grants no
new purchase; no additional signing, funding, fallback, acceptance or settlement
command is added. The page links existing trade controls with original IDs.

Audit found that unqualified DELETE could target a checkout attached after the
buyer inspected a plan. Optional expected_service_order_id (UUID/null) now binds
the original target: planned cancellation uses it in its atomic update, and later
paths reject a different order before touching a trade. Cookie CSRF/buyer scope
precede strict bounded 1-KiB parsing and writes. Existing clients omitting it keep
legacy cancellation/replay. Existing expiry/capacity/payment/refund transitions
remain authoritative; no schema or settlement state machine changes. HTTP 1.99,
generated contracts and TypeScript/Python helpers expose the bound command.

The UI requires fresh inspection and explicit cancellation acknowledgment. It
checks freshness on click, sends once and clears observation until original-state
refresh. Lost/conflicting commands never automatically retry. Unavailable/denied
reads clear private observations; identity/read generations and cross-read current
order/trade matching prevent stale linkage from enabling a command. Success is
reported after fresh inspection completes. Private input/responses stay in page
memory; the page adds no storage, query parameters or custom analytics payloads.

Three new actual built-app browser cases prove planned cancellation, a committed
lost response and original replay, a concurrent checkout rejecting the inspected
null target without changing capacity/order, fresh unpaid cancellation, actual
CSRF, foreign buyer/sign-out clearing and a real linked agent owner denied access
to the agent's route. Stale/unavailable inspection cannot send commands; diagnostic
payloads are not displayed. Keyboard and mobile checks pass; desktop/mobile
screenshots were inspected.

The guarded launcher initializes/migrates a disposable database and starts an
unforked loopback Anvil with public dummy keys and token. After an actual stale
candidate and unpaid fallback, a real mined token payment precedes UI cancellation.
The committed unpaid cancellation reply is lost: one DELETE is sent and original
IDs/capacity/late-payment exposure are recovered. Existing original intent/hash/
payer-signature funding verifies the payment and confirms one full refund. The
payer balance returns exactly to its initial value; proof replay retains one
refund transfer. Another actually funded original checkout rejects stale UI
cancellation, preserving its receipt/hash and held capacity. Two original orders/
trades remain; the final payer difference equals the second original payment.
There is no synthetic funding/refund fixture or new economic order from the UI.

Final predeploy passes **707 cases: 702 passed, five expected skips**, with actual
dummy EVM and isolated verification, TypeScript/lint/SDK checks/build, **13 Python
cases** and migration-60 legacy replay. Focused API/legacy-route/TypeScript client
checks pass **35/35**. Final production build passes with the existing MPP/ox warning.
Existing browser matrix passes **35/35** and actual-chain buyer recovery **3/3**:
**38 executed journeys**, no retries/skips. The final build updates current contract
guidance; accepted page/API behavior is unchanged. Initial shared-catalog API
fixture pollution was corrected by an isolated database; no financial error
expectations or authority checks were relaxed.

Evidence: `/tmp/clawdmarket-route-recovery-predeploy.log`,
`/tmp/clawdmarket-route-recovery-focused.log`,
`/tmp/clawdmarket-route-recovery-build-accepted.log`,
`/tmp/clawdmarket-route-recovery-browser-chain.log`,
`/tmp/clawdmarket-route-recovery-browser-matrix.log` and guarded schema logs.
Runbook: [BUYER_ROUTE_RECOVERY.md](BUYER_ROUTE_RECOVERY.md).
No live funds, production flags, push or deployment. Next: original private buyer
delivery review with exact content-hash acceptance. Publishing remains gated until
ten substantive capabilities pass acceptance.
