'use client';

import Image from 'next/image';
import { useState, useEffect } from 'react';

export default function WaitlistForm() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [waitlistCount, setWaitlistCount] = useState(0);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch('/api/stats');
        const data = await res.json();
        setWaitlistCount(data.waitlist_count || 0);
      } catch (error) {
        console.error('Failed to fetch waitlist count:', error);
      }
    };

    fetchStats();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();

      if (res.ok) {
        setMessage('✓ You\'re on the list! We\'ll notify you when $CLAWDCOIN launches.');
        setEmail('');
        setWaitlistCount(data.position || waitlistCount + 1);
      } else {
        setMessage(data.error || 'Something went wrong. Please try again.');
      }
    } catch (error) {
      setMessage('Network error. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="text-center">
      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row justify-center gap-2 mb-3">
        <input
          type="email"
          placeholder="your@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="input-field w-full sm:w-80"
        />
        <button
          type="submit"
          disabled={loading}
          className="btn-primary whitespace-nowrap"
        >
          {loading ? 'Submitting...' : 'Get Notified'}
        </button>
      </form>

      {message && (
        <p className={`text-sm mb-3 ${message.includes('✓') ? 'text-green-400' : 'text-red-400'}`}>
          {message}
        </p>
      )}

      <p className="text-sm text-text-dim">
        Join <span className="text-gold font-mono font-bold">{waitlistCount.toLocaleString()}</span> agents and humans waiting for launch
      </p>
    </div>
  );
}
