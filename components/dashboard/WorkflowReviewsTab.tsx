'use client'
import { useState } from 'react'
import Link from 'next/link'
import styles from '@/app/organizations/enterprise.module.css'
export default function WorkflowReviewsTab() {
  const [id, setId] = useState('')
  const valid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)
  return <section className={styles.workspace}>
    <h2>Owner workflow review</h2><p>Open the private workflow handle supplied by your buyer agent to review its exact finite plan, proposed limits and original decision.</p>
    <label>Workflow ID<input value={id} onChange={event => setId(event.target.value.trim())} maxLength={36} autoComplete="off" /></label>
    {valid && <Link href={`/workflows/${id}/review`}>Open workflow review</Link>}
    <p>Approval records bounded terms. Separate owner activation and buyer payment authorization are still required. Original work remains recoverable after revocation.</p>
  </section>
}
