/** Disposable financial fixture for the real HTTP/external-verifier browser journey. */
export {}
async function seedPythonVerifierOrder() {
  if (!process.env.TURSO_DATABASE_URL?.startsWith('file:/tmp/clawdmarket-workspace-test-') || process.env.TURSO_AUTH_TOKEN) throw new Error('Disposable local database required')
  const verifierId = process.argv[2]
  if (!/^agent_[a-f0-9-]{36}$/.test(verifierId)) throw new Error('Registered fixture verifier required')
  const { db } = await import('../../lib/db'), s = await import('../../lib/schema')
  const { canonicalJSON } = await import('../../scripts/verifier-contract.mjs'), { createHash } = await import('node:crypto')
  const { captureServiceExecutionContract } = await import('../../lib/service-execution-contract')
  const suffix = crypto.randomUUID(), buyerId = `python-buyer-${suffix}`, sellerId = `python-seller-${suffix}`, ownerId = `python-owner-${suffix}`
  const suite = { version: 1, cases: [{ id: 'echo', args: ['PRIVATE_PYTHON_CASE'], expected: 'PRIVATE_PYTHON_CASE' }] }
  try {
    await db.insert(s.users).values([buyerId, sellerId, ownerId].map((id) => ({ id, name: id, email: `${id}@test.invalid`, password_hash: 'unused', role: 'human' as const })))
    await db.insert(s.agent_owners).values({ agentId: verifierId, userId: ownerId, establishedBy: 'browser-fixture' })
    const [listing] = await db.insert(s.listings).values({ seller_id: sellerId, category: 'skills', title: 'Python browser fixture', description: 'Controlled local verification fixture', price_bankr: 1, status: 'sold' }).returning()
    const [trade] = await db.insert(s.trades).values({ listing_id: listing.id, buyer_id: buyerId, seller_id: sellerId, amount: 1, fee: 0, total_cost: 1, seller_amount: 1, payment_rail: 'ledger', status: 'escrow_held' }).returning()
    const [service] = await db.insert(s.service_definitions).values({ id: crypto.randomUUID(), seller_id: sellerId, title: 'Python browser fixture', description: 'Controlled local verification fixture', capabilities: '["code-review"]', price_minor: 100, active_orders: 1,
      verification_policy: JSON.stringify({ methods: ['buyer_review', 'isolated_checks'], acceptance: { version: 1, mode: 'explicit_buyer' }, isolated_checks: { version: 1, adapter: 'python_tests_v1', verifier_agent_id: verifierId, suite_sha256: createHash('sha256').update(canonicalJSON(suite)).digest('hex'), max_runtime_seconds: 5 } }) }).returning()
    await db.insert(s.service_orders).values({ id: crypto.randomUUID(), service_id: service.id, trade_id: trade.id, listing_id: listing.id, buyer_id: buyerId, client_reference: crypto.randomUUID(), objective: 'Verify Python output', price_minor: 100, payment_rail: 'ledger', state: 'funded', execution_contract_json: captureServiceExecutionContract(service, ['code-review']) })
    await db.insert(s.wallets).values([{ user_id: buyerId, balance: 0, escrow: 1 }, { user_id: sellerId, balance: 0, escrow: 0 }])
    await db.insert(s.transactions).values({ type: 'escrow_lock', amount: 1, reference_id: trade.id })
    process.stdout.write(JSON.stringify({ trade_id: trade.id, buyer_id: buyerId, seller_id: sellerId, suite }))
  } finally { db.$client.close() }
}
seedPythonVerifierOrder().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1 })
