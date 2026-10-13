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
