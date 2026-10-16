# Security and recovery release prerequisite

The high braces finding reproduces in the old development dependency graph.
The scoped Next16.3.8 code patch and exact-version dependency hook remove its
sole fast-glob use and now-unused vulnerable dependency path. Full/production
audits are clean, frozen installation and three actual lint/root-discovery/drift
regressions pass. Auditing remains enabled. This release changes no purchasing
handler or migration: schema66 is replayed unchanged.

The owner explicitly approved a private full production recovery copy, separate
local restore and encrypted Actions artifact transfer. Production credentials are
sensitive and unavailable for local Vercel downloads; the production environment
allows only protected branches. The optional backup_certificate_base64 mode in
Audit Internal Credits runs from protected main, uses existing credentials for a
read-only native replica, creates a consistent SQLite backup and checks source
counts/integrity/FKs before AES256GCM CMS encryption. Only ciphertext/checksum
are uploaded for at most one day, with runner plaintext cleanup on failure too.
The private RSA3072 key remains in the local mode700 operator directory, mode400.
Download and verify/decrypt privately, validate the separate local restore, then
delete the remote artifact. No plaintext/credentials/private key enter git,
public logs or artifacts; no production restore or application writes occur.

This prerequisite permits a real recovery rehearsal before the cumulative
marketplace release's migration79. It does not claim that rehearsal, the full
marketplace deployment, live paid canaries or independent adoption already passed.
