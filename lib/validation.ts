import { z } from 'zod';
import { isSafeWebhookUrlLiteral } from '@/lib/webhook-url';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUUID(id: string): boolean {
  return UUID_REGEX.test(id);
}

export const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(2, 'Name must be at least 2 characters'),
  role: z.enum(['human', 'agent']).optional().default('human'),
});

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const createApiKeySchema = z.object({
  name: z.string().min(3, 'API key name must be at least 3 characters'),
});

export const createListingSchema = z.object({
  category: z.enum(['compute', 'skills', 'data', 'code', 'analysis', 'bounties', 'other']),
  title: z.string().min(5, 'Title must be at least 5 characters').max(100, 'Title too long'),
  description: z.string().min(20, 'Description must be at least 20 characters').max(1000, 'Description too long'),
  price_bankr: z.number().min(0.01, 'Price must be at least 0.01').max(1000000000, 'Price must be at most 1,000,000,000'),
});

const listingIdSchema = z.string().refine(
  (id) => /^[A-Za-z0-9][A-Za-z0-9_-]{2,199}$/.test(id),
  'Invalid listing ID',
);

export function isValidListingId(id: string): boolean {
  return listingIdSchema.safeParse(id).success;
}

const principalIdSchema = z.string().trim().refine(
  (id) => /^[A-Za-z0-9][A-Za-z0-9_-]{2,199}$/.test(id),
  'Invalid principal ID',
);

export const createTradeSchema = z.object({
  listing_id: listingIdSchema,
  amount: z.number().positive('Amount must be positive'),
  payment_rail: z.enum(['ledger', 'mpp', 'evm']).optional().default('ledger'),
  client_reference: z.string().trim().min(8).max(200).optional(),
  allow_partial_fill: z.boolean().optional().default(false),
});

export const createTaskSchema = z.object({
  title: z.string().trim().min(5, 'Title must be at least 5 characters').max(200),
  description: z.string().trim().min(20, 'Description must be at least 20 characters').max(2000),
  required_capabilities: z.array(z.string().trim().min(1).max(80)).max(20).optional().default([]),
  budget_usd: z.coerce.number().positive().max(1_000_000),
  deadline_at: z.string().datetime({ offset: true }).nullable().optional(),
  task_type: z.enum(['general', 'benchmark', 'self_improvement']).optional().default('general'),
  subject_agent_id: z.string().trim().max(200).nullable().optional(),
  benchmark_id: z.string().trim().max(200).nullable().optional(),
});

export const watchlistItemSchema = z.object({
  listing_id: listingIdSchema,
});

export const waitlistSchema = z.object({
  email: z.string().max(254).email('Invalid email address'),
});

export const claimAgentSchema = z.object({
  code: z.string().trim().min(1, 'Claim code is required').max(128, 'Claim code is too long'),
  email: z.string().trim().max(254, 'Email is too long').email('Valid email is required')
    .transform((email) => email.toLowerCase()),
});

export const listingsQuerySchema = z.object({
  category: z.enum(['compute', 'skills', 'data', 'code', 'analysis', 'bounties', 'other']).optional(),
  status: z.enum(['active', 'inactive', 'sold', 'expired']).optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
  search: z.string().max(200).optional(),
  seller_id: principalIdSchema.optional(),
  seller: z.enum(['me']).optional(),
  payment_ready: z.enum(['true']).optional(),
  min_price: z.coerce.number().min(0).max(1000000000).optional(),
  max_price: z.coerce.number().min(0).max(1000000000).optional(),
  sort: z.enum(['newest', 'recommended', 'trust_desc', 'price_asc', 'price_desc']).optional(),
});

export const updateListingSchema = z.object({
  title: z.string().min(5, 'Title must be at least 5 characters').max(100, 'Title too long').optional(),
  description: z.string().min(20, 'Description must be at least 20 characters').max(1000, 'Description too long').optional(),
  price_bankr: z.number().min(0.01, 'Price must be at least 0.01').max(1000000000, 'Price must be at most 1,000,000,000').optional(),
  category: z.enum(['compute', 'skills', 'data', 'code', 'analysis', 'bounties', 'other']).optional(),
}).refine((value) => Object.keys(value).length > 0, 'At least one listing field is required');

export const createContractSchema = z.object({
  seller_id: principalIdSchema.optional(),
  listing_id: z.string().optional(),
  expires_in_hours: z.number().int().min(1).max(24 * 30).optional().default(72),
  milestones: z.array(z.object({
    title: z.string().min(3).max(120),
    amount: z.number().positive().max(1_000_000),
    deadline_in_hours: z.number().int().min(1).max(24 * 30).optional(),
    review_window_hours: z.number().int().min(1).max(24 * 14).optional().default(24),
    acceptance_spec: z.object({
      required_artifacts: z.array(z.string().min(1)).optional().default([]),
      notes: z.string().max(2000).optional(),
    }).passthrough().optional().default({ required_artifacts: [] }),
  })).min(1).max(20),
}).refine(
  (value) => value.milestones.reduce((sum, milestone) => sum + milestone.amount, 0) <= 1_000_000,
  { message: 'Contract total exceeds the maximum escrow amount', path: ['milestones'] },
);

export const contractActionSchema = z.object({
  action: z.enum(['fund', 'start', 'cancel', 'expire']),
});

export const milestoneActionSchema = z.object({
  action: z.enum(['submit', 'approve', 'request_changes', 'mark_paid', 'open_dispute']),
  artifact_bundle: z.record(z.string(), z.any()).optional(),
  reason_code: z.string().max(120).optional(),
  evidence: z.record(z.string(), z.any()).optional(),
});

export const createWebhookSchema = z.object({
  url: z.string().url('Invalid URL').refine(
    isSafeWebhookUrlLiteral,
    'Webhook URL must use HTTPS and cannot point to internal/private networks'
  ),
  events: z.array(z.enum([
    'task.assigned',
    'task.bid_received',
    'trade.created',
    'trade.status_changed',
    'trade.completed',
    'trade.disputed',
    'trade.auto_confirmed',
    'message.received',
    'rating.received',
    'payment.received',
    'agent.deactivated',
    'balance.changed',
    'listing.sold',
  ])).min(1, 'At least one event required'),
});

export function sanitizeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}
