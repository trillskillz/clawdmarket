# Site visual reliability audit

The user requested a rendered-site audit, consistent fonts and visual fixes, then
publication with the accepted workflow/routing work. This branch starts from
workflow acceptance `4c4d998` (HTTP 1.116). Visual changes do not alter the HTTP
contract, schema, settlement behavior or rollout configuration. The combined
release also repairs the database contention failure found by required CI below.

The user's clarification requests both this batch and the existing public-surface
PR #231. That PR's server-rendered catalog/registry/activity, readiness labels,
zero-history trust handling, USD price compatibility and numeric dashboard listing
submission were already integrated in `8bbd7a8` and carried forward in subsequent
releases. Home state, listing form and activation-plan files match its head;
current reputation, credit and privacy changes supersede its older implementations.
Reconcile its ancestry while preserving the accepted current tree, then update
the existing PR branch. There is no second runtime copy of those older changes.

## Findings and corrections

Audited the live site and the accepted local build on twelve public routes:
home, why, marketplace, registry, task board, work, observe, docs, proof, login,
registration and password recovery, at 1440, 390 and 320 pixels. The live and local
baseline each returned 200 for all 36 rendered page/viewport combinations.

The declared Google font import was present in the baseline compiled CSS, but the
rendered documents registered no font faces and used fallbacks. Bundle unmodified
variable WOFF2 assets for Plus Jakarta Sans, Space Grotesk and JetBrains Mono;
inline local font-face declarations during the build and preload their Latin
subsets from the same origin. The 13 supported language subsets total 193,328
bytes; only applicable subsets load. Preserve upstream OFL licenses and source
URLs, SHA-256 digests and sizes in `public/fonts/sources.json`.

Public labels and controls included 6–10px text and very faint neutral text.
Raise small public captions/controls to 12px, use shared body/display/monospace
families, and improve muted text. Align older global and Tailwind surface, text,
border and accent aliases with the existing public palette. Preserve dark text
on orange/lime surfaces and status colors. Maintain visible keyboard focus,
44px shared button targets, 16px mobile text fields and reduced-motion preferences.

Organization review checkboxes inherited full-width, 44px text-field geometry.
Give checkbox/radio controls their own compact dimensions and brand accent.
The actually loaded fonts and larger mobile fields exposed a 9px overflow in
the marketplace filters at 320px; zero-minimum grid tracks and mobile select
sizing keep those fields within the screen.
Stack mobile filter labels above full-width body-font fields so the entire
selected payment-readiness choice remains visible at 320px.
Use dark text for the selected registration role, matching other filled actions.
Hide the decorative navigation version below 360px so the brand, sign-in and menu
retain their gutters and usable targets.
The final browser rerun exposed an intermittent Observe hydration mismatch when
relative timestamps crossed a minute boundary. Pass the server render clock to
the client, retain it for hydration, then advance it on successful market refresh.
Desktop/mobile activity checks deliberately skew the browser clock by two minutes
and assert no browser errors while preserving the real activity/privacy checks.

## Verification

Acceptance passes the broad 62-case Chromium suite, followed by 24 final
public/typography/navigation/listing cases against the exact release build after
the final mobile-filter adjustment. Zero failures, retries or skips in either
accepted pass. Logs: `/tmp/clawdmarket-visual-browser-final.log` and
`/tmp/clawdmarket-visual-browser-release.log`.
The final production build, TypeScript and lint pass in
`/tmp/clawdmarket-visual-build-release.log`,
`/tmp/clawdmarket-visual-types-final.log` and
`/tmp/clawdmarket-visual-lint-final.log`.
The rendered 36-page audit includes footer geometry, no page overflow or outside
elements, no tiny controls, and all three intended fonts actually loaded. Screens
and data: `/tmp/clawdmarket-visual-audit/accepted`; the final 320px filter image is
`/tmp/clawdmarket-visual-audit/marketplace-filters-release-320.png`.
Font assets independently pass WOFF2 signature, declared size and SHA-256 checks;
all three upstream licenses are present. TypeScript and lint pass.

The browser suite blocks Google font services and checks actual loaded font faces,
same-origin font resources, page width, fixed-header clearance, mobile field text
size and readable filled actions across all 36 public renders. Additional checks
cover mobile menus, keyboard focus, reduced motion and review checkbox geometry.
Existing public, wallet/credit, checkout and enterprise/workflow journeys verify
the shared styles against real or controlled fixtures.

The user's follow-up explicitly authorizes GitHub/Vercel publication after
acceptance through required CI, merge, additive migration-first deployment and
same-SHA smoke/live checks. Until that workflow succeeds this remains local
built-site acceptance. The accepted parent retains its fully enabled 852-case
Node gate (847 passes, five
expected skips, zero failures), 18 Python tests, SDK checks, migration/replay and
economic acceptance evidence in the workflow audit. Fixture providers remain controlled fixtures rather
than independent production evidence. The subsequent routing capability remains
independently reviewed task-board purchasing, using its existing dependency audit.

## Required-CI contention repair

The first combined-branch CI run exposed an intermittent separate-process
route/workflow race failure. A local reproduction captured a failed route-state
write and `SQLITE_BUSY: cannot commit transaction - SQL statements in progress`.
Failed autocommit statements could leave the shared local libsql connection
locked, causing both contenders to fail instead of allowing exactly one purchase.

Use the existing bounded fresh-client purchasing transaction helper for route
state/attempt writes and standalone mandated reservations, and the existing
read-only local-contention recovery helper for route preflight reads. Retry only
database transactions, retain the original route, mandate and order references,
and report exhausted contention through existing retryable storage errors.
Workflow child reservations keep their existing workflow transaction helper.
Financial authorization, gross/fee/department ceilings, capacity and idempotency
remain inside the original atomic reservation callback.

The unchanged seven-case workflow authorization suite passes, including the four
separate-process ceiling races and ten SIGKILL boundaries. Sixteen additional
two-core runs repeat each gross, fee, department and capacity race four times;
all pass the original exactly-one-purchase and ledger assertions. TypeScript and
lint pass. Logs: `/tmp/clawdmarket-ci-workflow-authority-fixed.log` and
`/tmp/clawdmarket-route-storage-fixed-{gross,fee,department,capacity}-{0,1,2,3}.log`.
The complete enabled release gate is rerunning before merge because this repair
changes database transaction boundaries. No live production funds are involved.

The next CI run caught overly broad 503 mapping in the contention repair and a
provider-preflight test hook tied to the old shared client. Map only the exact
`PURCHASING_STORAGE_BUSY` code, preserving `PURCHASING_DISABLED`. Observe the
actual fresh-client provider read in the test before mutating through a separate
database connection; retain all original fallback, capacity and no-funds assertions.
All 63 cases across purchasing, workflow authorization and reservation eligibility
pass (31 passes, 32 disposable-chain skips in this focused run); the complete
gate enables both chain binaries and external isolation before merge.
Focused log: `/tmp/clawdmarket-route-contention-regressions-final.log`.

A later CI fee race returned storage contention from both workers alongside an
unavailable local reputation projection. Isolate default local reputation reads
with the existing read-only helper while preserving caller-supplied transaction
sources and truthful unavailable projections. Close failed workflow clients before
the retry delay. Ten repeated two-core fee races pass. A new real SQLite exclusive
lock regression checks unavailable reputation, resumed committed writes and a
current projection after release. The final enabled gate now contains 853 Node
cases; its original five expected skips remain unchanged. Evidence:
`/tmp/clawdmarket-native-reputation-lock-test.log`,
`/tmp/clawdmarket-reputation-fee-race-{0,1,2,3,4,5,6,7,8,9}.log` and
`/tmp/clawdmarket-visual-publication-predeploy.log`: 853 cases, 848 passes,
zero failures and five expected skips. Eighteen Python tests, SDK parity/build,
TypeScript and lint pass. Final production build and 62 Chromium cases pass in
`/tmp/clawdmarket-visual-publication-build.log` and
`/tmp/clawdmarket-visual-publication-browser.log` without retries or skips.

Required CI subsequently passed its unit gate and build, then found the smoke
test's stale 107-row documentation expectation. Five route action rows had brought
the table to 112, but the five reviewed workflow actions were missing from the
human reference. Add those rows, yielding 117, and explicitly check all three
workflow authorization paths. Update route wording to cover both supported rails
and private providers. Scope the rejected reputation-decision
alert to the application main content and assert its exact error text, excluding
Next.js's separate route announcer. These final changes affect browser tests and
the human documentation and this audit; the accepted financial runtime and full
Node gate remain unchanged. Give the private reputation browser fixture the same
test JWT fallback as the server so local admin review remains authenticated.

Final complete Chromium acceptance uses a newly initialized, disposable database
with all 66 migrations: 104 passed, zero failed, zero retries and nine expected
environment-dependent skips across 113 cases. An earlier reused database collided
with the fee-display fixture's unique transaction hash; the clean run preserves
every original financial and presentation assertion. Evidence:
`/tmp/clawdmarket-visual-clean-browser-final.log` (4.0 minutes),
`/tmp/clawdmarket-visual-clean-browser-migrations.log`,
`/tmp/clawdmarket-visual-local-only-build.log` and
`/tmp/clawdmarket-visual-local-only-lint.log`. The final built human reference
contains all 117 rows and the exact workflow paths. No financial runtime changes
followed the fully enabled 853-case acceptance gate.

## Production release-gate correction

PR #231 merged as `9aab6a0` after all four required checks passed. CI independently
passed 104 Chromium cases with nine expected skips and no retries, plus 791 Node
passes and 62 expected environment-dependent skips. The merged tree equals the
accepted review head `bd2a82d`. Evidence: workflow 38344310289 and
`/tmp/clawdmarket-visual-final-ci.log`.

Deployment 38345497758 stopped before production migration or artifact deployment.
One duplicate retry worker exhausted the bounded write-lock preflight and returned
`WORKFLOW_APPROVAL_STORAGE_BUSY` during the unchanged retry/root checkout race.
Read its authority, child counters and exposure ledger in one committed read
transaction instead. Drizzle's installed libsql session ignores transaction config,
so pin read mode only on the helper's fresh client; all existing writer callbacks
and the actual reservation's atomic authority/exposure checks retain write mode.
No public interface, migration, payment or reservation budget changes.

The new regression holds an independent writer with deliberately uncommitted
parent exposure. Preflight validates the original terms and reads the committed
zero exposure/empty ledger while that writer remains open. Its old-write control
reproduces the exact storage-busy failure. Ten two-core runs of the original
retry/root checkout race and all 41 focused workflow budget/approval cases pass
without weakening refund, gross, BigInt fee or exact-one retry assertions.
Evidence: `/tmp/clawdmarket-workflow-read-snapshot-regression.log`,
`/tmp/clawdmarket-workflow-read-snapshot-control.log`,
`/tmp/clawdmarket-workflow-retry-read-race-{0,1,2,3,4,5,6,7,8,9}.log` and
`/tmp/clawdmarket-workflow-retry-read-focused.log`. The enabled 854-case gate passes in
`/tmp/clawdmarket-workflow-read-snapshot-predeploy.log`: 849 passes, five expected
skips and zero failures (18.3 minutes). Eighteen Python cases, SDK parity/build,
TypeScript and lint pass. Final build and complete Chromium acceptance pass in
`/tmp/clawdmarket-workflow-read-snapshot-build.log` and
`/tmp/clawdmarket-workflow-read-snapshot-browser.log`: 104 passes, nine expected
environment-dependent skips, zero failures and zero retries.


## Final production verification (2026-10-13 UTC)

Repair [PR #262](https://github.com/trillskillz/clawdmarket/pull/262) merged as
`1b53230c84709fc42f5a10686fae12183d3b0bd0` after all four required checks passed;
its tree equals accepted review head `497c607`. Required CI 38347284142 passes
792 Node cases with 62 expected environment-dependent skips, zero failures, and
104 Chromium cases with nine expected skips and no retries. The enabled local
gate above additionally exercises both disposable chains and verifier isolation.

[Deployment 38348774805](https://github.com/trillskillz/clawdmarket/actions/runs/38348774805)
passes its 854-case release gate, read-only readiness/reserve preflight, all three
additive production migrations, release-monitor synchronization and all five
production evidence-query checks before artifact deployment. Both aliases point
to `clawdmarket-a3et7f89n-jacob-millers-projects-09998dbb.vercel.app`.
[Production smoke 38349820680](https://github.com/trillskillz/clawdmarket/actions/runs/38349820680)
passes on the same merged SHA: 22 liveness, readiness, authenticated diagnostics,
wallet/account authentication, agent lifecycle, discovery, payment challenge,
private activity and create/cleanup checks. No production paid canary or global
routing rollout is part of this release. Evidence logs:
`/tmp/clawdmarket-visual-production-deploy-success.log` and
`/tmp/clawdmarket-visual-production-smoke-success.log`.

Independent live audit covers twelve public routes at 1440, 390 and 320px on
both `clawdmkt.com` and `www.clawdmkt.com`: 72 HTTP-200 renders, zero horizontal
overflow, zero elements outside the viewport and zero undersized controls. All
three bundled font families load with external Google fonts blocked. Each of the
13 served WOFF2 files on both aliases matches its source signature, size and
SHA-256: 26 asset checks. Both readiness endpoints return 200 and both OpenAPI
surfaces report HTTP contract 1.116 with reviewed workflow paths. Final home
320px, login desktop and marketplace-filter 320px screenshots were visually
inspected. Only navigation-aborted authentication/prefetch requests were recorded;
no font requests failed. Evidence: `/tmp/clawdmarket-visual-production-acceptance.json`
and `/tmp/clawdmarket-visual-audit/production-final-{apex,www}/audit.json` and PNGs.

The user's final publication permission has been used. These completion records
remain local on `work/local-after-final-production-2026-10-13`; all subsequent
changes, tests and documentation must accumulate locally until explicit new
GitHub/Vercel permission. No further publication follows this verification.


A new visual-only follow-up was explicitly requested after this completed release.
The user chose a new follow-up PR and authorized publishing this batch, with all
subsequent work remaining local. See `SITE_VISUAL_FOLLOWUP_AUDIT.md` for current
scope and acceptance; the production evidence above remains the prior baseline.
