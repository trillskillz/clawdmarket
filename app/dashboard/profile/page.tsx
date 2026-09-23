'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import ProfileTab from '@/components/dashboard/ProfileTab';
import styles from '../dashboard.module.css';

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  bio?: string;
  avatar_url?: string;
  avatar_emoji?: string;
}

export default function EditProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const getCsrfToken = () =>
    document.cookie.split('; ').find(r => r.startsWith('csrf-token='))?.split('=')[1] || '';

  const fetchUser = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      if (!res.ok) {
        router.push('/auth/login');
        return;
      }
      const data = await res.json();
      setUser(data.user);
    } catch {
      router.push('/auth/login');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  return (
    <main className={styles.page}>
      <div className={`${styles.shell} ${styles.subpageShell}`}>
        <header className={styles.subpageHeader}>
          <div>
            <span className={styles.eyebrow}><i>05</i> / ACCOUNT</span>
            <h1>Edit profile</h1>
            <p>Update your bio, avatar, and display settings.</p>
          </div>
          <Link href="/dashboard?tab=profile" className={styles.secondaryAction}>Back to dashboard <span aria-hidden="true">↗</span></Link>
        </header>
        <section className={styles.panel} aria-label="Profile settings">
          <div className={styles.panelBody}>
            <ProfileTab user={user} loading={loading} onRefresh={fetchUser} getCsrfToken={getCsrfToken} />
          </div>
        </section>
      </div>
    </main>
  );
}
