import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  email: text('email').notNull().unique(),
  password_hash: text('password_hash').notNull(),
  name: text('name').notNull(),
  role: text('role', { enum: ['human', 'agent'] }).notNull().default('human'),
  bio: text('bio'),
  avatar_url: text('avatar_url'),
  avatar_emoji: text('avatar_emoji'),
  created_at: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const api_keys = sqliteTable('api_keys', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  key_hash: text('key_hash').notNull().unique(),
  key_prefix: text('key_prefix').notNull(),
  name: text('name').notNull(),
  last_used: integer('last_used', { mode: 'timestamp' }),
  created_at: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const listings = sqliteTable('listings', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  seller_id: text('seller_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  category: text('category', { 
    enum: ['compute', 'skills', 'data', 'bounties', 'other'] 
  }).notNull(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  price_bankr: real('price_bankr').notNull(),
  status: text('status', { 
    enum: ['active', 'sold', 'expired'] 
  }).notNull().default('active'),
  created_at: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const trades = sqliteTable('trades', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  listing_id: text('listing_id')
    .notNull()
    .references(() => listings.id, { onDelete: 'cascade' }),
  buyer_id: text('buyer_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  seller_id: text('seller_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  amount: real('amount').notNull(),
  fee: real('fee').notNull(),
  status: text('status', { 
    enum: ['pending', 'completed', 'disputed'] 
  }).notNull().default('pending'),
  created_at: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
  completed_at: integer('completed_at', { mode: 'timestamp' }),
});

export const ratings = sqliteTable('ratings', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  trade_id: text('trade_id')
    .notNull()
    .references(() => trades.id, { onDelete: 'cascade' }),
  rater_id: text('rater_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  rated_id: text('rated_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  score: integer('score').notNull(),
  comment: text('comment'),
  created_at: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const agent_ratings = sqliteTable('agent_ratings', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  from_agent_id: text('from_agent_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  to_agent_id: text('to_agent_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  score: integer('score', { mode: 'number' }).notNull(),
  created_at: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  sender_id: text('sender_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  receiver_id: text('receiver_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  encrypted_content: text('encrypted_content').notNull(),
  nonce: text('nonce').notNull(),
  created_at: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const waitlist = sqliteTable('waitlist', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  email: text('email').notNull().unique(),
  created_at: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const webhooks = sqliteTable('webhooks', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  events: text('events').notNull(),
  secret: text('secret').notNull(),
  created_at: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const watchlist = sqliteTable('watchlist', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  listing_id: text('listing_id')
    .notNull()
    .references(() => listings.id, { onDelete: 'cascade' }),
  created_at: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const analytics_events = sqliteTable('analytics_events', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id'), // Nullable for anonymous visitors
  event_type: text('event_type').notNull(), // view_listing, trade_init, search, etc.
  metadata: text('metadata'), // JSON string of extras
  ip_hash: text('ip_hash'), // Anonymized IP for unique visitor counting
  created_at: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type ApiKey = typeof api_keys.$inferSelect;
export type NewApiKey = typeof api_keys.$inferInsert;
export type Listing = typeof listings.$inferSelect;
export type NewListing = typeof listings.$inferInsert;
export type Trade = typeof trades.$inferSelect;
export type NewTrade = typeof trades.$inferInsert;
export type WaitlistEntry = typeof waitlist.$inferSelect;
export type NewWaitlistEntry = typeof waitlist.$inferInsert;
export type Webhook = typeof webhooks.$inferSelect;
export type NewWebhook = typeof webhooks.$inferInsert;
export type WatchlistEntry = typeof watchlist.$inferSelect;
export type NewWatchlistEntry = typeof watchlist.$inferInsert;
export type AnalyticsEvent = typeof analytics_events.$inferSelect;
export type NewAnalyticsEvent = typeof analytics_events.$inferInsert;
export type Rating = typeof ratings.$inferSelect;
export type NewRating = typeof ratings.$inferInsert;

// ─── $BANKR Tokenomics ───────────────────────────────────────────────────────

export const wallets = sqliteTable('wallets', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  balance: real('balance').notNull().default(0),
  escrow: real('escrow').notNull().default(0),
  created_at: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const transactions = sqliteTable('transactions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  from_user_id: text('from_user_id')
    .references(() => users.id, { onDelete: 'set null' }),
  to_user_id: text('to_user_id')
    .references(() => users.id, { onDelete: 'set null' }),
  amount: real('amount').notNull(),
  type: text('type', {
    enum: ['faucet', 'transfer', 'escrow_lock', 'escrow_release', 'escrow_refund', 'fee'],
  }).notNull(),
  reference_id: text('reference_id'), // trade_id or other context
  memo: text('memo'),
  created_at: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const agent_sessions = sqliteTable('agent_sessions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  declared_params: text('declared_params').notNull(),
  declared_hash: text('declared_hash').notNull(),
  status: text('status', { enum: ['active', 'closed'] }).notNull().default('active'),
  created_at: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
  expires_at: integer('expires_at', { mode: 'timestamp' }),
});

export const agent_instruction_nonces = sqliteTable('agent_instruction_nonces', {
  id: text('id').primaryKey(), // ${user_id}:${nonce}
  user_id: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  nonce: text('nonce').notNull(),
  created_at: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const event_stream = sqliteTable('event_stream', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  sequence_id: integer('sequence_id').notNull(),
  event: text('event').notNull(),
  payload: text('payload').notNull(),
  created_at: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export type Wallet = typeof wallets.$inferSelect;
export type NewWallet = typeof wallets.$inferInsert;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type AgentSession = typeof agent_sessions.$inferSelect;
export type NewAgentSession = typeof agent_sessions.$inferInsert;
export type AgentInstructionNonce = typeof agent_instruction_nonces.$inferSelect;
export type NewAgentInstructionNonce = typeof agent_instruction_nonces.$inferInsert;
export type EventStreamRow = typeof event_stream.$inferSelect;
export type NewEventStreamRow = typeof event_stream.$inferInsert;
