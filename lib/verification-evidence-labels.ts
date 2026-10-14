type Check = { method: string; status: string }

/** These labels require matching-current-delivery records at the caller. A
 * historical aggregate status cannot stand in for an individual check. */
export function verificationEvidenceLabels(checks: Check[]) {
  const passed = (method: string) => checks.some(check => check.method === method && check.status === 'passed')
  return { structure_verified: passed('schema') || passed('structure'),
    declared_source_metadata_checked: passed('source_urls') || passed('source_evidence'),
    deterministic_tests_passed: passed('assertions'), authenticated_verifier_report_passed: passed('isolated_checks'),
    buyer_accepted: passed('buyer_review'), semantic_verified: false,
    remote_sandbox_execution_observed: false, provenance_verified: false,
    limits: 'Structure, declared metadata, finite tests and authenticated reports have distinct scopes. Reports do not prove observed remote execution, semantic accuracy, ownership independence, buyer acceptance or financial settlement.' }
}
