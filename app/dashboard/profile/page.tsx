'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import PageShell from '@/components/PageShell';
import ProfileTab from '@/components/dashboard/ProfileTab';

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
    <PageShell>
      <div className="max-w-3xl mx-auto py-8 px-4">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Edit Profile</h1>
          <p className="text-sm text-text-dim mt-1">Update your bio, avatar, and display settings.</p>
        </div>
        <ProfileTab
          user={user}
          loading={loading}
          onRefresh={fetchUser}
          getCsrfToken={getCsrfToken}
        />
      </div>
    </PageShell>
  );
}
