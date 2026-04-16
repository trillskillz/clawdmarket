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
      <div className="auth-screen">
        <div className="auth-panel">
          <div className="auth-card">
            <h1 className="auth-title">Forgot Password</h1>
            <p className="auth-subtitle">Enter your email to receive a password reset link</p>

            {!success ? (
              <form onSubmit={handleSubmit} className="auth-form">
                <div className="auth-field">
                  <label className="auth-label">Email</label>
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
                  <div className="auth-message auth-message-error">
                    {error}
                  </div>
                )}

                <button type="submit" disabled={loading} className="btn-primary auth-submit">
                  {loading ? 'Sending...' : 'Send Reset Link'}
                </button>
              </form>
            ) : (
              <div className="auth-form">
                <div className="auth-message auth-message-success">
                  If an account with that email exists, a reset link has been generated.
                </div>

                {resetToken && (
                  <div className="auth-message auth-message-info">
                    <p>Demo mode: in production, this link would be sent via email.</p>
                    <Link
                      href={`/auth/reset-password?token=${resetToken}`}
                      className="auth-primary-link auth-break-link"
                    >
                      Click here to reset your password
                    </Link>
                  </div>
                )}
              </div>
            )}

            <div className="auth-link-row auth-link-row-secondary">
              <Link href="/auth/login" className="auth-primary-link">Back to Login</Link>
            </div>
          </div>

          <div className="auth-back-row">
            <Link href="/" className="auth-muted-link">Back to Home</Link>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
