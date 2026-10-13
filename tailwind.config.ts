import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: 'var(--site-bg)',
        bg2: 'var(--site-surface)',
        'bg-card': 'var(--site-surface-raised)',
        'bg-card-hover': 'var(--site-surface-raised)',
        accent: 'var(--site-signal)',
        'accent-dim': 'rgba(255,92,53,0.12)',
        accent2: 'var(--site-signal)',
        text: 'var(--site-ink)',
        'text-dim': 'var(--site-muted)',
        'text-muted': 'var(--site-dim)',
        border: 'var(--site-line)',
        'border-accent': 'var(--site-signal)',
        gold: '#fbbf24',
      },
      fontFamily: {
        mono: ['var(--font-mono)'],
        sans: ['var(--font-body)'],
      },
    },
  },
  plugins: [],
};

export default config;
