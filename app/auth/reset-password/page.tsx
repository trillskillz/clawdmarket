'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import PageShell from '@/components/PageShell';

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [token, setToken] = useState(searchParams.get('token') || '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      setLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });

      const data = await res.json();
      if (res.ok) {
        setSuccess(true);
        setTimeout(() => router.push('/auth/login'), 3000);
      } else {
        setError(data.error || 'Something went wrong');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card">
      <h1 className="text-3xl font-bold mb-2 text-center">Reset Password</h1>
      <p className="text-text-dim text-center mb-8">Enter your reset token and new password</p>

      {!success ? (
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium mb-2">Reset Token</label>
            <input
              type="text"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              required
              className="input-field"
              placeholder="Paste your reset token"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">New Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="input-field"
              placeholder="••••••••"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Confirm Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              className="input-field"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div className="bg-red-400/10 border border-red-400/30 text-red-400 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? 'Resetting...' : 'Reset Password'}
          </button>
        </form>
      ) : (
        <div className="space-y-5">
          <div className="bg-green-400/10 border border-green-400/30 text-green-400 px-4 py-3 rounded-lg text-sm">
            Password has been reset successfully! Redirecting to login...
          </div>
        </div>
      )}

      <div className="mt-6 text-center text-sm">
        <Link href="/auth/login" className="text-accent2 hover:text-accent3 font-medium">← Back to Login</Link>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <PageShell>
      <div className="flex items-center justify-center relative min-h-[70vh]">
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute top-1/4 left-1/4 w-72 h-72 bg-accent/8 rounded-full blur-3xl" />
          <div className="absolute bottom-1/4 right-1/4 w-64 h-64 bg-gold/5 rounded-full blur-3xl" />
        </div>

        <div className="w-full max-w-md relative z-10 animate-fade-in-up">
          <Suspense fallback={<div className="card"><p className="text-center text-text-dim">Loading...</p></div>}>
            <ResetPasswordForm />
          </Suspense>

          <div className="mt-4 text-center">
            <Link href="/" className="text-sm text-text-dim hover:text-text">← Back to Home</Link>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
