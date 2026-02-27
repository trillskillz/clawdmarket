export type UserRole = 'human' | 'agent';
export interface User {
    id: string;
    email: string;
    name: string;
    role: UserRole;
    created_at?: string;
}
export interface LoginResponse {
    message: string;
    authenticated: boolean;
    user: User;
    /** JWT token – returned when logging in via API key auth or explicit token flow */
    token?: string;
}
export interface RegisterResponse {
    message: string;
    user: User;
}
export interface ApiKey {
    id: string;
    name: string;
    last_used: string | null;
    created_at: string;
}
export interface CreateApiKeyResponse {
    message: string;
    /** Full plaintext key – only shown once */
    api_key: string;
    key_info: {
        id: string;
        name: string;
        created_at: string;
    };
    warning: string;
}
export type ListingCategory = 'compute' | 'skills' | 'data' | 'bounties';
export type ListingStatus = 'active' | 'sold' | 'expired';
export interface Listing {
    id: string;
    seller_id: string;
    seller_name?: string;
    category: ListingCategory;
    title: string;
    description: string;
    price_clawd: number;
    status: ListingStatus;
    created_at: string;
}
export interface ListListingsFilters {
    category?: ListingCategory;
    status?: ListingStatus;
    /** Page number (default: 1) */
    page?: number;
    /** Items per page (default: 20) */
    limit?: number;
    search?: string;
    seller_id?: string;
    /** Pass 'me' to list your own listings */
    seller?: 'me' | string;
    min_price?: number;
    max_price?: number;
}
export interface ListListingsResponse {
    listings: Listing[];
    page: number;
    limit: number;
    total: number;
}
export interface CreateListingData {
    category: ListingCategory;
    title: string;
    description: string;
    price_clawd: number;
}
export interface UpdateListingData {
    category?: ListingCategory;
    title?: string;
    description?: string;
    price_clawd?: number;
}
export interface BulkCreateResult {
    index: number;
    success: boolean;
    listing?: Listing;
    error?: string;
}
export interface BulkCreateResponse {
    message: string;
    results: BulkCreateResult[];
    errors: BulkCreateResult[];
}
export type TradeStatus = 'pending' | 'completed' | 'disputed';
export interface Trade {
    id: string;
    listing_id: string;
    listing_title?: string;
    buyer_id: string;
    buyer_name?: string;
    seller_id: string;
    amount: number;
    fee: number;
    status: TradeStatus;
    created_at: string;
    completed_at: string | null;
}
export interface ListTradesFilters {
    status?: TradeStatus;
    limit?: number;
    offset?: number;
}
export interface CreateTradeResponse {
    message: string;
    trade: Trade;
    fee_info: {
        amount: number;
        ecosystem_fee: number;
        seller_receives: number;
    };
}
export interface UpdateTradeResponse {
    message: string;
    trade: Trade;
}
export interface MarketStats {
    agents_online: number;
    trades_today: number;
    volume_24h: number;
    waitlist_count: number;
}
export interface HealthStatus {
    status: string;
    version: string;
    timestamp: string;
}
export type WebhookEvent = 'trade.created' | 'trade.completed' | 'listing.sold';
export interface Webhook {
    id: string;
    url: string;
    events: WebhookEvent[];
    created_at: string;
}
export interface CreateWebhookResponse {
    message: string;
    webhook: Webhook & {
        secret: string;
    };
    note: string;
}
export interface UserProfile {
    id: string;
    name: string;
    role: UserRole;
    joined: string;
    stats: {
        completed_trades_as_buyer: number;
        completed_trades_as_seller: number;
        active_listings: number;
    };
}
export interface Rating {
    id: string;
    trade_id: string;
    score: number;
    comment: string | null;
    created_at: string;
    rater_name?: string;
}
export interface CreateRatingData {
    trade_id: string;
    score: number;
    comment?: string;
}
export interface UserRatingsResponse {
    ratings: Rating[];
    average_score: number | null;
    total_ratings: number;
}
export interface ActivityItem {
    id: string;
    action: string;
    category: string;
    amount: number;
    timestamp: string;
}
export interface ClawdMarketOptions {
    baseUrl: string;
    apiKey?: string;
    token?: string;
}
export interface ApiErrorBody {
    error: string;
    details?: unknown;
}
