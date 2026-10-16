# Production read-only recheck — 2026-10-15 16:50:56 UTC

All six public reads were available and are captured in public-final-*.json here.
No remote writes, publication, mail, workflow dispatch or financial execution took
place. These observations supersede earlier baseline counts only as of this time.

| Observation | Read-only evidence | Disposition |
| --- | --- | --- |
| Live HTTP1.116; main96a017b6019920f47af32d86a7e476c9b9c07808 | public-final-contract.json / public-final-main.json | Local1.118/1.119 work remains undeployed. |
| 90 profiles,48 registered,15 online;25 active sellers | public-final-stats.json | No authoritative public cohort attribution; count growth does not establish independent adoption. |
| 353 legacy services_listed;84 services_online | public-final-stats.json | These remain listing-record aliases, not executable-service inventory. |
| 23 total trades,21 completed,$0.92 recorded volume,$0.02 fees;zero recorded24h volume | public-final-stats.json | Recorded totals do not establish qualifying independent/autonomous GMV. No new independent paid activity is demonstrated. |
| security-maintenance38761523868 fails on same main | public-final-security.json / security log summary | One high braces<=3.0.3 finding through eslint-config-next/plugin/fast-glob/micromatch; audit reports patched range<0.0.0. Risk remains tracked, not fixed; no approved exception. |
| Payment monitor38763126626 succeeds on same main | public-final-ci.json / payment-monitor log summary | Checks ready/enabled EVM+MPP and Base/Tempo RPC health only. Not treasury reserve, outbox/anomaly, end-to-end paid canary or customer proof. Do not refresh a paid-canary timestamp. |
| GitHub description still advertises retired self-improvement/evolution and no humans | public-final-repository.json | Prepared corrected description remains unpublished; remote metadata changes are outside authorization. |

Source links:
- https://clawdmkt.com/api/stats
- https://clawdmkt.com/.well-known/clawdmarket.json
- https://github.com/trillskillz/clawdmarket/commit/96a017b6019920f47af32d86a7e476c9b9c07808
- https://github.com/trillskillz/clawdmarket/actions/runs/38761523868
- https://github.com/trillskillz/clawdmarket/actions/runs/38763126626
- https://github.com/trillskillz/clawdmarket

Current local contract checkpoint fba6c92 remains unfinished, migration78,
count8/10 and HTTP1.119; no public reviewed funding/submission/release or full
contract release gate. Source manifest51 files is unchanged by this read-only
bookkeeping. Accepted listing e55e151 (172 source hashes) and pilot bee652c are
clean and unchanged. Do not deploy the unfinished contract tree. Preserve original
financial records and scoped recovery/interlocks on rollback. Prior pilot inbox,
provider admission/calibration, independent demand, publication and capped live
funding/treasury-budget dependencies remain external and unperformed.

Full local log SHA-256 values:
- /tmp/clawdmarket-contract-final-security-run-2026-10-15.log: 8078f49bb609be340272e2665419ceaa5ff7e26808742d1c4d7bbbf05473f553
- /tmp/clawdmarket-contract-final-payment-monitor-2026-10-15.log: 80a7a4bc2516b9a180e79b902ea5b9952d14152f85665e3b9b154391a83d9f1a
