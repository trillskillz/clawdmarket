import { z } from 'zod';

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
  category: z.enum(['compute', 'skills', 'data', 'bounties', 'other']),
  title: z.string().min(5, 'Title must be at least 5 characters').max(100, 'Title too long'),
  description: z.string().min(20, 'Description must be at least 20 characters').max(1000, 'Description too long'),
  price_bankr: z.number().min(864, 'Price must be at least 864').max(2465, 'Price must be at most 2465'),
});

export const createTradeSchema = z.object({
  listing_id: z.string().uuid('Invalid listing ID'),
  amount: z.number().positive('Amount must be positive'),
  allow_partial_fill: z.boolean().optional().default(false),
});

export const watchlistItemSchema = z.object({
  listing_id: z.string().uuid('Invalid listing ID'),
});

export const waitlistSchema = z.object({
  email: z.string().email('Invalid email address'),
});

export const listingsQuerySchema = z.object({
  category: z.enum(['compute', 'skills', 'data', 'bounties', 'other']).optional(),
  status: z.enum(['active', 'sold', 'expired']).optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
  search: z.string().optional(),
  seller_id: z.string().uuid().optional(),
  seller: z.enum(['me']).optional(),
  min_price: z.coerce.number().min(864).max(2465).optional(),
  max_price: z.coerce.number().min(864).max(2465).optional(),
});

export const updateListingSchema = z.object({
  title: z.string().min(5, 'Title must be at least 5 characters').max(100, 'Title too long').optional(),
  description: z.string().min(20, 'Description must be at least 20 characters').max(1000, 'Description too long').optional(),
  price_bankr: z.number().min(864, 'Price must be at least 864').max(2465, 'Price must be at most 2465').optional(),
  category: z.enum(['compute', 'skills', 'data', 'bounties', 'other']).optional(),
});

export const updateTradeStatusSchema = z.object({
  status: z.enum(['completed', 'disputed']),
});

function isPrivateIP(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length === 4 && parts.every(p => p >= 0 && p <= 255)) {
    if (parts[0] === 10) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 0) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
  }
  if (ip === '::1' || ip === '::' || ip.startsWith('fe80:') || ip.startsWith('fc') || ip.startsWith('fd')) {
    return true;
  }
  return false;
}

const BLOCKED_HOSTNAMES = ['localhost', 'metadata.google.internal', 'metadata.internal'];

function isBlockedWebhookUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return true;
    const hostname = parsed.hostname.toLowerCase();
    if (BLOCKED_HOSTNAMES.includes(hostname)) return true;
    if (isPrivateIP(hostname)) return true;
    if (parsed.port && parsed.port !== '443') return true;
    return false;
  } catch {
    return true;
  }
}

export const createWebhookSchema = z.object({
  url: z.string().url('Invalid URL').refine(
    (url) => !isBlockedWebhookUrl(url),
    'Webhook URL must use HTTPS and cannot point to internal/private networks'
  ),
  events: z.array(z.enum(['trade.created', 'trade.completed', 'listing.sold', 'balance.changed'])).min(1, 'At least one event required'),
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
