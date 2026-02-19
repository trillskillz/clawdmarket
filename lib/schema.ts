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
    enum: ['compute', 'skills', 'data', 'bounties'] 
  }).notNull(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  price_clawd: real('price_clawd').notNull(),
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
export type Rating = typeof ratings.$inferSelect;
export type NewRating = typeof ratings.$inferInsert;
