# Routing operations console: capability audit

The next locally actionable master-plan priority after bounded P2.2 service
spending is P3 observation and manual override. Production canaries, independent
providers and calibrated quality retain their recorded external prerequisites.
The implemented console now passes the acceptance gates below and counts as
capability **6/10** over existing HTTP contract 1.97. There is no new economic API,
schema or SDK contract behavior; the usable incident-control outcome is the part.

## Existing authoritative controls

`GET /api/admin/routing/health` already reports private aggregate provider,
funding, receipt, credit, verification, outbox, worker, financial-alert and rollout
observations. `GET/POST /api/admin/routing/pause` uses admin account authority,
cookie CSRF, bounded input, rate limits and an exact expected control revision.
It holds new routed reservations/payment authority while preserving original
proof, delivery, review, payout/refund and capacity recovery. Financial and
environment holds remain authoritative. Database resume cannot open rollout
flags. Monitoring has its existing independent healthy-sample recovery window.

Before this change, the dashboard exposed marketplace payment and reference-fleet
controls without a routing incident console. Operators had to manually compose
HTTP requests to inspect routing health and issue a revision-bound command.

## Accepted usable outcome

An admin-only dashboard link opens a desktop/mobile routing console over those
same endpoints. It displays the observation timestamp, effective admission and
source/reason, rollout flags separately, fixed aggregate alerts, provider and
payment/recovery counts, outbox health and webhook monitor freshness. Manual
refresh reads current state. Old or unavailable observations disable mutations.

Pause/resume uses the exact displayed revision and CSRF token. A conflict,
unhealthy financial observation, environment hold or uncertain mutation response
requires inspection before another operator command. Never automatically retry a
mutation or report success from a lost response. Auth denial clears prior private
data. Read-response races cannot restore stale state over newer inspection.
The page creates no parallel order/payment/settlement lifecycle and changes no
production rollout flag or wallet balance.

## Acceptance gates

- Built-app admin inspection and CSRF-protected pause/healthy resume use the
  original control revision; concurrent commands reject stale views.
- A real aggregate financial anomaly blocks resume without altering underlying
  credit or original money obligations. Environment and monitor holds remain
  distinguishable from closed rollout flags.
- A lost command response forces original-state refresh and never repeats the
  command. An expired/unavailable observation disables controls. Anonymous or
  ordinary accounts receive no private console data.
- Existing reservation/send pause and original-proof/refund/payout recovery
  tests pass. Desktop/mobile layout, keyboard controls, alert accessibility,
  private no-store HTTP and absence of sensitive payloads are exercised.
- Full predeploy, production build and targeted built-app acceptance pass before
  this outcome counts as another local capability. No push/deployment before the
  ten-part gate; no production funds or flags are authorized.

## Executed evidence

The built application preserves the existing proxy's anonymous sign-in and
non-admin dashboard redirects and API 401/403 denial. An admin enters from the
Admin tab, inspects current aggregate health and records a CSRF-protected pause.
A second actual command advances the original revision; the first browser's
stale resume receives 409 and clears its observation. Refresh reads the original
revision before another command. The back link restores the authorized Admin tab
only after the existing account admin check.

A real pause command commits through the actual handler, then the browser loses
its response. Exactly one POST occurs, the original revision advances once, and
the console requires explicit refresh before another command. A one-cent
unbacked-credit fixture produces the existing aggregate invariant and blocks
resume in both UI and the actual transactional API. No revision or underlying
credit changes on rejection. A 65-second client clock advance disables stale
commands; refreshed healthy state resumes through keyboard operation. Sign-out
followed by inspection clears all private observations.

The second browser case models an environment hold and closed rollout in a
private HTTP response, verifies the disabled control and distinct rollout label,
then forces unavailable inspection without sending a command or displaying its
diagnostic payload. Actual environment/stale-monitor holds, revision races,
transaction rollback, monitor recovery and original recovery are covered by the
**14/14** existing control/operator-health acceptance cases and the full buyer
regression suite. No production environment flags changed.

Full predeploy passes **703 cases: 698 passed, five expected skips**, with dummy
EVM and actual isolated verification enabled, SDK/Python/TypeScript, lint and
migration-60 legacy replay. Final typecheck/lint and production build pass with
the existing MPP/ox warning. The final rebuilt application passes **31/31**
selected browser journeys, including both new incident cases, existing admin
navigation and all 29 previously selected enterprise/wallet/workflow/verification
journeys. Desktop/mobile screenshots were inspected. Explicit CSS module
spacing avoids the site's unlayered reset overriding utility padding/margins.

Evidence: `/tmp/clawdmarket-routing-console-predeploy.log`,
`/tmp/clawdmarket-routing-console-focused.log`,
`/tmp/clawdmarket-routing-console-build-complete.log`,
`/tmp/clawdmarket-routing-console-browser-complete.log`,
`/tmp/clawdmarket-routing-console-typecheck-final.log`,
`/tmp/clawdmarket-routing-console-lint-final.log` and
`/tmp/clawdmarket-routing-console-matrix-schema.log`.
Screenshots: `/tmp/clawdmarket-routing-console-desktop.png` and
`/tmp/clawdmarket-routing-console-mobile.png`.

Initial browser assertions assumed an ungated page, an exact cache header and a
unique global alert; they now respect the existing proxy redirects, its extra
`max-age=0` directive and Next's separate route announcer. No authorization,
financial or cache invariant was relaxed. All changes remain local.
