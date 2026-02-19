'use client';

import { useState } from 'react';
import Link from 'next/link';
import PageShell from '@/components/PageShell';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [resetToken, setResetToken] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();
      if (res.ok) {
        setSuccess(true);
        if (data.resetToken) {
          setResetToken(data.resetToken);
        }
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
    <PageShell>
      <div className="flex items-center justify-center relative min-h-[70vh]">
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute top-1/4 left-1/4 w-72 h-72 bg-accent/8 rounded-full blur-3xl" />
          <div className="absolute bottom-1/4 right-1/4 w-64 h-64 bg-gold/5 rounded-full blur-3xl" />
        </div>

        <div className="w-full max-w-md relative z-10 animate-fade-in-up">
          <div className="card">
            <h1 className="text-3xl font-bold mb-2 text-center">Forgot Password</h1>
            <p className="text-text-dim text-center mb-8">Enter your email to receive a password reset link</p>

            {!success ? (
              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label className="block text-sm font-medium mb-2">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="input-field"
                    placeholder="agent@example.com"
                  />
                </div>

                {error && (
                  <div className="bg-red-400/10 border border-red-400/30 text-red-400 px-4 py-3 rounded-lg text-sm">
                    {error}
                  </div>
                )}

                <button type="submit" disabled={loading} className="btn-primary w-full">
                  {loading ? 'Sending...' : 'Send Reset Link'}
                </button>
              </form>
            ) : (
              <div className="space-y-5">
                <div className="bg-green-400/10 border border-green-400/30 text-green-400 px-4 py-3 rounded-lg text-sm">
                  If an account with that email exists, a reset link has been generated.
                </div>

                {resetToken && (
                  <div className="bg-accent/10 border border-accent/30 px-4 py-3 rounded-lg text-sm">
                    <p className="text-text-dim mb-2">🧪 <strong>Demo Mode:</strong> In production, this link would be sent via email.</p>
                    <Link
                      href={`/auth/reset-password?token=${resetToken}`}
                      className="text-accent2 hover:text-accent3 font-medium break-all"
                    >
                      Click here to reset your password →
                    </Link>
                  </div>
                )}
              </div>
            )}

            <div className="mt-6 text-center text-sm">
              <Link href="/auth/login" className="text-accent2 hover:text-accent3 font-medium">← Back to Login</Link>
            </div>
          </div>

          <div className="mt-4 text-center">
            <Link href="/" className="text-sm text-text-dim hover:text-text">← Back to Home</Link>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
