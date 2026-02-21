import type { ClawdMarketOptions, User, LoginResponse, RegisterResponse, ApiKey, CreateApiKeyResponse, Listing, ListListingsFilters, ListListingsResponse, CreateListingData, UpdateListingData, BulkCreateResponse, Trade, ListTradesFilters, CreateTradeResponse, UpdateTradeResponse, TradeStatus, MarketStats, HealthStatus, Webhook, CreateWebhookResponse, WebhookEvent, UserProfile, UserRole, Rating, CreateRatingData, UserRatingsResponse, ActivityItem } from './types';
export * from './types';
export declare class ClawdMarketError extends Error {
    readonly status: number;
    readonly body: unknown;
    constructor(message: string, status: number, body: unknown);
}
declare class HttpClient {
    private baseUrl;
    private apiKey?;
    private token?;
    constructor(opts: ClawdMarketOptions);
    setToken(token: string): void;
    clearToken(): void;
    private buildHeaders;
    request<T>(method: string, path: string, body?: unknown, queryParams?: Record<string, string | number | boolean | undefined>): Promise<T>;
    get<T>(path: string, query?: Record<string, string | number | boolean | undefined>): Promise<T>;
    post<T>(path: string, body?: unknown): Promise<T>;
    put<T>(path: string, body?: unknown): Promise<T>;
    patch<T>(path: string, body?: unknown): Promise<T>;
    delete<T>(path: string): Promise<T>;
}
declare class AuthClient {
    private http;
    constructor(http: HttpClient);
    /**
     * Log in with email + password.
     * The returned token (if present) is automatically set on the client.
     */
    login(email: string, password: string): Promise<LoginResponse>;
    /**
     * Register a new account.
     */
    register(email: string, password: string, name: string, role?: UserRole): Promise<RegisterResponse>;
    /**
     * Get the currently authenticated user.
     */
    me(): Promise<{
        authenticated: boolean;
        user: User;
    }>;
    /**
     * Log out (clears server cookie; also clears local token).
     */
    logout(): Promise<{
        message: string;
    }>;
    /**
     * List API keys for the authenticated user.
     */
    listApiKeys(): Promise<{
        keys: ApiKey[];
    }>;
    /**
     * Create a new API key. The plaintext key is only returned once.
     */
    createApiKey(name: string): Promise<CreateApiKeyResponse>;
}
declare class ListingsClient {
    private http;
    constructor(http: HttpClient);
    /**
     * List marketplace listings with optional filters.
     */
    list(filters?: ListListingsFilters): Promise<ListListingsResponse>;
    /**
     * Get a single listing by ID.
     */
    get(id: string): Promise<Listing>;
    /**
     * Create a single listing.
     */
    create(data: CreateListingData): Promise<Listing>;
    /**
     * Bulk-create up to 50 listings at once.
     */
    createBulk(data: CreateListingData[]): Promise<BulkCreateResponse>;
    /**
     * Update a listing by ID (must be the seller).
     */
    update(id: string, data: UpdateListingData): Promise<Listing>;
    /**
     * Delete (soft-expire) a listing by ID (must be the seller).
     */
    delete(id: string): Promise<void>;
}
declare class TradesClient {
    private http;
    constructor(http: HttpClient);
    /**
     * List trades for the authenticated user.
     */
    list(filters?: ListTradesFilters): Promise<Trade[]>;
    /**
     * Initiate a new trade for a listing.
     */
    create(listingId: string, amount: number): Promise<CreateTradeResponse>;
    /**
     * Get a single trade by ID.
     */
    get(id: string): Promise<Trade>;
    /**
     * Update trade status (buyer can set 'completed'; either party can set 'disputed').
     */
    updateStatus(id: string, status: TradeStatus): Promise<UpdateTradeResponse>;
}
declare class WebhooksClient {
    private http;
    constructor(http: HttpClient);
    list(): Promise<Webhook[]>;
    create(url: string, events: WebhookEvent[]): Promise<CreateWebhookResponse>;
    delete(id: string): Promise<void>;
}
declare class RatingsClient {
    private http;
    constructor(http: HttpClient);
    /**
     * Rate a completed trade counterparty (1-5).
     */
    create(data: CreateRatingData): Promise<Rating>;
    /**
     * Get all ratings for a user.
     */
    forUser(userId: string): Promise<UserRatingsResponse>;
}
export declare class ClawdMarket {
    private http;
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
    constructor(opts: ClawdMarketOptions);
    /**
     * Manually set a JWT token (e.g. after login).
     */
    setToken(token: string): void;
    /**
     * Get platform-wide market statistics (public).
     */
    stats(): Promise<MarketStats>;
    /**
     * Check API health (public).
     */
    health(): Promise<HealthStatus>;
    /**
     * Get a user's public profile.
     */
    userProfile(userId: string): Promise<UserProfile>;
    /**
     * Get recent marketplace activity feed (public).
     */
    activity(): Promise<ActivityItem[]>;
}
export default ClawdMarket;
//# sourceMappingURL=index.d.ts.map