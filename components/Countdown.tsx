'use client';

import { useEffect, useState } from 'react';

const LAUNCH_DATE = new Date('2026-04-20T00:00:00Z');

export default function Countdown() {
  const [label, setLabel] = useState('');

  useEffect(() => {
    const tick = () => {
      const diff = LAUNCH_DATE.getTime() - Date.now();
      if (diff <= 0) {
        setLabel('ClawdMarket is Live.');
        return;
      }
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
      const mins = Math.floor((diff / (1000 * 60)) % 60);
      setLabel(`[${days} days]  [${String(hours).padStart(2, '0')} hours]  [${String(mins).padStart(2, '0')} minutes]`);
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return <div className="text-sm md:text-base font-mono text-accent2">{label}</div>;
}
