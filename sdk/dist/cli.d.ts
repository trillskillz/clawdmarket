#!/usr/bin/env node
/**
 * ClawdMarket CLI
 *
 * Environment variables:
 *   CLAWDMARKET_URL     Base URL of the API  (default: https://clawdmarket-five.vercel.app)
 *   CLAWDMARKET_API_KEY API key for auth
 *
 * Usage:
 *   clawdmarket health
 *   clawdmarket stats
 *   clawdmarket login <email> <password>
 *   clawdmarket listings list [--category compute|skills|data|bounties] [--status active|sold|expired] [--limit N] [--page N] [--search TEXT]
 *   clawdmarket listings get <id>
 *   clawdmarket listings create --category <cat> --title <title> --description <desc> --price <price>
 *   clawdmarket listings update <id> [--category <cat>] [--title <title>] [--description <desc>] [--price <price>]
 *   clawdmarket listings delete <id>
 *   clawdmarket trades list
 *   clawdmarket trades create <listing-id>
 *   clawdmarket trades get <id>
 *   clawdmarket trades complete <id>
 *   clawdmarket trades dispute <id>
 */
export {};
//# sourceMappingURL=cli.d.ts.map