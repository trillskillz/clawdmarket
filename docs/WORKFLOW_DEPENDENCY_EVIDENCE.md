# Current workflow prerequisite evidence

The internal `inspectWorkflowDependencies` read checks the exact owner-reviewed
mapping against the original child route, mandate, fee-inclusive reservation,
funding step, accepted delivery, required verification, current financial backing
and exactly-once capacity release. A historical saved route receipt cannot stand
in for current records. Only the buyer/current linked owner can inspect it.

Artifact indices follow the original ordered attachments in the accepted
`artifact_integrity` verification evidence. Database ID sorting cannot select a
different file. Every attached ID, delivery/order/trade/route/uploader binding,
SHA-256, size and media type must match that evidence. Encrypted payload identity,
bytes and retention are rechecked before returning bounded references and their
basis/binding hashes. Bytes are not included in the response.

Missing acceptance, incomplete settlement, a withdrawn payout, changed funding,
purged bytes, ciphertext swaps, changed metadata and missing references fail
closed. Inspection remains available when execution flags close, but returns no
spending authority and creates no child, order or access grant. Existing artifact
download authorization remains limited to the original trade's buyer/seller.

Validation: the combined workflow budget and private-artifact suites pass 29
actual cases, including five new current dependency cases; typecheck and targeted
lint pass. Fixtures use real local upload/delivery/acceptance transitions and an
explicit trusted mock proof boundary, without RPC transfers or live funds.
Evidence: `/tmp/clawdmarket-workflow-dependency-focused.log`,
`/tmp/clawdmarket-workflow-dependency-typecheck.log`, and
`/tmp/clawdmarket-workflow-dependency-lint.log`.

Next is durable selected-provider artifact grants and dependent-node execution.
The full bounded-DAG acceptance gate and publishing counter remain unchanged.
