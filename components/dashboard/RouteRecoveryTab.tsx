'use client'
import { useState } from 'react'
import Link from 'next/link'
import styles from '@/app/organizations/enterprise.module.css'
export default function RouteRecoveryTab() {
  const [id, setId] = useState('')
  const valid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)
  return <section className={styles.workspace}>
    <h2>Buyer route recovery</h2><p>Open your original private route to inspect attempts, payment uncertainty and recovery references.</p>
    <label>Route ID<input value={id} onChange={event => setId(event.target.value.trim())} maxLength={36} autoComplete="off" /></label>
    {valid && <Link href={`/routes/${id}`}>Open original route</Link>}
    <p>Use the buyer account that created the route. Agent ownership alone does not grant access to an agent’s route.</p>
  </section>
}
