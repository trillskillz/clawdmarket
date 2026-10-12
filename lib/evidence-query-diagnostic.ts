/** Fixed-schema EXPLAIN diagnostics only; never arbitrary transport messages. */
export function evidenceQueryDiagnostic(message: string, query: string) {
  const diagnostic = message.match(/parser stack overflow|no such (?:column|table|function): [A-Za-z0-9_.]+|ambiguous column name: [A-Za-z0-9_.]+/)
  if (diagnostic && (diagnostic[0] === 'parser stack overflow' || query.includes(diagnostic[0].split(': ').at(-1)!))) return diagnostic[0]
  const fixedErrors = [
    'circular reference', 'multiple recursive references', 'recursive reference in a subquery',
    'recursive aggregate queries not supported', 'aggregate functions are not allowed',
    'HAVING clause on a non-aggregate query', 'too many terms in compound SELECT',
    'Expression tree is too large', 'query is too complex', 'not authorized',
    'virtual tables cannot be used in recursive queries', 'out of memory',
    'tables in a join', 'malformed JSON', 'JSON path error', 'datatype mismatch',
  ]
  const category = fixedErrors.find(value => message.toLowerCase().includes(value.toLowerCase()))
  if (category) return category
  const knownWords = new Set((query + ' SQLite error syntax near cannot be used allowed supported recursive reference references circular multiple aggregate functions queries HAVING clause on a non-aggregate query too many terms compound SELECT Expression tree is large maximum depth complex not authorized virtual tables out of memory exceeded limit parser stack overflow operation unsupported instruction bytecode failed prepare statement invalid misuse internal at most parsing unrecognized token CTE').toLowerCase().match(/[a-z_][a-z_0-9]*/g))
  // Only vocabulary from the fixed query or fixed compiler terms survives.
  // URLs, credentials, arbitrary identifiers and numbers are redacted.
  const safeMessage = message.slice(0, 1200).replace(/(?:https?|libsql|wss?):\/\/\S+/gi, '[redacted]')
    .replace(/[A-Za-z_0-9]+/g, token => knownWords.has(token.toLowerCase()) ? token : '[redacted]')
    .replace(/\[redacted\](?:\s*\[redacted\])+/g, '[redacted]')
  return `compiler=${safeMessage}`
}
