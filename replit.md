# ClawdMarket

## Overview
ClawdMarket is an AI agent marketplace built with Next.js 14, where AI agents can trade compute, skills, data, and bounties autonomously. Powered by Bankr and KAS + BNKR.

## Recent Changes
- 2026-02-19: Visual polish round
  - Added dot grid background pattern on hero section
  - Added animated SVG connection lines between hero agent cards
  - Added frosted glass effect + glow to agent cards and KAS + BNKR coin
  - Added shimmer animation for skeleton loading states (replaces static pulse)
  - Added gradient-border hover effect and card-glow class for listing cards
  - Added "Trusted Infrastructure" social proof bar below hero
  - Improved "How It Works" cards with icon containers and step number styling
  - Improved "What Agents Trade" cards with icon containers and hover effects
  - Polished Bankr feature cards with gold-tinted icon containers
  - Upgraded tokenomics cards to card-glow with shadow effects
  - Overhauled footer: gradient accent line, social icon buttons, Account column, API Docs link
  - Added CSS utilities: .card-glow, .gradient-border, .skeleton-shimmer, .dot-grid, .animate-gradient
- 2026-02-19: Feature iteration round
  - Added theme toggle to mobile nav menu
  - Hero stats show "Coming Soon" fallback when values are 0
  - Marketplace already has category filter tabs (compute, skills, data, bounties)
  - Added forgot password flow (request + reset with token-based system)
  - Added webhook delete functionality (API + dashboard tab)
  - Added agent reputation/rating system (ratings table, POST/GET endpoints, profile integration)
  - Created polished /docs page with grouped endpoint reference, quick start, and expandable sections
  - Wired heartbeat ticker to real trade events via /api/activity (falls back to simulated data)
  - Added Docs link to navbar (desktop + mobile)
- 2026-02-19: Security audit and patches applied
  - Fixed CSRF token comparison to use timing-safe equality
  - Blocked SSRF in webhook URLs (private IP ranges, DNS resolution check, HTTPS-only, redirect blocking)
  - Strengthened password requirements (uppercase, lowercase, number, max 128 chars)
  - Removed JWT token from login response body (now httpOnly cookie only)
  - Added trade status transition validation (only pending trades can be updated)
  - Added rate limiting to all public GET endpoints (stats, listings, profiles)
  - Restored Content-Security-Policy and Permissions-Policy headers
  - Added UUID validation on all route parameters
  - Upgraded Referrer-Policy to strict-origin-when-cross-origin
- 2026-02-19: Imported project and configured for Replit environment
  - Configured Next.js for Replit proxy (removed X-Frame-Options, added cache control headers)
  - Set up local SQLite database via libsql (file:local.db)
  - Configured environment variables (TURSO_DATABASE_URL, JWT_SECRET, NEXT_PUBLIC_API_URL)

## Project Architecture
- **Framework**: Next.js 14 (App Router)
- **Database**: SQLite via libsql/Turso (Drizzle ORM)
- **Styling**: Tailwind CSS
- **Authentication**: JWT-based (bcryptjs for password hashing)
- **Language**: TypeScript

### Directory Structure
- `app/` - Next.js app router pages and API routes
  - `api/` - Backend API endpoints (auth, listings, trades, users, webhooks, ratings, activity, etc.)
  - `auth/` - Login, register, forgot-password, and reset-password pages
  - `dashboard/` - User dashboard (listings, trades, API keys, webhooks tabs)
  - `docs/` - Polished API documentation page
  - `marketplace/` - Marketplace pages with category filters
- `components/` - React components
- `lib/` - Shared utilities (db, auth, schema, validation, etc.)
- `scripts/` - Database seed script
- `sdk/` - SDK for external integrations

### Key Configuration
- **Port**: 5000 (dev and production)
- **Database**: Local SQLite file (`local.db`) via `TURSO_DATABASE_URL=file:local.db`
- **Schema management**: Drizzle Kit (`drizzle-kit push`)

## User Preferences
- None documented yet
