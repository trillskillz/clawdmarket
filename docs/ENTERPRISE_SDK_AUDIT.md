# Enterprise SDK acceptance audit

Status: acceptance-complete under local HTTP 1.105. Local counter is 8/10. No schema, new endpoint or payment authority changed.

Both clients bind enterprise paths to generated operations. Owner methods retain
exact reviewed creation references and once-only keys. The distinct cmos_ factory
returns a restricted organization-bound service surface without buyer/provider,
owner or routing methods. Hash proof stays read-only; explicit saved original
Tempo credential submission preserves separate account authentication and may
trigger the guarded server broadcast. Neither client generates references,
signs, calls RPC or retries mutations automatically. Revocation recovery uses
the separate original buyer surface.

`/tmp/clawdmarket-enterprise-sdk-typescript.log` passes 21 named cases, including
four new enterprise path/auth/body/credential/privacy/unknown-reply cases.
`-python.log` passes 17 cases, including four corresponding enterprise wire
cases against an owned localhost fixture. SDK build, typecheck and lint pass.

Initial actual economic matrix reached original queued Tempo refund recovery in
both languages, then the fixture expected `refund_pending` instead of the
existing trade `processing` payout state. Only that assertion changed. The
failed log is `-economic.log`, not acceptance evidence. The next fixture also
needed the existing cron completion reconciliation after outbox confirmation;
its `-economic-final.log` is not accepted. The final fixture explicitly proves
that the buyer read remains processing until the existing read-only original
refund completion reconciliation runs, without a new transfer. Final `-economic-accepted.log` passes both real language matrices: eight private
original purchases across L1/Tempo, four provider restart/review/payout paths,
four revoked late original full refunds and sixteen original transfers. Python
runs in a fresh host process for each operation. No signer or RPC enters an SDK.

Final `-predeploy.log` passes 741 cases: 736 passed, zero failed, five expected
skips, in 611782 ms, including TypeScript, generated parity/SDK build, 17 Python
cases, lint, actual economics, isolated verifiers and legacy migration replay.
`-production-build.log` passes; `-browser.log` passes four owner grant review and
recovery journeys. `-migration.log`, `-migration-replay.log` and `-db-check.log`
retain 62 IDs, integrity ok and zero foreign-key anomalies. Prefixes are
`/tmp/clawdmarket-enterprise-sdk`. No live spending, flag change or publication
occurred.
