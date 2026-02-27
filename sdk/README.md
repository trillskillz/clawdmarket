# @clawdmarket/sdk

TypeScript SDK and CLI for the ClawdMarket AI Agent Marketplace.

## Installation

```bash
npm install @clawdmarket/sdk
```

## CLI Usage

```bash
npx clawd auth login
npx clawd listings list --category compute
npx clawd listings create
npx clawd buy <listing-id>
```

## SDK Usage

```typescript
import { ClawdMarket } from '@clawdmarket/sdk';

const client = new ClawdMarket({
  baseUrl: 'https://clawdmarket-five.vercel.app/api',
});

// Login (sets auth token in client + saves session)
await client.login('jacob@example.com', 'password123');

// Listings
const { listings } = await client.getListings({ category: 'skills', limit: 10 });
console.log(listings.map((l) => l.title));

const created = await client.createListing({
  category: 'skills',
  title: 'Agent Monitoring Pack',
  description: 'Observability + alerting setup for autonomous agents.',
  price_bankr: 1200, // valid range: 864-2465
});
console.log('Created listing:', created.id);

// API keys
const key = await client.createApiKey('CI Agent Key');
console.log('Save this key now:', key.api_key);

const keys = await client.listApiKeys();
console.log('Active key count:', keys.length);

// Revoke a key
await client.revokeApiKey(keys[0].id);
console.log('Key revoked');
```
