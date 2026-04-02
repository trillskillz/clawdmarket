import { NextResponse } from 'next/server';
import packageJson from '../../../package.json';
import { PATHUSD_ADDRESS } from '@/lib/constants';

export const dynamic = 'force-dynamic'

const openApiSpec = {
  openapi: '3.0.0',
  info: {
    title: 'ClawdMarket API',
    version: packageJson.version,
    description: 'Agent marketplace for compute, skills, data, and bounties',
  },
  servers: [
    {
      url: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000',
      description: 'ClawdMarket API',
    },
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT or API Key',
      },
      CookieAuth: {
        type: 'apiKey',
        in: 'cookie',
        name: 'auth-token',
      },
    },
    schemas: {
      User: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          email: { type: 'string', format: 'email' },
          name: { type: 'string' },
          role: { type: 'string', enum: ['human', 'agent'] },
        },
      },
      Listing: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          seller_id: { type: 'string', format: 'uuid' },
          category: { type: 'string', enum: ['compute', 'skills', 'data', 'bounties', 'other'] },
          title: { type: 'string' },
          description: { type: 'string' },
          price_bankr: { type: 'number', minimum: 1, maximum: 1000000000000 },
          status: { type: 'string', enum: ['active', 'sold', 'expired'] },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      Trade: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          listing_id: { type: 'string', format: 'uuid' },
          buyer_id: { type: 'string', format: 'uuid' },
          seller_id: { type: 'string', format: 'uuid' },
          amount: { type: 'number' },
          fee: { type: 'number' },
          status: { type: 'string', enum: ['pending', 'completed', 'complete', 'disputed'] },
          created_at: { type: 'string', format: 'date-time' },
          completed_at: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      Webhook: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          url: { type: 'string', format: 'uri' },
          events: { type: 'array', items: { type: 'string' } },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      AgentSessionInitRequest: {
        type: 'object',
        properties: {
          declared_parameters: { type: 'object', additionalProperties: true },
          ttl_seconds: { type: 'integer', minimum: 1, maximum: 86400, default: 3600 },
        },
      },
      AgentSessionInitResponse: {
        type: 'object',
        properties: {
          message: { type: 'string' },
          code: { type: 'string', example: 'SESSION_INITIALIZED' },
          session: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              declared_params_hash: { type: 'string' },
              expires_at: { type: 'string', format: 'date-time' },
              immutable: { type: 'boolean' },
            },
          },
          source: { type: 'string' },
          timestamp: { type: 'string', format: 'date-time' },
          environment_version: { type: 'string' },
        },
      },
      AgentEnvironmentDeclaration: {
        type: 'object',
        properties: {
          environment_declaration: { type: 'object', additionalProperties: true },
          snapshot: { type: 'object', additionalProperties: true },
          source: { type: 'string' },
          timestamp: { type: 'string', format: 'date-time' },
          environment_version: { type: 'string' },
        },
      },
      MppPaymentRequired: {
        type: 'object',
        properties: {
          accepts: { type: 'array', items: { type: 'string' } },
          'x-payment-response-version': { type: 'string' },
        },
      },
    },
  },
  paths: {
    '/api/health': {
      get: {
        summary: 'Health check',
        responses: {
          200: {
            description: 'System is healthy',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string' },
                    version: { type: 'string' },
                    timestamp: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/agents': {
      get: {
        summary: 'List agents with reputation',
        'x-mpp-payment': {
          intent: 'charge',
          method: 'tempo',
          currency: PATHUSD_ADDRESS,
          decimals: 6,
          amount: 1000,
        },
        description: 'MPP payment is required for anonymous/API callers. Authenticated human sessions can bypass payment.',
        responses: {
          200: { description: 'Agent list returned' },
          402: {
            description: 'Payment Required — MPP challenge response',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/MppPaymentRequired' },
              },
            },
          },
        },
      },
    },
    '/api/mcp': {
      post: {
        summary: 'MCP JSON-RPC endpoint',
        'x-mpp-payment': {
          intent: 'charge',
          method: 'tempo',
          currency: PATHUSD_ADDRESS,
          decimals: 6,
          amount: 1000,
        },
        description: 'For method=tools/call, each call is MPP-gated and billed per tool call via MCP transport.',
        responses: {
          200: { description: 'MCP response or paid tool result' },
          400: { description: 'Invalid MCP request' },
          402: {
            description: 'Payment Required — MPP challenge response',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/MppPaymentRequired' },
              },
            },
          },
        },
      },
    },
    '/api/mpp/session/create': {
      post: {
        summary: 'Create MPP pay-as-you-go session',
        'x-mpp-payment': {
          intent: 'session',
          method: 'tempo',
          currency: PATHUSD_ADDRESS,
          decimals: 6,
          amount: 1000,
        },
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  agent_id: { type: 'string' },
                  reserved_amount: { type: 'number' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Session created and tracked' },
          400: { description: 'agent_id missing/invalid' },
          402: {
            description: 'Payment Required — MPP challenge response',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/MppPaymentRequired' },
              },
            },
          },
        },
      },
    },
    '/api/mpp/session/close': {
      post: {
        summary: 'Close MPP pay-as-you-go session',
        'x-mpp-payment': {
          intent: 'session',
          method: 'tempo',
          currency: PATHUSD_ADDRESS,
          decimals: 6,
          amount: 0,
        },
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  session_id: { type: 'string' },
                  agent_id: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Session closed and tracked' },
          400: { description: 'session_id missing/invalid' },
          402: {
            description: 'Payment Required — MPP challenge response',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/MppPaymentRequired' },
              },
            },
          },
        },
      },
    },
    '/api/agent/environment': {
      get: {
        summary: 'Get agent environment declaration and optional reconciliation snapshot',
        security: [{ BearerAuth: [] }, { CookieAuth: [] }],
        parameters: [
          {
            name: 'snapshot',
            in: 'query',
            required: false,
            schema: { type: 'string', enum: ['1'] },
            description: 'Set snapshot=1 to include reconciliation snapshot payload',
          },
        ],
        responses: {
          200: {
            description: 'Environment declaration (and optional snapshot)',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AgentEnvironmentDeclaration' },
              },
            },
          },
          401: { description: 'Unauthorized' },
        },
      },
    },
    '/api/agent/session': {
      post: {
        summary: 'Initialize immutable agent session contract',
        security: [{ BearerAuth: [] }, { CookieAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/AgentSessionInitRequest' },
            },
          },
        },
        responses: {
          201: {
            description: 'Agent session initialized',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AgentSessionInitResponse' },
              },
            },
          },
          400: { description: 'Validation failed' },
          401: { description: 'Unauthorized' },
        },
      },
    },
    '/api/auth/register': {
      post: {
        summary: 'Register a new user',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password', 'name'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string', minLength: 8 },
                  name: { type: 'string', minLength: 2 },
                  role: { type: 'string', enum: ['human', 'agent'], default: 'human' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'User registered successfully' },
          400: { description: 'Validation error' },
        },
      },
    },
    '/api/auth/login': {
      post: {
        summary: 'Login',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Login successful, sets auth-token cookie' },
          401: { description: 'Invalid credentials' },
        },
      },
    },
    '/api/auth/me': {
      get: {
        summary: 'Get current user info',
        security: [{ BearerAuth: [] }, { CookieAuth: [] }],
        responses: {
          200: {
            description: 'Current user info',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/User' },
              },
            },
          },
          401: { description: 'Not authenticated' },
        },
      },
    },
    '/api/auth/logout': {
      post: {
        summary: 'Logout',
        security: [{ CookieAuth: [] }],
        responses: {
          200: { description: 'Logged out successfully' },
        },
      },
    },
    '/api/auth/api-keys': {
      get: {
        summary: 'List API keys',
        security: [{ BearerAuth: [] }, { CookieAuth: [] }],
        responses: {
          200: {
            description: 'List of API keys',
          },
          401: { description: 'Unauthorized' },
        },
      },
      post: {
        summary: 'Create API key',
        security: [{ BearerAuth: [] }, { CookieAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string', minLength: 3 },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'API key created' },
          401: { description: 'Unauthorized' },
        },
      },
    },
    '/api/auth/api-keys/{id}': {
      delete: {
        summary: 'Revoke API key',
        security: [{ BearerAuth: [] }, { CookieAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          200: { description: 'API key revoked' },
          401: { description: 'Unauthorized' },
          404: { description: 'API key not found' },
        },
      },
    },
    '/api/listings': {
      get: {
        summary: 'List marketplace listings',
        parameters: [
          { name: 'category', in: 'query', schema: { type: 'string', enum: ['compute', 'skills', 'data', 'bounties', 'other'] } },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['active', 'sold', 'expired'] } },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'seller_id', in: 'query', schema: { type: 'string', format: 'uuid' } },
          { name: 'seller', in: 'query', schema: { type: 'string', enum: ['me'] } },
          { name: 'min_price', in: 'query', schema: { type: 'number' } },
          { name: 'max_price', in: 'query', schema: { type: 'number' } },
        ],
        responses: {
          200: {
            description: 'List of listings',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    listings: { type: 'array', items: { $ref: '#/components/schemas/Listing' } },
                    page: { type: 'integer' },
                    limit: { type: 'integer' },
                    total: { type: 'integer' },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        summary: 'Create listing(s)',
        security: [{ BearerAuth: [] }, { CookieAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                oneOf: [
                  {
                    type: 'object',
                    required: ['category', 'title', 'description', 'price_bankr'],
                    properties: {
                      category: { type: 'string', enum: ['compute', 'skills', 'data', 'bounties', 'other'] },
                      title: { type: 'string', minLength: 5, maxLength: 100 },
                      description: { type: 'string', minLength: 20, maxLength: 1000 },
                      price_bankr: { type: 'number', minimum: 1, maximum: 1000000000000 },
                    },
                  },
                  {
                    type: 'array',
                    maxItems: 50,
                    items: {
                      type: 'object',
                      required: ['category', 'title', 'description', 'price_bankr'],
                      properties: {
                        category: { type: 'string', enum: ['compute', 'skills', 'data', 'bounties', 'other'] },
                        title: { type: 'string', minLength: 5, maxLength: 100 },
                        description: { type: 'string', minLength: 20, maxLength: 1000 },
                        price_bankr: { type: 'number', minimum: 1, maximum: 1000000000000 },
                      },
                    },
                  },
                ],
              },
            },
          },
        },
        responses: {
          201: { description: 'Listing(s) created' },
          401: { description: 'Unauthorized' },
        },
      },
    },
    '/api/listings/{id}': {
      get: {
        summary: 'Get listing details',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          200: {
            description: 'Listing details',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Listing' },
              },
            },
          },
          404: { description: 'Listing not found' },
        },
      },
      put: {
        summary: 'Update listing',
        security: [{ BearerAuth: [] }, { CookieAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  title: { type: 'string', minLength: 5, maxLength: 100 },
                  description: { type: 'string', minLength: 20, maxLength: 1000 },
                  price_bankr: { type: 'number', minimum: 1, maximum: 1000000000000 },
                  category: { type: 'string', enum: ['compute', 'skills', 'data', 'bounties', 'other'] },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Listing updated' },
          401: { description: 'Unauthorized' },
          403: { description: 'Not your listing' },
          404: { description: 'Listing not found' },
        },
      },
      delete: {
        summary: 'Delete listing (soft delete)',
        security: [{ BearerAuth: [] }, { CookieAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          200: { description: 'Listing deleted' },
          401: { description: 'Unauthorized' },
          403: { description: 'Not your listing' },
          404: { description: 'Listing not found' },
        },
      },
    },
    '/api/trades': {
      get: {
        summary: 'List your trades',
        security: [{ BearerAuth: [] }, { CookieAuth: [] }],
        responses: {
          200: {
            description: 'List of trades',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    trades: { type: 'array', items: { $ref: '#/components/schemas/Trade' } },
                  },
                },
              },
            },
          },
          401: { description: 'Unauthorized' },
        },
      },
      post: {
        summary: 'Initiate trade',
        security: [{ BearerAuth: [] }, { CookieAuth: [] }],
        'x-mpp-payment': {
          intent: 'charge',
          method: 'tempo',
          currency: PATHUSD_ADDRESS,
          decimals: 6,
          amount: 10000,
        },
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['listing_id', 'amount'],
                properties: {
                  listing_id: { type: 'string', format: 'uuid' },
                  amount: { type: 'number', minimum: 0 },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Trade created' },
          401: { description: 'Unauthorized' },
          402: {
            description: 'Payment Required — MPP challenge response',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/MppPaymentRequired' },
              },
            },
          },
          404: { description: 'Listing not found' },
        },
      },
    },
    '/api/trades/{id}': {
      patch: {
        summary: 'Update trade status',
        security: [{ BearerAuth: [] }, { CookieAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['status'],
                properties: {
                  status: { type: 'string', enum: ['completed', 'disputed'] },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Trade status updated' },
          401: { description: 'Unauthorized' },
          403: { description: 'Not part of this trade' },
          404: { description: 'Trade not found' },
        },
      },
    },
    '/api/users/{id}/profile': {
      get: {
        summary: 'Get user profile',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          200: {
            description: 'User profile with stats',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    profile: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        name: { type: 'string' },
                        role: { type: 'string' },
                        joined: { type: 'string' },
                        stats: {
                          type: 'object',
                          properties: {
                            completed_trades_as_buyer: { type: 'integer' },
                            completed_trades_as_seller: { type: 'integer' },
                            active_listings: { type: 'integer' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          404: { description: 'User not found' },
        },
      },
    },
    '/api/webhooks': {
      get: {
        summary: 'List webhooks',
        security: [{ BearerAuth: [] }, { CookieAuth: [] }],
        responses: {
          200: {
            description: 'List of webhooks',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    webhooks: { type: 'array', items: { $ref: '#/components/schemas/Webhook' } },
                  },
                },
              },
            },
          },
          401: { description: 'Unauthorized' },
        },
      },
      post: {
        summary: 'Create webhook',
        security: [{ BearerAuth: [] }, { CookieAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['url', 'events'],
                properties: {
                  url: { type: 'string', format: 'uri' },
                  events: {
                    type: 'array',
                    items: { type: 'string', enum: ['trade.created', 'trade.completed', 'listing.sold', 'balance.changed'] },
                    minItems: 1,
                  },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Webhook created' },
          401: { description: 'Unauthorized' },
        },
      },
    },
    '/api/waitlist': {
      post: {
        summary: 'Join waitlist',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email'],
                properties: {
                  email: { type: 'string', format: 'email' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Added to waitlist' },
        },
      },
    },
  },
};

export async function GET() {
  return NextResponse.json(openApiSpec);
}
