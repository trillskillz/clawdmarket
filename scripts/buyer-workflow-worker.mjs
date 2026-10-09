import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { privateKeyToAccount } from 'viem/accounts'
import { Account } from 'viem/tempo'
import { canonicalJSON } from './verifier-contract.mjs'
import { readBuyerPaymentJournal, saveBuyerPaymentJournal } from './buyer-payment-journal.mjs'
import { withBuyerStateLock } from './buyer-wallet-lock.mjs'
import { runBuyerRoute } from './buyer-route-worker.mjs'
import { createBuyerEvmAdapter } from './buyer-evm-adapter.mjs'
import { createBuyerTempoAdapter } from './buyer-tempo-adapter.mjs'

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const sha = /^[a-f0-9]{64}$/, key = /^[a-z][a-z0-9_-]{0,39}$/
const digest = (value) => createHash('sha256').update(canonicalJSON(value)).digest('hex')
const fail = (code) => { throw new Error(code) }

/** Resume an already owner-authorized bounded DAG using the original route workers.
 * @param {{approval:any, apiKey:string, stateDirectory:string, account?:any, adapter?:any, fetcher?:typeof fetch, decisions?:any}} options
 */
export async function runBuyerWorkflow(options) {
  const { approval, apiKey, stateDirectory } = options
  if (!approval || approval.version !== 1 || !uuid.test(approval.workflow_id) || !uuid.test(approval.run_id)
    || !sha.test(approval.contract_hash) || !Number.isSafeInteger(approval.chain_id) || approval.chain_id <= 0
    || !apiKey?.trim() || !stateDirectory || Object.keys(approval).some((field) => !['version', 'origin', 'workflow_id', 'run_id', 'contract_hash', 'chain_id', 'rpc_url'].includes(field))) fail('BUYER_WORKFLOW_CONFIGURATION_INVALID')
  const origin = new URL(approval.origin)
  if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/'
    || origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname))) fail('BUYER_ORIGIN_INVALID')
  const reference = digest({ kind: 'buyer-workflow-v1', ...approval })
  return withBuyerStateLock(stateDirectory, reference, (signal) => pass({ ...options, reference, base: origin.origin, signal }))
}

async function pass({ approval, apiKey, stateDirectory, account, adapter, fetcher = fetch, decisions, reference, base, signal }) {
  const api = async (method, path, body = undefined) => {
    signal.throwIfAborted()
    try {
      const response = await fetcher(`${base}${path}`, { method, redirect: 'error', credentials: 'omit',
        signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]), headers: { Authorization: `Bearer ${apiKey.trim()}`, Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
      const reader = response.body?.getReader(), chunks = []; let size = 0
      if (!reader) fail('BUYER_RESPONSE_INVALID')
      let value
      try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength
        if (size > 262144) fail('BUYER_RESPONSE_TOO_LARGE'); chunks.push(Buffer.from(part.value)) }
        value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
      signal.throwIfAborted()
      if (!response.ok) fail(`BUYER_HTTP_${response.status}`)
      return value
    } catch (error) {
      if (error instanceof Error && /^BUYER_[A-Z0-9_]+$/.test(error.message)) throw error
      fail('BUYER_WORKFLOW_REQUEST_UNCERTAIN_RESUME_ORIGINAL_RUN')
    }
  }
  const path = `/api/workflows/${approval.workflow_id}`, stateFile = resolve(stateDirectory, `${reference}.workflow.json`)
  let journal = await readBuyerPaymentJournal(stateFile)
  if (journal && (journal.version !== 1 || journal.reference !== reference || journal.run_id !== approval.run_id
    || journal.contract_hash !== approval.contract_hash)) fail('BUYER_WORKFLOW_JOURNAL_SCOPE_MISMATCH')
  journal ||= { version: 1, reference, workflow_id: approval.workflow_id, run_id: approval.run_id,
    contract_hash: approval.contract_hash, started_at: null, deadline_at: null, nodes: {}, decisions: {}, receipt_hash: null }
  if (!journal.nodes || typeof journal.nodes !== 'object' || Array.isArray(journal.nodes) || !journal.decisions || typeof journal.decisions !== 'object' || Array.isArray(journal.decisions)) fail('BUYER_WORKFLOW_JOURNAL_SCOPE_MISMATCH')
  journal.nodes = Object.assign(Object.create(null), journal.nodes); journal.decisions = Object.assign(Object.create(null), journal.decisions)
  const save = async () => { signal.throwIfAborted(); await saveBuyerPaymentJournal(stateFile, journal); signal.throwIfAborted() }
  const reviewed = await api('GET', `${path}/approval`), frozen = reviewed.approval?.contract
  if (!frozen || reviewed.approval.contract_hash !== approval.contract_hash || digest(frozen) !== approval.contract_hash
    || frozen.workflow.id !== approval.workflow_id || frozen.terms.payment.chain_id !== approval.chain_id
    || !Array.isArray(frozen.workflow.nodes) || frozen.workflow.nodes.length < 1 || frozen.workflow.nodes.length > 16) fail('BUYER_WORKFLOW_REVIEW_MISMATCH')
  const inspect = async () => {
    const value = await api('GET', `${path}/execute`), run = value.run, nodes = value.receipt?.nodes
    if (run?.id !== approval.run_id || run.workflow_id !== approval.workflow_id || run.contract_hash !== approval.contract_hash
      || run.approval_id !== reviewed.approval.id || !Array.isArray(nodes) || nodes.length !== frozen.workflow.nodes.length
      || new Set(nodes.map((node) => node.planned_route_id)).size !== nodes.length || new Set(nodes.map((node) => node.node_run_id)).size !== nodes.length
      || Object.keys(journal.nodes).some((name) => !nodes.some((node) => node.node_key === name)) || new Set(nodes.map((node) => node.node_key)).size !== nodes.length
      || nodes.some((node) => !key.test(node.node_key) || !uuid.test(node.node_run_id) || !uuid.test(node.planned_route_id)
        || !Array.isArray(node.depends_on) || node.depends_on.length > 15 || node.depends_on.some((dependency) => !nodes.some((item) => item.node_key === dependency)))) fail('BUYER_WORKFLOW_SCOPE_MISMATCH')
    if (!Number.isFinite(Date.parse(run.started_at)) || !Number.isFinite(Date.parse(run.deadline_at))
      || journal.started_at && (journal.started_at !== run.started_at || journal.deadline_at !== run.deadline_at)) fail('BUYER_WORKFLOW_DEADLINE_CHANGED')
    if (Date.parse(run.started_at) > Date.now() || Date.parse(run.deadline_at) !== Math.min(Date.parse(run.started_at) + frozen.workflow.deadline_seconds * 1000, Date.parse(frozen.terms.expires_at))) fail('BUYER_WORKFLOW_DEADLINE_CHANGED')
    for (const node of nodes) {
      const planned = frozen.workflow.nodes.find((item) => item.key === node.node_key)
      if (!planned || canonicalJSON(planned.depends_on) !== canonicalJSON(node.depends_on)
        || Date.parse(node.deadline_at) !== Math.min(Date.parse(run.deadline_at), Date.parse(run.started_at) + planned.deadline_seconds * 1000)) fail('BUYER_WORKFLOW_SCOPE_MISMATCH')
    }
    journal.started_at = run.started_at; journal.deadline_at = run.deadline_at
    for (const node of nodes) {
      const prior = journal.nodes[node.node_key]
      if (prior && prior.planned_route_id !== node.planned_route_id) fail('BUYER_WORKFLOW_CHILD_CHANGED')
      journal.nodes[node.node_key] ||= { planned_route_id: node.planned_route_id, route_id: null, mandate_id: null, terms_hash: null, state: 'planned' }
    }
    await save()
    return value
  }
  let view = await inspect()
  if (decisions !== undefined) {
    if (decisions?.version !== 1 || decisions.workflow_id !== approval.workflow_id || decisions.run_id !== approval.run_id
      || Object.keys(decisions).some((field) => !['version', 'workflow_id', 'run_id', 'decisions'].includes(field))
      || !Array.isArray(decisions.decisions) || decisions.decisions.length > 16
      || new Set(decisions.decisions.map((decision) => decision.node_key)).size !== decisions.decisions.length) fail('BUYER_WORKFLOW_DECISION_INVALID')
    for (const decision of decisions.decisions) {
      if (!journal.nodes[decision.node_key] || decision.decision !== 'accept' || !sha.test(decision.content_hash)
        || Object.keys(decision).some((field) => !['node_key', 'decision', 'content_hash'].includes(field))) fail('BUYER_WORKFLOW_DECISION_INVALID')
      const accepted = view.receipt.nodes.find((node) => node.node_key === decision.node_key)?.settlement
      if (accepted && accepted.delivery_hash !== decision.content_hash) fail('BUYER_WORKFLOW_DECISION_CONFLICT')
      const prior = journal.decisions[decision.node_key]
      if (prior && canonicalJSON(prior) !== canonicalJSON(decision)) fail('BUYER_WORKFLOW_DECISION_CONFLICT')
      journal.decisions[decision.node_key] = decision
    }
    await save()
  }
  const results = []
  for (let passNumber = 0; passNumber < view.receipt.nodes.length; passNumber++) {
    const attempted = new Set(results.map((item) => item.node_key))
    const node = view.receipt.nodes.find((item) => item.phase !== 'completed' && !attempted.has(item.node_key)
      && (item.route_id || item.depends_on.every((dependency) => view.receipt.nodes.find((upstream) => upstream.node_key === dependency)?.phase === 'completed')))
    if (!node) break
    const child = await api('POST', `${path}/nodes/${node.node_key}/prepare`, { version: 1, run_id: approval.run_id })
    if (child.route?.id !== node.planned_route_id || child.node?.run_id !== approval.run_id || child.node.node_key !== node.node_key
      || child.mandate?.id !== child.node.mandate_id || child.mandate.route_id !== child.route.id || !sha.test(child.mandate.terms_hash)
      || child.mandate.terms?.payment?.chain_id !== approval.chain_id) fail('BUYER_WORKFLOW_CHILD_SCOPE_MISMATCH')
    const planned = frozen.workflow.nodes.find((item) => item.key === node.node_key), terms = frozen.terms.nodes.find((item) => item.key === node.node_key)
    const providers = child.mandate.terms.approved_providers
    if (!Array.isArray(providers) || providers.length < 1 || providers.length > 20 || new Set(providers).size !== providers.length
      || providers.some((seller) => typeof seller !== 'string' || !terms.provider_requirements.approved_providers.some((item) => item === seller || seller.startsWith('user_agent_') && item === seller.slice(11)))) fail('BUYER_WORKFLOW_PROVIDER_SCOPE_MISMATCH')
    const payment = { ...frozen.terms.payment, ...(frozen.terms.payment.rail === 'evm' ? { max_gas_cost_wei: terms.max_chain_fee_per_attempt_units } : { max_fee_token_cost_units: terms.max_chain_fee_per_attempt_units }) }
    const expectedTerms = { version: 1, max_aggregate: (planned.budget_minor / 100).toFixed(2), max_per_execution: (terms.max_per_attempt_minor / 100).toFixed(2),
      max_retry_budget: (terms.max_retry_minor / 100).toFixed(2), max_attempts: terms.max_attempts, approved_providers: providers,
      max_latency_seconds: terms.max_latency_seconds, private_data: 'selected_provider_only', expires_at: new Date(Math.floor(Date.parse(node.deadline_at) / 1000) * 1000).toISOString(), payment, ...frozen.token }
    const expectedTermsHash = digest({ ...expectedTerms, max_aggregate: planned.budget_minor, max_per_execution: terms.max_per_attempt_minor, max_retry_budget: terms.max_retry_minor })
    if (expectedTermsHash !== child.mandate.terms_hash || canonicalJSON(expectedTerms) !== canonicalJSON(child.mandate.terms) || child.node.terms_hash !== child.mandate.terms_hash
      || child.route.objective !== planned.objective || canonicalJSON(child.route.required_capabilities) !== canonicalJSON(planned.required_capabilities)
      || child.route.max_budget.amount !== (terms.max_per_attempt_minor / 100).toFixed(2) || child.route.max_budget.currency !== 'USD'
      || canonicalJSON(child.route.verification) !== canonicalJSON(terms.verification)
      || canonicalJSON(child.route.provider_requirements) !== canonicalJSON(terms.provider_requirements)
      || canonicalJSON(child.route.payment_policy) !== canonicalJSON({ allowed_rails: [payment.rail] })
      || canonicalJSON(child.route.retry_policy) !== canonicalJSON({ max_attempts: terms.max_attempts })
      || child.route.deadline_seconds !== planned.deadline_seconds || child.node.deadline_at !== node.deadline_at) fail('BUYER_WORKFLOW_CONTRACT_EXPANSION')
    const prior = journal.nodes[node.node_key], expectedInput = { ...terms.static_input }
    if (!prior.input_hash) {
      for (const mapping of terms.dependency_inputs) {
        const source = view.receipt.nodes.find((item) => item.node_key === mapping.source_node)?.settlement
        const artifact = source?.artifacts?.[mapping.artifact_index], pointer = child.route.input[mapping.target_field]
        if (!artifact || pointer?.kind !== 'workflow_private_artifact_v1' || !uuid.test(pointer.binding_id) || pointer.artifact_id !== artifact.id
          || pointer.sha256 !== artifact.sha256 || pointer.size_bytes !== artifact.size_bytes || pointer.media_type !== artifact.media_type
          || pointer.delivery_hash !== source.delivery_hash) fail('BUYER_WORKFLOW_DEPENDENCY_SCOPE_MISMATCH')
        expectedInput[mapping.target_field] = pointer
      }
      if (canonicalJSON(child.route.input) !== canonicalJSON(expectedInput)) fail('BUYER_WORKFLOW_INPUT_CHANGED')
    } else if (prior.input_hash !== digest(child.route.input)) fail('BUYER_WORKFLOW_INPUT_CHANGED')
    const authorityHash = digest({ kind: 'route-payment-authority-v1', id: child.route.id, buyer_id: frozen.workflow.buyer_id,
      objective: planned.objective, input: child.route.input, capabilities: planned.required_capabilities, max_budget_minor: terms.max_per_attempt_minor,
      deadline_seconds: planned.deadline_seconds, verification: terms.verification, payment: { allowed_rails: [payment.rail] },
      retry: { max_attempts: terms.max_attempts }, providers: terms.provider_requirements })
    if (authorityHash !== child.mandate.route_hash || child.node.route_hash !== authorityHash) fail('BUYER_WORKFLOW_CHILD_SCOPE_MISMATCH')
    if (prior.route_id && (prior.route_id !== child.route.id || prior.mandate_id !== child.mandate.id || prior.terms_hash !== child.mandate.terms_hash)) fail('BUYER_WORKFLOW_CHILD_CHANGED')
    Object.assign(prior, { route_id: child.route.id, mandate_id: child.mandate.id, terms_hash: child.mandate.terms_hash, input_hash: digest(child.route.input) })
    await save() // References are durable before invoking any existing wallet worker.
    const decision = journal.decisions[node.node_key]
    const result = await runBuyerRoute({ approval: { version: 1, origin: base, route_id: child.route.id, mandate_id: child.mandate.id,
      terms_hash: child.mandate.terms_hash, chain_id: approval.chain_id, rpc_url: approval.rpc_url }, apiKey, stateDirectory, account, adapter, fetcher,
      ...(decision ? { decision: { version: 1, route_id: child.route.id, decision: 'accept', content_hash: decision.content_hash } } : {}) })
    prior.state = result.state; prior.trade_id = result.trade_id || null
    await save(); results.push({ node_key: node.node_key, route_id: child.route.id, trade_id: result.trade_id || null, state: result.state,
      delivery: result.delivery || null, result_file: result.result_file || null, artifact_files: result.artifact_files || [] })
    view = await inspect()
  }
  if (view.completed) {
    const settled = await api('POST', `${path}/reconcile`, { version: 1, run_id: approval.run_id })
    if (!settled.completed || !settled.receipt_persisted || !sha.test(settled.content_hash) || digest(settled.receipt) !== settled.content_hash
      || settled.run.id !== approval.run_id || settled.receipt.contract_hash !== approval.contract_hash
      || settled.receipt.nodes.some((node) => node.phase !== 'completed') || settled.receipt.totals.unresolved_buyer_minor !== 0) fail('BUYER_WORKFLOW_RECEIPT_MISMATCH')
    if (journal.receipt_hash && journal.receipt_hash !== settled.content_hash) fail('BUYER_WORKFLOW_RECEIPT_CHANGED')
    journal.receipt_hash = settled.content_hash; await save()
    return { state: 'completed', workflow_id: approval.workflow_id, run_id: approval.run_id, nodes: results,
      receipt: { receipt: settled.receipt, content_hash: settled.content_hash } }
  }
  return { state: results.some((node) => node.state === 'awaiting_buyer') ? 'awaiting_buyer' : 'incomplete',
    workflow_id: approval.workflow_id, run_id: approval.run_id, nodes: results, receipt: null,
    unresolved_buyer_minor: view.receipt.totals.unresolved_buyer_minor, next_action: 'resume_original_children_or_review' }
}

async function cli() {
  const [approvalFile, stateDirectory, decisionFile] = process.argv.slice(2)
  if (!approvalFile || !stateDirectory) fail('BUYER_WORKFLOW_APPROVAL_AND_STATE_REQUIRED')
  const approval = await readBuyerPaymentJournal(resolve(approvalFile)), decisions = decisionFile ? await readBuyerPaymentJournal(resolve(decisionFile)) : undefined
  if (!approval || decisionFile && !decisions) fail('BUYER_WORKFLOW_APPROVAL_AND_STATE_REQUIRED')
  const account = approval.chain_id === 4217 ? Account.fromSecp256k1(process.env.CLAWDMARKET_BUYER_PRIVATE_KEY) : privateKeyToAccount(process.env.CLAWDMARKET_BUYER_PRIVATE_KEY)
  const adapter = approval.chain_id === 4217 ? createBuyerTempoAdapter({ chainId: approval.chain_id, rpcUrl: approval.rpc_url, account })
    : createBuyerEvmAdapter({ chainId: approval.chain_id, rpcUrl: approval.rpc_url, account })
  process.stdout.write(`${JSON.stringify(await runBuyerWorkflow({ approval, apiKey: process.env.CLAWDMARKET_BUYER_API_KEY, stateDirectory, account, adapter, decisions }))}\n`)
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) cli().catch((error) => {
  process.stderr.write(`${/^BUYER_[A-Z0-9_]+$/.test(error.message) ? error.message : 'BUYER_WORKFLOW_STOPPED_RESUME_ORIGINAL_RUN'}\n`); process.exitCode = 1
})
