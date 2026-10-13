# Site visual follow-up — 2026-10-13

The user requested another visual audit after the completed release and chose a
new visual follow-up PR. They explicitly authorized publishing this batch, with
all subsequent changes remaining local until new permission. Baseline is main
`1b53230`, the production-verified prior visual/workflow release.

## Remaining issues and resulting behavior

- Claim activation retained an older blue/red/purple palette, a body-font title,
  11px metadata and very dim explanatory text. Its primary action used white text
  on red, and the inline 14px email field suppressed mobile sizing and focus.
  Claim and ownership pages now use the shared surface, signal and font tokens,
  readable labels, display headings, dark primary-action text, 16px claim input
  and visible focus. Responsive padding and wrapping preserve long names,
  capabilities, agent IDs and the exact returned ownership credential.
- Ownership labels/actions were 8–9px and its returned credential did not wrap.
  The corrected browser fixture reproduced hundreds of pixels of horizontal
  overflow on the previous build. Its labels/actions now meet the 12px minimum
  and returned credentials stay within the card without changing their contents.
- Dashboard trade/contract labels, chat metadata, delivery captions and analytics
  tooltips were 9–11px. They now use 12px text. Trade titles and partner names wrap;
  chat removes the fixed 192px minimum inside narrow bubbles. Dashboard mobile
  navigation retains the shared 44px target height. Existing dark text on orange
  message bubbles was already correct and remains preserved.
- Delivery, rating and avatar panels could extend beyond a short mobile viewport
  and remain below fixed navigation through their parent stacking context. Body
  portals place these overlays above navigation; panels stay within the dynamic
  viewport and scroll internally. Close controls and rating stars have 44px
  widths, and avatar grids use four mobile columns and six larger-screen columns.
  Portaled fields retain mobile 16px sizing and visible keyboard focus.
- The universal reset was outside Tailwind's base layer, overriding all utility
  margins and padding. Screenshot review found flush dialog edges even though
  bounds checks passed. The reset now belongs to the base layer; utilities restore
  their intended spacing. Dialog tests explicitly require viewport gutters,
  panel padding and the display font. Restored spacing exposed a long owned-agent
  selector extending 8px past its label. It now uses a full-width block, with
  payout labels wrapping and payout inputs able to shrink.
  Complete acceptance also caught overflow after a reviewed Tempo grant was
  recovered and revoked, then resized to mobile. The spending-account fieldset
  now allows its contents to shrink instead of retaining the browser's intrinsic
  minimum width. Its existing grant/recovery/resize test remains unchanged.
- Toast messages used a lower stacking level than the new dialogs, hiding failed
  review feedback. Messages now appear above dialogs, wrap on mobile and use
  readable theme colors with alert/status semantics. A guarded failed-rating
  fixture verifies the original request body, the dialog staying open, and the
  error message visibly above it.
- Public Observe/Proof status labels still used 7–8px shorthand font declarations,
  task-board flow annotations used 11px, and the home code example fell to 10px
  specifically at tablet widths. These meaningful labels/code now stay at 12px.

Financial, authentication and ownership handlers, API requests, SDKs, migrations,
payment configuration and feature gates retain their existing behavior. The
claim/transfer and account-credit/payout state and handler prefixes are
byte-identical to the baseline.
The existing licensed bundled font files and source hashes remain unchanged.

## Rendered acceptance

The corrected baseline fixture fails both 320px account/dialog tests against the
previous build, reproducing the small text, old claim font/colors, unwrapped long
values, narrow navigation targets and clipped dialog geometry. Evidence:
`/tmp/clawdmarket-visual-followup-baseline-fixture-fixed.log`. An earlier baseline
fixture lacked a signed proxy cookie and is not used as authentication evidence.

The intermediate full suite passed 112 cases with nine expected skips, before
screenshot review found the utility reset issue. Those results do not establish
acceptance of the final spacing/toast/wallet corrections. Updated short-viewport
dialog and failed-rating checks pass at all three widths. The correctly scoped
owned-agent selector control reproduces its 8px overflow against the preceding
build: `/tmp/clawdmarket-visual-followup-wallet-spacing-control.log`.

Final production build, TypeScript and lint pass. Complete 121-case Chromium
acceptance passes on a fresh disposable database with all 66 migrations: 112
passed, nine expected environment-dependent skips, zero failures and zero
retries (5.5 minutes). The unchanged spending-grant regression passes both
individually and in the complete run. All fifteen visual cases pass and cover twelve public routes at 320, 390, 768, 1024 and 1440px; claim,
ownership, chat, trades and wallet with long values at three widths; and delivery,
rating and avatar dialogs at a short 480px height. Font checks block external
Google fonts and require all three bundled families to load. Geometry checks
include dialog padding/gutters, backdrop and toast stacking, internal scrolling,
visible actions and a bounded long-name agent selector. Every account API
response, failed-rating submission and transfer credential in these cases is a
guarded public dummy fixture; no deployed account, key or financial mutation is
involved. Publication follows local acceptance and required CI;
all unrelated or later changes remain local until new explicit permission.

Final evidence: `/tmp/clawdmarket-visual-followup-build-accepted.log`,
`/tmp/clawdmarket-visual-followup-types-final.log`,
`/tmp/clawdmarket-visual-followup-lint-final.log`,
`/tmp/clawdmarket-visual-followup-spending-layout-lint.log`,
`/tmp/clawdmarket-visual-followup-spending-layout-accepted.log`,
`/tmp/clawdmarket-visual-followup-browser-accepted-v2.log` and the final
Playwright report. Claim, ownership, chat, wallet, delivery, rating and failed
review screenshots at 320px were visually inspected. Required CI and exact-SHA
production verification remain the release gates; later work stays local.
