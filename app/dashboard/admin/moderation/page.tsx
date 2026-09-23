'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import styles from '../../dashboard.module.css';

type Row = { [k: string]: any };

export default function ModerationPage() {
  const [bannedUsers, setBannedUsers] = useState<Row[]>([]);
  const [blacklistedIps, setBlacklistedIps] = useState<Row[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const csrfToken = () => document.cookie
    .split('; ')
    .find((value) => value.startsWith('csrf-token='))
    ?.split('=')[1] || '';

  const load = async () => {
    const r = await fetch('/api/admin/moderation', { cache: 'no-store', credentials: 'include' });
    const d = await r.json();
    if (!r.ok) {
      setError(d?.error || 'Failed to load moderation data');
      return;
    }
    setError('');
    setBannedUsers(d.banned_users || []);
    setBlacklistedIps(d.blacklisted_ips || []);
  };

  useEffect(() => { load(); }, []);

  const moderate = async (body: { action: 'unban_user'; user_id: string } | { action: 'unblacklist_ip'; ip: string }, key: string) => {
    setBusy(key);
    setError('');
    try {
      const response = await fetch('/api/admin/moderation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken() },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || 'Moderation action failed');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Moderation action failed');
    } finally {
      setBusy('');
    }
  };

  return (
    <main className={styles.page}>
      <div className={`${styles.shell} ${styles.subpageShell}`}>
        <header className={styles.subpageHeader}>
          <div>
            <span className={styles.eyebrow}><i>05</i> / OPERATIONS</span>
            <h1>Moderation</h1>
            <p>Review restricted accounts and network access.</p>
          </div>
          <Link href="/dashboard" className={styles.secondaryAction}>Back to dashboard <span aria-hidden="true">↗</span></Link>
        </header>
        <section className={styles.panel} aria-label="Moderation controls">
          <div className={styles.panelBody}>
            {error && <div role="alert" className={styles.errorBanner}>{error}</div>}
            <div className="grid md:grid-cols-2 gap-4">
              <div className="card">
                <h2 className="text-xl font-semibold mb-3">Banned Users</h2>
                {bannedUsers.length === 0 ? <p className="text-text-dim text-sm">No banned users</p> : (
                  <div className="space-y-2">
                    {bannedUsers.map((u: any) => (
                      <div key={u.user_id} className="border border-border rounded p-3 flex items-center justify-between gap-3">
                        <div className="text-xs">
                          <div className="font-mono">{u.user_id}</div>
                          <div className="text-text-dim">{u.reason}</div>
                        </div>
                        <button disabled={busy === `user:${u.user_id}`} className="btn-secondary text-xs py-1 px-2" onClick={() => moderate({ action: 'unban_user', user_id: u.user_id }, `user:${u.user_id}`)}>{busy === `user:${u.user_id}` ? 'Working…' : 'Unban'}</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="card">
                <h2 className="text-xl font-semibold mb-3">Blacklisted IPs</h2>
                {blacklistedIps.length === 0 ? <p className="text-text-dim text-sm">No blacklisted IPs</p> : (
                  <div className="space-y-2">
                    {blacklistedIps.map((i: any) => (
                      <div key={i.ip} className="border border-border rounded p-3 flex items-center justify-between gap-3">
                        <div className="text-xs">
                          <div className="font-mono">{i.ip}</div>
                          <div className="text-text-dim">{i.reason}</div>
                        </div>
                        <button disabled={busy === `ip:${i.ip}`} className="btn-secondary text-xs py-1 px-2" onClick={() => moderate({ action: 'unblacklist_ip', ip: i.ip }, `ip:${i.ip}`)}>{busy === `ip:${i.ip}` ? 'Working…' : 'Unblacklist'}</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
