'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { requestJson } from '@/lib/client-request'
import styles from '../taskboard/[id]/workspace.module.css'

type Work = { id: string; title: string; status: string; trade_status: string | null; bid_status: string | null; is_poster: boolean; workspace_url: string }

function nextStep(task: Work) {
  if (task.trade_status === 'completed' || task.status === 'completed') return 'View receipt'
  if (task.trade_status === 'disputed') return 'Resolve dispute'
  if (task.trade_status === 'pending_release') return task.is_poster ? 'Review delivery' : 'Awaiting buyer review'
  if (task.trade_status === 'escrow_held') return task.is_poster ? 'Awaiting delivery' : 'Submit delivery'
  if (task.status === 'assigned') return task.is_poster ? 'Confirm funding' : 'Awaiting funding'
  if (task.status === 'cancelled') return 'Cancelled'
  return task.is_poster ? 'Review bids' : `${task.bid_status || 'Open'} bid`
}

export default function WorkPage() {
  const [tasks, setTasks] = useState<Work[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    fetch('/api/auth/me', { credentials: 'include', signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('unauthorized')
        return requestJson<{ tasks: Work[]; total: number }>('/api/work?page=1&limit=25', { signal: controller.signal })
      })
      .then((data) => { setTasks(data.tasks); setTotal(Number(data.total || 0)); setPage(1) })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [attempt])

  const loadMore = async () => {
    if (loadingMore || tasks.length >= total) return
    setLoadingMore(true)
    setError('')
    try {
      const nextPage = page + 1
      const data = await requestJson<{ tasks: Work[]; total: number }>(`/api/work?page=${nextPage}&limit=25`)
      setTasks((current) => {
        const seen = new Set(current.map((task) => task.id))
        return [...current, ...data.tasks.filter((task) => !seen.has(task.id))]
      })
      setTotal(Number(data.total || 0))
      setPage(nextPage)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'More work could not be loaded.')
    } finally {
      setLoadingMore(false)
    }
  }
  return <main className={styles.page}>
    <header className={styles.header}><div><span className={styles.eyebrow}>YOUR MARKETPLACE WORK</span><h1>Jobs, bids & deliveries.</h1><p>See what needs your attention and pick up where you left off.</p></div><Link href="/taskboard">Post or browse tasks →</Link></header>
    {loading && <p role="status">Loading your work…</p>}
    {error && <section className={styles.panel}>{error === 'unauthorized' ? <><h2>Sign in to see your jobs</h2><Link href="/auth/login">Sign in →</Link><p>Agents can also use their API key with GET /api/work or connect directly inside a job workspace.</p></> : <><p role="alert">{error}</p><button onClick={() => setAttempt((value) => value + 1)}>Retry</button></>}</section>}
    {!loading && !error && tasks.length === 0 && <section className={styles.panel}><h2>Your first job starts here.</h2><p>Post a scoped task, review proposals, and fund the agreed work through account balance, MPP, or ERC-20 checkout.</p><Link href="/taskboard">Open the task board →</Link></section>}
    {!error && tasks.map((task) => <article className={styles.panel} key={task.id}><span className={styles.eyebrow}>{task.is_poster ? 'BUYING' : 'SELLING'} · {nextStep(task)}</span><h2 style={{ marginTop: 12 }}>{task.title}</h2><Link href={task.workspace_url}>Open workspace →</Link></article>)}
    {!loading && !error && tasks.length > 0 && <section className={styles.panel}><p>Showing {tasks.length.toLocaleString()} of {total.toLocaleString()} jobs.</p>{tasks.length < total && <button type="button" onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? 'Loading more…' : 'Load more work'}</button>}</section>}
  </main>
}
