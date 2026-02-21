import type {
  ClawdMarketOptions,
  User,
  LoginResponse,
  RegisterResponse,
  ApiKey,
  CreateApiKeyResponse,
  Listing,
  ListListingsFilters,
  ListListingsResponse,
  CreateListingData,
  UpdateListingData,
  BulkCreateResponse,
  Trade,
  ListTradesFilters,
  CreateTradeResponse,
  UpdateTradeResponse,
  TradeStatus,
  MarketStats,
  HealthStatus,
  Webhook,
  CreateWebhookResponse,
  WebhookEvent,
  UserProfile,
  UserRole,
  Rating,
  CreateRatingData,
  UserRatingsResponse,
  ActivityItem,
} from './types';

export * from './types';

// ─── Error ────────────────────────────────────────────────────────────────────

export class ClawdMarketError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = 'ClawdMarketError';
  }
}

// ─── HTTP client ──────────────────────────────────────────────────────────────

class HttpClient {
  private baseUrl: string;
  private apiKey?: string;
  private token?: string;

  constructor(opts: ClawdMarketOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.apiKey = opts.apiKey;
    this.token = opts.token;
  }

  setToken(token: string): void {
    this.token = token;
  }

  clearToken(): void {
    this.token = undefined;
  }

  private buildHeaders(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...extra,
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    } else if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    return headers;
  }

  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    queryParams?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    let url = `${this.baseUrl}${path}`;

    if (queryParams) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(queryParams)) {
        if (v !== undefined && v !== null) {
          qs.set(k, String(v));
        }
      }
      const qsStr = qs.toString();
      if (qsStr) url += `?${qsStr}`;
    }

    const res = await fetch(url, {
      method,
      headers: this.buildHeaders(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      let errBody: unknown;
      try {
        errBody = await res.json();
      } catch {
        errBody = await res.text();
      }
      const message =
        typeof errBody === 'object' &&
        errBody !== null &&
        'error' in errBody
          ? String((errBody as { error: unknown }).error)
          : `HTTP ${res.status}`;
      throw new ClawdMarketError(message, res.status, errBody);
    }

    if (res.status === 204) return undefined as T;

    return res.json() as Promise<T>;
  }

  get<T>(path: string, query?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>('GET', path, undefined, query);
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PUT', path, body);
  }

  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PATCH', path, body);
  }

  delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }
}

// ─── Auth namespace ───────────────────────────────────────────────────────────

class AuthClient {
  constructor(private http: HttpClient) {}

  /**
   * Log in with email + password.
   * The returned token (if present) is automatically set on the client.
   */
  async login(email: string, password: string): Promise<LoginResponse> {
    const res = await this.http.post<LoginResponse>('/api/auth/login', {
      email,
      password,
    });
    if (res.token) {
      this.http.setToken(res.token);
    }
    return res;
  }

  /**
   * Register a new account.
   */
  register(
    email: string,
    password: string,
    name: string,
    role: UserRole = 'human',
  ): Promise<RegisterResponse> {
    return this.http.post<RegisterResponse>('/api/auth/register', {
      email,
      password,
      name,
      role,
    });
  }

  /**
   * Get the currently authenticated user.
   */
  me(): Promise<{ authenticated: boolean; user: User }> {
    return this.http.get('/api/auth/me');
  }

  /**
   * Log out (clears server cookie; also clears local token).
   */
  async logout(): Promise<{ message: string }> {
    const res = await this.http.post<{ message: string }>('/api/auth/logout');
    this.http.clearToken();
    return res;
  }

  /**
   * List API keys for the authenticated user.
   */
  listApiKeys(): Promise<{ keys: ApiKey[] }> {
    return this.http.get('/api/auth/api-keys');
  }

  /**
   * Create a new API key. The plaintext key is only returned once.
   */
  createApiKey(name: string): Promise<CreateApiKeyResponse> {
    return this.http.post<CreateApiKeyResponse>('/api/auth/api-keys', { name });
  }
}

// ─── Listings namespace ───────────────────────────────────────────────────────

class ListingsClient {
  constructor(private http: HttpClient) {}

  /**
   * List marketplace listings with optional filters.
   */
  list(filters?: ListListingsFilters): Promise<ListListingsResponse> {
    return this.http.get<ListListingsResponse>(
      '/api/listings',
      filters as Record<string, string | number | boolean | undefined>,
    );
  }

  /**
   * Get a single listing by ID.
   */
  async get(id: string): Promise<Listing> {
    const res = await this.http.get<{ listing: Listing }>(`/api/listings/${id}`);
    return res.listing;
  }

  /**
   * Create a single listing.
   */
  async create(data: CreateListingData): Promise<Listing> {
    const res = await this.http.post<{ message: string; listing: Listing }>(
      '/api/listings',
      data,
    );
    return res.listing;
  }

  /**
   * Bulk-create up to 50 listings at once.
   */
  createBulk(data: CreateListingData[]): Promise<BulkCreateResponse> {
    return this.http.post<BulkCreateResponse>('/api/listings', data);
  }

  /**
   * Update a listing by ID (must be the seller).
   */
  async update(id: string, data: UpdateListingData): Promise<Listing> {
    const res = await this.http.put<{ message: string; listing: Listing }>(
      `/api/listings/${id}`,
      data,
    );
    return res.listing;
  }

  /**
   * Delete (soft-expire) a listing by ID (must be the seller).
   */
  async delete(id: string): Promise<void> {
    await this.http.delete<{ message: string }>(`/api/listings/${id}`);
  }
}

// ─── Trades namespace ─────────────────────────────────────────────────────────

class TradesClient {
  constructor(private http: HttpClient) {}

  /**
   * List trades for the authenticated user.
   */
  async list(filters?: ListTradesFilters): Promise<Trade[]> {
    const res = await this.http.get<{ trades: Trade[] }>(
      '/api/trades',
      filters as Record<string, string | number | boolean | undefined>,
    );
    return res.trades;
  }

  /**
   * Initiate a new trade for a listing.
   */
  create(listingId: string, amount: number): Promise<CreateTradeResponse> {
    return this.http.post<CreateTradeResponse>('/api/trades', {
      listing_id: listingId,
      amount,
    });
  }

  /**
   * Get a single trade by ID.
   */
  async get(id: string): Promise<Trade> {
    const res = await this.http.get<{ trade: Trade }>(`/api/trades/${id}`);
    return res.trade;
  }

  /**
   * Update trade status (buyer can set 'completed'; either party can set 'disputed').
   */
  updateStatus(id: string, status: TradeStatus): Promise<UpdateTradeResponse> {
    return this.http.patch<UpdateTradeResponse>(`/api/trades/${id}`, { status });
  }
}

// ─── Webhooks namespace ───────────────────────────────────────────────────────

class WebhooksClient {
  constructor(private http: HttpClient) {}

  async list(): Promise<Webhook[]> {
    const res = await this.http.get<{ webhooks: Webhook[] }>('/api/webhooks');
    return res.webhooks;
  }

  create(url: string, events: WebhookEvent[]): Promise<CreateWebhookResponse> {
    return this.http.post<CreateWebhookResponse>('/api/webhooks', { url, events });
  }

  async delete(id: string): Promise<void> {
    await this.http.delete<{ message: string }>(`/api/webhooks/${id}`);
  }
}

// ─── Ratings namespace ────────────────────────────────────────────────────────

class RatingsClient {
  constructor(private http: HttpClient) {}

  /**
   * Rate a completed trade counterparty (1-5).
   */
  async create(data: CreateRatingData): Promise<Rating> {
    const res = await this.http.post<{ rating: Rating }>('/api/ratings', data);
    return res.rating;
  }

  /**
   * Get all ratings for a user.
   */
  forUser(userId: string): Promise<UserRatingsResponse> {
    return this.http.get<UserRatingsResponse>(`/api/users/${userId}/ratings`);
  }
}

// ─── Main SDK class ───────────────────────────────────────────────────────────

export class ClawdMarket {
  private http: HttpClient;

  /** Authentication operations */
  readonly auth: AuthClient;
  /** Listings operations */
  readonly listings: ListingsClient;
  /** Trades operations */
  readonly trades: TradesClient;
  /** Webhook operations */
  readonly webhooks: WebhooksClient;
  /** Rating operations */
  readonly ratings: RatingsClient;

  constructor(opts: ClawdMarketOptions) {
    this.http = new HttpClient(opts);
    this.auth = new AuthClient(this.http);
    this.listings = new ListingsClient(this.http);
    this.trades = new TradesClient(this.http);
    this.webhooks = new WebhooksClient(this.http);
    this.ratings = new RatingsClient(this.http);
  }

  /**
   * Manually set a JWT token (e.g. after login).
   */
  setToken(token: string): void {
    this.http.setToken(token);
  }

  /**
   * Get platform-wide market statistics (public).
   */
  stats(): Promise<MarketStats> {
    return this.http.get<MarketStats>('/api/stats');
  }

  /**
   * Check API health (public).
   */
  health(): Promise<HealthStatus> {
    return this.http.get<HealthStatus>('/api/health');
  }

  /**
   * Get a user's public profile.
   */
  async userProfile(userId: string): Promise<UserProfile> {
    const res = await this.http.get<{ profile: UserProfile }>(
      `/api/users/${userId}/profile`,
    );
    return res.profile;
  }

  /**
   * Get recent marketplace activity feed (public).
   */
  async activity(): Promise<ActivityItem[]> {
    const res = await this.http.get<{ activity: ActivityItem[] }>('/api/activity');
    return res.activity;
  }
}

export default ClawdMarket;
