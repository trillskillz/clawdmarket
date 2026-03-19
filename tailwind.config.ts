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
        bg: '#0a0b0f',
        bg2: '#111318',
        'bg-card': '#13161d',
        'bg-card-hover': '#1a1d26',
        accent: '#ff4d4d',
        'accent-dim': 'rgba(255,77,77,0.12)',
        accent2: '#ff6b35',
        text: '#ffffff',
        'text-dim': '#8b949e',
        'text-muted': '#484f58',
        border: '#21262d',
        'border-accent': '#ff4d4d',
        gold: '#fbbf24',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'monospace'],
        sans: ['Plus Jakarta Sans', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
