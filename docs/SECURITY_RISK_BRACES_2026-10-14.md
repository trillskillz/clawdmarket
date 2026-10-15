# Development dependency remediation: braces

## Current disposition — dependency path removed locally, 2026-10-15

The original high finding GHSA-vfj7-8cjw-p6xm / CVE-2026-93687 reproduced before
this change. Stable16.4.2 and canary16.5.0-canary.14 still depend on fast-glob3.3.1;
braces still has no published patched version. Rather than force an incompatible
transitive version, the committed patch replaces the Next16.3.8 plugin's SOLE
fast-glob use (`get-root-dirs.js`) with Node24 `fs.globSync` plus directory filtering.
Patterns are limited to4096 characters and16 nesting levels before native parsing.
Literal directories, braces, extglobs, arrays, missing paths and directory symlinks
are regression tested. This repository configures no custom rootDir patterns.
All existing Next, React, hooks, accessibility and TypeScript lint rules remain;
actual violating source still produces their expected diagnostics.

`patches/@next__eslint-plugin-next@16.3.8.patch` records the code change.
`.pnpmfile.cjs` removes ONLY that now-unused fast-glob dependency from this exact
plugin/version before resolution, and fails closed on unexpected plugin/version/
dependency drift. It does not mute an audit advisory or alter unrelated packages.
The existing libsql patch remains. eslint-config-next is pinned16.3.8 while this
scoped patch is needed. The regenerated lockfile contains no braces, micromatch or
fast-glob path. Frozen-lockfile installation succeeds in an isolated dependency
tree; earlier accepted worktrees' shared modules were not modified.

Fresh full AND production `pnpm audit --audit-level=high --json` return exit0,
zero advisories of any severity and empty muted lists. Three named security
regressions pass, zero skips/failures. This remediates this project's installed
path; it does not claim that upstream braces is patched or the entire app secure.
The unchanged security-maintenance audit still fails on future high findings and
retains raw JSON. Deployment and remote audit results remain pending release gates.

Owner: trillskillz. Reevaluate by2026-10-28 and on any Next ESLint/Node upgrade or
upstream path removal. Remove BOTH scoped patch and dependency hook together only
after a clean frozen install, full audit and equivalent lint regressions. Raw local
evidence: `/tmp/clawdmarket-security-remediation-{full,production}-2026-10-15.json`,
`/tmp/clawdmarket-security-remediation-tests-2026-10-15.log` and
`/tmp/clawdmarket-security-frozen-install-2026-10-15.log`.

## Historical risk treatment before remediation

## Reevaluated 2026-10-15 22:00 UTC — still open

Fresh full audit exits1 with the same single high GHSA-vfj7-8cjw-p6xm finding;
production-only audit exits0 with no advisories. Registry braces remains3.0.3.
The latest eslint-config-next is now16.4.2 and depends on plugin16.4.2, which still
pins fast-glob3.3.1. Metadata inspection does not establish upgrade compatibility
or remediation. The primary GitHub advisory still lists no patched version.
No package, lockfile, override, audit suppression or exception was changed.
Owner, exposure controls, October28 reevaluation and the failed release security
gate remain as below. Evidence: `docs/evidence/reviewed-contract-foundation-2026-10-15/security-reevaluation.json`.

**Disposition: acknowledged and mitigated exposure, not remediated. Release
security gate remains failing.** No exception is granted and no audit is muted.
Owner: repository maintainer `trillskillz` (security-review responsibility). Reevaluate by
**2026-10-28**, immediately on an upstream fix, dependency-path change, or any
change allowing externally supplied ESLint root-directory patterns.

The fresh full `pnpm audit --audit-level=high --json` exits 1 with
[GHSA-vfj7-8cjw-p6xm / CVE-2026-93687](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm):
unbounded recursive parsing of nested brace patterns can exhaust the stack.
Affected versions: `braces <=3.0.3`; patched versions: none published at this
inspection. Exact installed path:

```
eslint-config-next@16.3.8
  → @next/eslint-plugin-next@16.3.8
  → fast-glob@3.3.1 → micromatch@4.0.8 → braces@3.0.3
```

The specified failed security run 38445060809 reports this same advisory.
The current registry still publishes braces 3.0.3. At the October14 inspection, Next ESLint configuration16.4.1 still depended
on fast-glob. The October15 reevaluation below checks the newer16.4.2; neither
inspection identifies a dependency-path fix. No incompatible transitive override was introduced.

Exposure: eslint-config-next is a development dependency. Fresh
`pnpm audit --prod --audit-level=high --json` exits 0 with no advisories. This
does not prove the entire application secure. The Next plugin's
`get-root-dirs` calls fast-glob only for `context.settings.next.rootDir` supplied
by the trusted lint configuration; this repository does not configure that
setting or accept marketplace inputs as ESLint configuration or glob patterns.
Lint operates on the checked-out repository in CI, not customer artifacts.
Review changes to ESLint settings as executable build configuration. Do not run
lint with an untrusted configuration or pass untrusted patterns to this path.
These controls reduce present reachability; the vulnerable package remains.

A bounded local control on Node 24.21.0 compiled nested patterns at depths 10
and 4000 without an exception. The **dependency finding** reproduces; this control
did not reproduce a stack overflow on the deployed Node major. The upstream report
uses Node 26.5.0 and different walkers/stack characteristics. This is not evidence
of remediation or grounds to discard the advisory. Control output is retained in
`/tmp/clawdmarket-braces-reproduction-2026-10-14.log`.

Evidence files (local):
`/tmp/clawdmarket-dependency-audit-before-2026-10-14.json`,
`/tmp/clawdmarket-dependency-production-audit-2026-10-14.json`,
`/tmp/clawdmarket-security-maintenance-failure-2026-10-14.log`, and
`/tmp/clawdmarket-next-eslint-upstream-dependencies-2026-10-14.json`.

Security maintenance now retains the raw JSON audit even when the audit step
fails and uploads this treatment alongside it. The high-severity audit gate is
unchanged. Before publication, either adopt an actual compatible upstream fix
and rerun the full audit, or obtain an explicit, time-limited exception under a
reviewed repository security policy. This document is not that approval.
