'use client';

import { useState, useEffect } from 'react';
import PageShell from '@/components/PageShell';

export default function UserModerationPage() {
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchUsers = async (search = '') => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/users?q=${encodeURIComponent(search)}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch users');
      const data = await res.json();
      setUsers(data.users || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchUsers(query);
  };

  const toggleBan = async (userId: string, currentStatus: boolean) => {
    if (!confirm(`Are you sure you want to ${currentStatus ? 'UNBAN' : 'BAN'} this user?`)) return;
    
    try {
      const res = await fetch('/api/admin/moderation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, action: currentStatus ? 'unban' : 'ban' }),
      });
      if (res.ok) {
        setUsers(users.map(u => u.id === userId ? { ...u, is_banned: !currentStatus } : u));
      } else {
        alert('Action failed');
      }
    } catch (err) {
      alert('Error updating user');
    }
  };

  return (
    <PageShell>
      <div className="max-w-6xl mx-auto px-6 py-10">
        <h1 className="text-3xl font-bold mb-6">User Moderation</h1>
        
        <form onSubmit={handleSearch} className="flex gap-2 mb-8">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, email, or ID..."
            className="flex-grow bg-bg border border-border rounded-xl px-4 py-2"
          />
          <button type="submit" className="btn-primary px-6 py-2">Search</button>
        </form>

        {loading ? (
          <div className="animate-pulse space-y-4">
            {[1, 2, 3].map(i => <div key={i} className="h-16 bg-surface rounded-xl" />)}
          </div>
        ) : error ? (
          <div className="card text-red-400">{error}</div>
        ) : users.length === 0 ? (
          <div className="card text-text-dim">No users found.</div>
        ) : (
          <div className="space-y-4">
            {users.map((u) => (
              <div key={u.id} className="card flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold">{u.name}</span>
                    <span className="text-xs px-2 py-0.5 rounded bg-surface border border-border">{u.role}</span>
                    {u.is_banned && <span className="text-xs px-2 py-0.5 rounded bg-red-900/50 text-red-200 border border-red-800">BANNED</span>}
                  </div>
                  <div className="text-sm text-text-dim font-mono mt-1">{u.email}</div>
                  <div className="text-xs text-text-dim mt-0.5">ID: {u.id}</div>
                </div>
                <button
                  onClick={() => toggleBan(u.id, u.is_banned)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    u.is_banned 
                      ? 'bg-green-600 hover:bg-green-500 text-white' 
                      : 'bg-red-600 hover:bg-red-500 text-white'
                  }`}
                >
                  {u.is_banned ? 'Unban User' : 'Ban User'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </PageShell>
  );
}
