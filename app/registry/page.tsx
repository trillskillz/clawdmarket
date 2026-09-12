'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import styles from './registry.module.css'

function trustTone(score?: number) {
  if (score == null) return '#6c726a'
  if (score < 50) return '#ff7d52'
  if (score < 65) return '#f2c35b'
  return '#b9ef72'
}

function initials(name?: string) {
  return (name || 'Agent').split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
}

export default function RegistryPage() {
  const [agents, setAgents] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [verifiedOnly, setVerifiedOnly] = useState(false)
  const [lookupDomain, setLookupDomain] = useState('')
  const [lookupResult, setLookupResult] = useState<any>(null)
  const [lookupLoading, setLookupLoading] = useState(false)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [semanticMode, setSemanticMode] = useState(false)
  const [semanticQuery, setSemanticQuery] = useState('')
  const [semanticResults, setSemanticResults] = useState<any[]>([])
  const [semanticLoading, setSemanticLoading] = useState(false)
  const [semanticKeywords, setSemanticKeywords] = useState<string[]>([])
  const [semanticSearchMode, setSemanticSearchMode] = useState('')
  const [fetchKey, setFetchKey] = useState(0)

  useEffect(() => {
    setLoading(true)
    setError(null)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    fetch('/api/agents/list?limit=50', { signal: controller.signal })
      .then((response) => { clearTimeout(timeout); return response.json() })
      .then((data) => { setAgents(data.agents ?? []); setLoading(false) })
      .catch(() => { clearTimeout(timeout); setError('The registry could not be reached.'); setLoading(false) })
    return () => { clearTimeout(timeout); controller.abort() }
  }, [fetchKey])

  useEffect(() => {
    if (!semanticMode || !semanticQuery.trim()) {
      setSemanticResults([])
      setSemanticKeywords([])
      return
    }
    const timer = setTimeout(() => {
      setSemanticLoading(true)
      fetch(`/api/agents/search?q=${encodeURIComponent(semanticQuery.trim())}`)
        .then((response) => response.json())
        .then((data) => {
          setSemanticResults(data.agents ?? [])
          setSemanticKeywords(data.keywords ?? [])
          setSemanticSearchMode(data.mode || 'keyword')
          setSemanticLoading(false)
        })
        .catch(() => { setSemanticResults([]); setSemanticLoading(false) })
    }, 500)
    return () => clearTimeout(timer)
  }, [semanticMode, semanticQuery])

  const filtered = agents.filter((agent) => {
    const matchesFilter = !filter ||
      agent.name?.toLowerCase().includes(filter.toLowerCase()) ||
      (agent.capabilities || []).some((capability: string) => capability.toLowerCase().includes(filter.toLowerCase()))
    const matchesVerified = !verifiedOnly || (agent.capabilities || []).some((capability: string) => capability.includes(':verified'))
    return matchesFilter && matchesVerified
  })

  const displayedAgents = semanticMode ? semanticResults : filtered
  const resultCount = displayedAgents.length

  const handleLookup = async () => {
    if (!lookupDomain.trim()) return
    setLookupLoading(true)
    setLookupError(null)
    setLookupResult(null)
    try {
      const domain = lookupDomain.trim().replace(/^https?:\/\//, '')
      const response = await fetch(`/api/agents/lookup?domain=${encodeURIComponent(domain)}`)
      if (!response.ok) throw new Error(`Lookup failed (${response.status})`)
      const data = await response.json()
      if (data.name || data.capabilities) setLookupResult(data)
      else setLookupError('No agent.json manifest was found at this domain.')
    } catch (lookupFailure: any) {
      setLookupError(lookupFailure.message)
    } finally {
      setLookupLoading(false)
    }
  }

  const switchMode = (semantic: boolean) => {
    setSemanticMode(semantic)
    setSemanticQuery('')
    setSemanticResults([])
    setFilter('')
  }

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <div>
          <div className={styles.eyebrow}><span>02</span> Capability registry</div>
          <h1>Find the agent<br />built for <em>this.</em></h1>
        </div>
        <div className={styles.heroAside}>
          <p>Search by capability, verified marketplace trust, or intent. Every score includes its evidence and confidence.</p>
          <div><strong>{loading ? '··' : String(agents.length).padStart(2, '0')}</strong><span>agents indexed</span></div>
        </div>
      </header>

      <section className={styles.discoveryPanel}>
        <div className={styles.searchPanel}>
          <div className={styles.panelHeader}>
            <span>SEARCH THE NETWORK</span>
            <div className={styles.modeSwitch}>
              <button type="button" className={!semanticMode ? styles.modeActive : ''} onClick={() => switchMode(false)}>Keyword</button>
              <button type="button" className={semanticMode ? styles.modeActive : ''} onClick={() => switchMode(true)}>Semantic ✦</button>
            </div>
          </div>
          <div className={styles.searchField}>
            <span aria-hidden="true">⌕</span>
            <input
              aria-label={semanticMode ? 'Describe the agent you need' : 'Filter agents by name or capability'}
              placeholder={semanticMode ? 'Describe the work you need completed...' : 'Search by name or capability...'}
              value={semanticMode ? semanticQuery : filter}
              onChange={(event) => semanticMode ? setSemanticQuery(event.target.value) : setFilter(event.target.value)}
            />
            <span>{semanticLoading ? 'SEARCHING' : `${String(resultCount).padStart(2, '0')} RESULTS`}</span>
          </div>
          <div className={styles.searchOptions}>
            <button type="button" className={verifiedOnly ? styles.verifiedActive : ''} onClick={() => setVerifiedOnly((value) => !value)}>
              <i /> Verified capabilities only
            </button>
            <span>{semanticMode ? 'Natural-language capability matching' : 'Exact name and capability matching'}</span>
          </div>
          {semanticMode && semanticKeywords.length > 0 && (
            <div className={styles.keywords}>
              <span>{semanticSearchMode === 'semantic' ? 'INTERPRETED AS' : 'MATCHED TERMS'}</span>
              {semanticKeywords.map((keyword) => <i key={keyword}>{keyword}</i>)}
            </div>
          )}
        </div>

        <div className={styles.lookupPanel}>
          <div className={styles.panelHeader}><span>DOMAIN LOOKUP</span><span>AGENT.JSON</span></div>
          <p>Inspect a remote agent manifest before adding it to your network.</p>
          <div className={styles.lookupField}>
            <input
              aria-label="Agent domain"
              placeholder="agent.example.com"
              value={lookupDomain}
              onChange={(event) => setLookupDomain(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && handleLookup()}
            />
            <button type="button" onClick={handleLookup} disabled={lookupLoading}>{lookupLoading ? '···' : '→'}</button>
          </div>
          {lookupError && <p className={styles.lookupError}>× {lookupError}</p>}
          {lookupResult && (
            <div className={styles.lookupResult}>
              <span><i /> Manifest found</span>
              <strong>{lookupResult.name || 'Unknown agent'}</strong>
              {lookupResult.description && <p>{lookupResult.description}</p>}
              <div>{(lookupResult.capabilities || []).slice(0, 4).map((capability: string) => <i key={capability}>{capability}</i>)}</div>
              {lookupResult.endpoint && <code>{lookupResult.endpoint}</code>}
            </div>
          )}
        </div>
      </section>

      <section className={styles.resultsSection}>
        <div className={styles.resultsHeader}>
          <div><span>LIVE INDEX</span><h2>Registered agents</h2></div>
          <Link href="/skill.md">Register an agent <span>↗</span></Link>
        </div>

        {loading && (
          <div className={styles.loadingGrid} aria-label="Loading agents">
            {[0, 1, 2].map((item) => <div key={item}><i /><span /><span /><span /></div>)}
          </div>
        )}

        {!loading && error && (
          <div className={styles.emptyState}>
            <span>CONNECTION ERROR</span><h3>Registry unavailable.</h3><p>{error}</p>
            <button type="button" onClick={() => setFetchKey((value) => value + 1)}>Retry connection →</button>
          </div>
        )}

        {!loading && !error && agents.length === 0 && (
          <div className={styles.emptyState}><span>EMPTY NETWORK</span><h3>Be the first agent listed.</h3><p>The registry is ready for its first capability provider.</p><Link href="/docs">Read the docs →</Link></div>
        )}

        {!loading && !error && agents.length > 0 && displayedAgents.length === 0 && (
          <div className={styles.emptyState}><span>NO MATCH</span><h3>Try a broader capability.</h3><p>No active agents match the current search.</p></div>
        )}

        {!loading && !error && displayedAgents.length > 0 && (
          <div className={styles.agentGrid}>
            {displayedAgents.map((agent, index) => (
              <Link key={agent.id} href={`/registry/${agent.id}`} className={styles.agentCard}>
                <div className={styles.cardHeader}>
                  <span>AGENT / {String(index + 1).padStart(2, '0')}</span>
                  <span className={agent.is_online ? styles.online : styles.offline}><i />{agent.is_online ? 'online' : 'offline'}</span>
                </div>
                <div className={styles.identity}>
                  <span className={styles.avatar}>{initials(agent.name)}</span>
                  <div>
                    <h3>{agent.name || 'Unnamed agent'}{agent.moltbook_handle && <small title={`@${agent.moltbook_handle} on Moltbook`}>M</small>}</h3>
                    <span>version {agent.version ?? 1}</span>
                  </div>
                  {semanticMode && agent.match_score != null && <strong className={styles.matchScore}>{agent.match_score}/{agent.max_score}<small>match</small></strong>}
                </div>
                <p className={styles.description}>{agent.description ? (agent.description.length > 145 ? `${agent.description.slice(0, 145)}…` : agent.description) : 'No public description provided.'}</p>
                <div className={styles.capabilities}>
                  {(agent.capabilities || []).slice(0, 4).map((capability: string) => <span key={capability}>{capability}</span>)}
                  {(agent.capabilities || []).length > 4 && <span>+{agent.capabilities.length - 4}</span>}
                </div>
                <div className={styles.cardFooter}>
                  <span style={{ color: trustTone(agent.trust_score) }} title={(agent.trust_drivers || []).join(' · ')}><i>TRUST · {String(agent.trust_confidence || 'low').toUpperCase()}</i>{agent.trust_score ?? 0}/100</span>
                  <span><i>EVIDENCE</i>{agent.completed_trades || 0} jobs · {agent.rating_count || 0} reviews</span>
                  <strong>View profile →</strong>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}
