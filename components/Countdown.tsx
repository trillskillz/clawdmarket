'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';

const LAUNCH_DATE = new Date('2026-04-20T00:00:00Z');

interface TimeLeft {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

export default function Countdown() {
  const [timeLeft, setTimeLeft] = useState<TimeLeft>({
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0,
  });
  const [isLive, setIsLive] = useState(false);

  useEffect(() => {
    const updateCountdown = () => {
      const now = new Date();
      const diff = LAUNCH_DATE.getTime() - now.getTime();

      if (diff <= 0) {
        setIsLive(true);
        return;
      }

      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      setTimeLeft({ days, hours, minutes, seconds });
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);

    return () => clearInterval(interval);
  }, []);

  const pad = (num: number) => String(num).padStart(2, '0');

  if (isLive) {
    return (
      <div className="text-center">
        <div className="text-xl md:text-2xl font-bold text-gold mb-4">
          🚀 $CLAWDCOIN IS LIVE <Image src="/images/clawdcoin.png" alt="$CLAWDCOIN" width={28} height={28} className="inline-block ml-1" />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-bg2 border border-border rounded-2xl p-8 md:p-12">
      <div className="text-sm text-text-dim uppercase tracking-widest text-center mb-6">
        Token Launch In
      </div>
      
      <div className="flex justify-center items-center gap-2 md:gap-4 mb-8">
        <div className="text-center">
          <div className="bg-bg border border-border rounded-xl px-4 md:px-6 py-3 md:py-4 min-w-[70px] md:min-w-[100px]">
            <div className="text-3xl md:text-5xl font-bold font-mono text-gold">{pad(timeLeft.days)}</div>
          </div>
          <div className="text-xs text-text-dim uppercase tracking-wide mt-2">Days</div>
        </div>
        
        <div className="text-3xl md:text-4xl font-bold text-text-dim">:</div>
        
        <div className="text-center">
          <div className="bg-bg border border-border rounded-xl px-4 md:px-6 py-3 md:py-4 min-w-[70px] md:min-w-[100px]">
            <div className="text-3xl md:text-5xl font-bold font-mono text-gold">{pad(timeLeft.hours)}</div>
          </div>
          <div className="text-xs text-text-dim uppercase tracking-wide mt-2">Hours</div>
        </div>
        
        <div className="text-3xl md:text-4xl font-bold text-text-dim">:</div>
        
        <div className="text-center">
          <div className="bg-bg border border-border rounded-xl px-4 md:px-6 py-3 md:py-4 min-w-[70px] md:min-w-[100px]">
            <div className="text-3xl md:text-5xl font-bold font-mono text-gold">{pad(timeLeft.minutes)}</div>
          </div>
          <div className="text-xs text-text-dim uppercase tracking-wide mt-2">Minutes</div>
        </div>
        
        <div className="text-3xl md:text-4xl font-bold text-text-dim">:</div>
        
        <div className="text-center">
          <div className="bg-bg border border-border rounded-xl px-4 md:px-6 py-3 md:py-4 min-w-[70px] md:min-w-[100px]">
            <div className="text-3xl md:text-5xl font-bold font-mono text-gold">{pad(timeLeft.seconds)}</div>
          </div>
          <div className="text-xs text-text-dim uppercase tracking-wide mt-2">Seconds</div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center text-sm">
        <div>
          <div className="text-text-dim">Network</div>
          <div className="text-text font-medium">Base (EVM) + Solana</div>
        </div>
        <div>
          <div className="text-text-dim">Launch Platform</div>
          <div className="text-text font-medium">
            <a href="https://bankr.bot" target="_blank" rel="noopener noreferrer" className="text-accent2 hover:text-accent3">
              Bankr Token Launchpad
            </a>
          </div>
        </div>
        <div>
          <div className="text-text-dim">Fair Launch</div>
          <div className="text-text font-medium">No presale · No VC · Agent-first</div>
        </div>
      </div>
    </div>
  );
}
