/** Finite supported adapters; safe metadata shared with the application. */
export const VERIFIER_ADAPTERS = /** @type {const} */ (['javascript_tests_v1', 'javascript_static_v1', 'python_tests_v1'])
export function verifierArtifactExtension(adapter) {
  if (!VERIFIER_ADAPTERS.includes(adapter)) throw new Error('INVALID_VERIFIER_ADAPTER')
  return adapter === 'python_tests_v1' ? '.py' : '.mjs'
}

/** Canonical JSON for validated, bounded contracts and test suites. @param {unknown} value @returns {string} */
export function canonicalJSON(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).filter(([, entry]) => entry !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJSON(entry)}`).join(',')}}`
  return JSON.stringify(value)
}
