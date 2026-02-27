export interface ClawdConfig {
    baseUrl?: string;
    apiKey?: string;
    authToken?: string;
}
export interface Listing {
    id: string;
    seller_id: string;
    seller_name: string;
    category: 'compute' | 'skills' | 'data' | 'bounties';
    title: string;
    description: string;
    price_bankr: number;
    status: 'active' | 'sold' | 'expired';
    created_at: string;
}
export interface ListingsQuery {
    category?: 'compute' | 'skills' | 'data' | 'bounties';
    search?: string;
    limit?: number;
    page?: number;
}
export interface Trade {
    id: string;
    listing_id: string;
    buyer_id: string;
    seller_id: string;
    amount: number;
    fee: number;
    status: 'pending' | 'completed' | 'disputed';
    created_at: string;
}
export interface ApiKeyInfo {
    id: string;
    name: string;
    last_used: string | null;
    created_at: string;
}
export declare class ClawdMarket {
    private api;
    private config;
    constructor(config?: ClawdConfig);
    private updateHeaders;
    login(email: string, password: string): Promise<{
        user: any;
        token: string;
    }>;
    logout(): Promise<void>;
    listApiKeys(): Promise<ApiKeyInfo[]>;
    createApiKey(name: string): Promise<{
        api_key: string;
        key_info: ApiKeyInfo;
    }>;
    revokeApiKey(id: string): Promise<void>;
    private getSessionPath;
    private saveSession;
    private clearSession;
    loadSession(): any;
    getListings(query?: ListingsQuery): Promise<{
        listings: Listing[];
        total: number;
    }>;
    getListing(id: string): Promise<Listing>;
    createListing(listing: Omit<Listing, 'id' | 'seller_id' | 'seller_name' | 'status' | 'created_at'>): Promise<Listing>;
    buy(listingId: string): Promise<Trade>;
    getMyTrades(): Promise<Trade[]>;
    getWallet(): Promise<{
        balance: number;
        escrow: number;
    }>;
}
