# Open development dependency risk: braces

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
The current registry still publishes braces 3.0.3. The latest compatible Next
ESLint configuration 16.4.1 still depends on fast-glob; updating it alone does
not remove this finding. No incompatible transitive override was introduced.

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
