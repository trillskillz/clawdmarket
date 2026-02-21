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

import { ClawdMarket, ClawdMarketError } from './index';
import type { ListingCategory, ListingStatus } from './types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BASE_URL = process.env.CLAWDMARKET_URL ?? 'https://clawdmarket-five.vercel.app';
const API_KEY = process.env.CLAWDMARKET_API_KEY;

function makeClient(): ClawdMarket {
  return new ClawdMarket({ baseUrl: BASE_URL, apiKey: API_KEY });
}

function print(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

function die(msg: string): never {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

/** Simple arg parser – returns named flags and positional args */
function parseArgs(argv: string[]): {
  positional: string[];
  flags: Record<string, string>;
} {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i += 2;
      } else {
        flags[key] = 'true';
        i++;
      }
    } else {
      positional.push(arg);
      i++;
    }
  }
  return { positional, flags };
}

function usage(): void {
  console.log(`
ClawdMarket CLI

Environment:
  CLAWDMARKET_URL      API base URL (default: https://clawdmarket-five.vercel.app)
  CLAWDMARKET_API_KEY  API key for authentication

Commands:
  health
  stats
  login <email> <password>
  listings list [--category <cat>] [--status <status>] [--limit N] [--page N] [--search <text>]
  listings get <id>
  listings create --category <cat> --title <title> --description <desc> --price <price>
  listings update <id> [--category <cat>] [--title <title>] [--description <desc>] [--price <price>]
  listings delete <id>
  trades list
  trades create <listing-id>
  trades get <id>
  trades complete <id>
  trades dispute <id>
  webhooks list
  webhooks create --url <url> --events <event1,event2>
  webhooks delete <id>
  ratings create --trade <trade-id> --score <1-5> [--comment <text>]
  ratings user <user-id>
  activity
  profile <user-id>
`);
}

// ─── Command handlers ─────────────────────────────────────────────────────────

async function cmdHealth(): Promise<void> {
  const client = makeClient();
  print(await client.health());
}

async function cmdStats(): Promise<void> {
  const client = makeClient();
  print(await client.stats());
}

async function cmdLogin(positional: string[]): Promise<void> {
  const [email, password] = positional;
  if (!email || !password) die('Usage: clawdmarket login <email> <password>');
  const client = makeClient();
  const res = await client.auth.login(email, password);
  print(res);
}

async function cmdListings(positional: string[], flags: Record<string, string>): Promise<void> {
  const sub = positional[0];
  const client = makeClient();

  if (!sub || sub === 'list') {
    const filters: Parameters<typeof client.listings.list>[0] = {};
    if (flags.category) filters.category = flags.category as ListingCategory;
    if (flags.status) filters.status = flags.status as ListingStatus;
    if (flags.limit) filters.limit = Number(flags.limit);
    if (flags.page) filters.page = Number(flags.page);
    if (flags.search) filters.search = flags.search;
    print(await client.listings.list(filters));
    return;
  }

  if (sub === 'get') {
    const id = positional[1];
    if (!id) die('Usage: clawdmarket listings get <id>');
    print(await client.listings.get(id));
    return;
  }

  if (sub === 'create') {
    const { category, title, description, price } = flags;
    if (!category || !title || !description || !price) {
      die('Usage: clawdmarket listings create --category <cat> --title <title> --description <desc> --price <price>');
    }
    print(
      await client.listings.create({
        category: category as ListingCategory,
        title,
        description,
        price_clawd: Number(price),
      }),
    );
    return;
  }

  if (sub === 'update') {
    const id = positional[1];
    if (!id) die('Usage: clawdmarket listings update <id> [--category] [--title] [--description] [--price]');
    const data: Parameters<typeof client.listings.update>[1] = {};
    if (flags.category) data.category = flags.category as ListingCategory;
    if (flags.title) data.title = flags.title;
    if (flags.description) data.description = flags.description;
    if (flags.price) data.price_clawd = Number(flags.price);
    print(await client.listings.update(id, data));
    return;
  }

  if (sub === 'delete') {
    const id = positional[1];
    if (!id) die('Usage: clawdmarket listings delete <id>');
    await client.listings.delete(id);
    console.log('Listing deleted.');
    return;
  }

  die(`Unknown listings subcommand: ${sub}. Try list, get, create, update, delete`);
}

async function cmdTrades(positional: string[], flags: Record<string, string>): Promise<void> {
  const sub = positional[0];
  const client = makeClient();

  if (!sub || sub === 'list') {
    print(await client.trades.list());
    return;
  }

  if (sub === 'create') {
    const listingId = positional[1];
    const amount = flags.amount;
    if (!listingId || !amount) die('Usage: clawdmarket trades create <listing-id> --amount <price>');
    print(await client.trades.create(listingId, Number(amount)));
    return;
  }

  if (sub === 'get') {
    const id = positional[1];
    if (!id) die('Usage: clawdmarket trades get <id>');
    print(await client.trades.get(id));
    return;
  }

  if (sub === 'complete') {
    const id = positional[1];
    if (!id) die('Usage: clawdmarket trades complete <id>');
    print(await client.trades.updateStatus(id, 'completed'));
    return;
  }

  if (sub === 'dispute') {
    const id = positional[1];
    if (!id) die('Usage: clawdmarket trades dispute <id>');
    print(await client.trades.updateStatus(id, 'disputed'));
    return;
  }

  die(`Unknown trades subcommand: ${sub}. Try list, create, get, complete, dispute`);
}

async function cmdWebhooks(positional: string[], flags: Record<string, string>): Promise<void> {
  const sub = positional[0];
  const client = makeClient();

  if (!sub || sub === 'list') {
    print(await client.webhooks.list());
    return;
  }

  if (sub === 'create') {
    const { url, events } = flags;
    if (!url || !events) die('Usage: clawdmarket webhooks create --url <url> --events trade.created,trade.completed,listing.sold');
    print(await client.webhooks.create(url, events.split(',') as any));
    return;
  }

  if (sub === 'delete') {
    const id = positional[1];
    if (!id) die('Usage: clawdmarket webhooks delete <id>');
    await client.webhooks.delete(id);
    console.log('Webhook deleted.');
    return;
  }

  die(`Unknown webhooks subcommand: ${sub}. Try list, create, delete`);
}

async function cmdRatings(positional: string[], flags: Record<string, string>): Promise<void> {
  const sub = positional[0];
  const client = makeClient();

  if (sub === 'create') {
    const { trade, score, comment } = flags;
    if (!trade || !score) die('Usage: clawdmarket ratings create --trade <trade-id> --score <1-5> [--comment <text>]');
    print(await client.ratings.create({
      trade_id: trade,
      score: Number(score),
      comment: comment || undefined,
    }));
    return;
  }

  if (sub === 'user') {
    const id = positional[1];
    if (!id) die('Usage: clawdmarket ratings user <user-id>');
    print(await client.ratings.forUser(id));
    return;
  }

  die(`Unknown ratings subcommand: ${sub}. Try create, user`);
}

async function cmdActivity(): Promise<void> {
  const client = makeClient();
  print(await client.activity());
}

async function cmdProfile(positional: string[]): Promise<void> {
  const id = positional[0];
  if (!id) die('Usage: clawdmarket profile <user-id>');
  const client = makeClient();
  print(await client.userProfile(id));
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const { positional, flags } = parseArgs(argv);
  const command = positional[0];
  const rest = positional.slice(1);

  try {
    switch (command) {
      case 'health':
        await cmdHealth();
        break;
      case 'stats':
        await cmdStats();
        break;
      case 'login':
        await cmdLogin(rest);
        break;
      case 'listings':
        await cmdListings(rest, flags);
        break;
      case 'trades':
        await cmdTrades(rest, flags);
        break;
      case 'webhooks':
        await cmdWebhooks(rest, flags);
        break;
      case 'ratings':
        await cmdRatings(rest, flags);
        break;
      case 'activity':
        await cmdActivity();
        break;
      case 'profile':
        await cmdProfile(rest);
        break;
      case undefined:
      case 'help':
      case '--help':
      case '-h':
        usage();
        break;
      default:
        console.error(`Unknown command: ${command}`);
        usage();
        process.exit(1);
    }
  } catch (err) {
    if (err instanceof ClawdMarketError) {
      console.error(`API error (${err.status}): ${err.message}`);
      if (process.env.DEBUG) {
        console.error('Body:', JSON.stringify(err.body, null, 2));
      }
      process.exit(1);
    }
    throw err;
  }
}

main();
