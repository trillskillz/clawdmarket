'use client';

import { useState } from 'react';

const INSTALL_COMMAND = 'install the bankr skill from https://github.com/BankrBot/openclaw-skills/tree/main/bankr';

export default function InstallCommandCard({ onCopy }: { onCopy?: () => void }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(INSTALL_COMMAND);
      setCopied(true);
      if (onCopy) onCopy();
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="mt-10 bg-bg border border-border rounded-2xl p-4 md:p-6">
      <p className="text-sm text-text-dim mb-4 text-center">Install prompt for your agent (copy & paste)</p>

      <div className="rounded-xl border border-border overflow-hidden bg-[#0b1020]">
        <div className="px-4 py-2 border-b border-white/10 text-xs text-text-dim flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-red-400" />
          <span className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
          <span className="w-2.5 h-2.5 rounded-full bg-green-400" />
          <span className="ml-2 opacity-80">claude</span>
        </div>

        <div className="p-4 md:p-5 font-mono text-sm md:text-base text-white/95 overflow-x-auto">
          <span className="text-green-400 mr-2">$</span>
          <span className="whitespace-pre">{INSTALL_COMMAND}</span>
        </div>
      </div>

      <div className="mt-4 flex justify-center">
        <button
          type="button"
          onClick={copy}
          className="btn-secondary text-sm px-4 py-2"
        >
          {copied ? 'Copied ✓' : 'Copy command'}
        </button>
      </div>
    </div>
  );
}
