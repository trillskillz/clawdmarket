# Owner enterprise workspace audit

Starting counter: 6/10. P3 calls for an owner workspace over current organization,
department and exact purchasing APIs, preserving original history and financial
recovery. Existing APIs provided versioned budgets, team creation and explicit
assignment/unassignment, but no dashboard workspace or purchase-history listing.

The implementation joins those existing controls into a private desktop/mobile
workspace and adds one current-owner metadata history GET on the existing
purchase-requests collection (local contract 1.98). Generated TypeScript/Python
contracts describe it. No schema, budget enforcement, grant, order, funding,
settlement or rollout authority changes are made. Browser commands use current
cookie CSRF and original versions/idempotency; conflicts, loss and stale inspection
require refresh without an automatic write retry. Exact approvals remain on the
original review page.

Acceptance requires actual HTTP/Chromium owner configuration, budget conflicts,
committed-response loss recovery, department ceiling enforcement against actual
exact approval checkout, explicit reassignment without history relabeling,
original replay after revocation, private viewer/auth denial, unavailable/stale
inspection, pagination, keyboard operation and mobile layout. API acceptance
covers owner transfer, participant/read/agent credential denial, bound/foreign
cursor validation, tied ordering, contradictory reference rejection and unchanged
money/capacity. Full predeploy with actual dummy EVM/isolated verification,
build, generated SDK contracts and selected browser regression must pass before
this capability counts. All work remains local under the ten-part publishing gate.

Acceptance is complete at **7/10**. Full predeploy passes **705 cases: 700 passed,
five expected skips** with actual dummy EVM and isolated verification, SDK/Python,
TypeScript/lint and migration-60 legacy replay. Production build passes with the
existing MPP/ox warning. The final browser matrix passes 32 journeys; its external
Python case was initially skipped for an absent opt-in flag, then passed separately
with enforced isolation. **33 executed journeys pass overall**, including both new
owner workspace cases. Both added history API cases pass in the full suite.

Actual acceptance observes CSRF denial, concurrent version conflict, a committed
budget write with discarded response and exactly one PUT, explicit current-state
refresh, organization/department budget configuration, department creation and owner
assignment. An exact human-approved buyer checkout consumes one original order;
a second separately approved purchase hits the configured department daily ceiling.
After approval revocation and explicit reassignment, original history retains its
Engineering cost center/order/trade, Engineering usage stays $1.00, Research stays
$0.00, and the buyer replays the original order. Twenty-six actual requests page
without duplicate/missing IDs. Stale/unavailable observation disables commands and
clears private data; viewer/sign-out denial, dashboard return, keyboard controls and
mobile no-overflow pass. Desktop/mobile screenshots were inspected.

The initial native-select selector now uses its accessible combobox role. Success
messages wait for the actual refreshed inspection. An early browser run started
during the first unfinished build was discarded and rerun after build completion.
No authority, financial or privacy invariant was relaxed.

Evidence: `/tmp/clawdmarket-enterprise-predeploy.log`,
`/tmp/clawdmarket-enterprise-build.log`,
`/tmp/clawdmarket-enterprise-browser-complete.log`,
`/tmp/clawdmarket-enterprise-browser-isolation.log`,
`/tmp/clawdmarket-enterprise-history-tests.log`,
`/tmp/clawdmarket-enterprise-typecheck.log`,
`/tmp/clawdmarket-enterprise-lint.log` and guarded schema logs.
Screenshots: `/tmp/clawdmarket-enterprise-desktop.png` and
`/tmp/clawdmarket-enterprise-mobile.png`. All work remains local.
