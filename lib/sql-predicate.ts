/** Associate fixed internal predicates into a shallow, equivalent boolean tree. */
export function balancedSqlAnd(parts: readonly string[]): string {
  if (!parts.length) throw new Error('A SQL conjunction requires a predicate')
  if (parts.length === 1) return `(${parts[0]})`
  const middle = Math.ceil(parts.length / 2)
  return `(${balancedSqlAnd(parts.slice(0, middle))} AND ${balancedSqlAnd(parts.slice(middle))})`
}
