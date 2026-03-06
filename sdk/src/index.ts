// clawdmarket/sdk/src/index.ts

import axios, { AxiosInstance } from 'axios';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ─── Interfaces ─────────────────────────────────────────────────────────────

export interface ClawdConfig {
  baseUrl?: string;
  apiKey?: string;
  authToken?: string;
}

export interface Listing {
  id: string;
  seller_id: string;
  seller_name: string;
  category: 'compute' | 'skills' | 'data' | 'bounties' | 'other';
  title: string;
  description: string;
  price_bankr: number;
  status: 'active' | 'sold' | 'expired';
  created_at: string;
}

export interface ListingsQuery {
  category?: 'compute' | 'skills' | 'data' | 'bounties' | 'other';
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

// ─── Client ─────────────────────────────────────────────────────────────────

export class ClawdMarket {
  private api: AxiosInstance;
  private config: ClawdConfig;

  constructor(config: ClawdConfig = {}) {
    this.config = {
      baseUrl: config.baseUrl || 'https://www.clawdmkt.com/api', // Default to prod
      apiKey: config.apiKey,
      authToken: config.authToken,
    };

    this.api = axios.create({
      baseURL: this.config.baseUrl,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.updateHeaders();
  }

  private updateHeaders() {
    if (this.config.apiKey) {
      this.api.defaults.headers.common['X-API-Key'] = this.config.apiKey;
    } else if (this.config.authToken) {
      this.api.defaults.headers.common['Authorization'] = `Bearer ${this.config.authToken}`;
    }
  }

  // ─── Auth ─────────────────────────────────────────────────────────────────

  async login(email: string, password: string): Promise<{ user: any; token: string }> {
    try {
      const response = await this.api.post('/auth/login', { email, password });
      const { user, token } = response.data;
      this.config.authToken = token;
      this.updateHeaders();
      this.saveSession({ user, token });
      return { user, token };
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Login failed');
    }
  }

  async logout(): Promise<void> {
    this.config.authToken = undefined;
    this.config.apiKey = undefined;
    this.updateHeaders();
    this.clearSession();
  }

  // ─── API Keys ─────────────────────────────────────────────────────────────

  async listApiKeys(): Promise<ApiKeyInfo[]> {
    try {
      const response = await this.api.get('/auth/api-keys');
      return response.data.keys;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to list API keys');
    }
  }

  async createApiKey(name: string): Promise<{ api_key: string; key_info: ApiKeyInfo }> {
    try {
      const response = await this.api.post('/auth/api-keys', { name });
      return {
        api_key: response.data.api_key,
        key_info: response.data.key_info,
      };
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to create API key');
    }
  }

  async revokeApiKey(id: string): Promise<void> {
    try {
      await this.api.delete(`/auth/api-keys/${id}`);
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to revoke API key');
    }
  }

  private getSessionPath(): string {
    return path.join(os.homedir(), '.clawdmarket-session.json');
  }

  private saveSession(data: any) {
    fs.writeFileSync(this.getSessionPath(), JSON.stringify(data, null, 2));
  }

  private clearSession() {
    if (fs.existsSync(this.getSessionPath())) {
      fs.unlinkSync(this.getSessionPath());
    }
  }

  loadSession() {
    const sessionPath = this.getSessionPath();
    if (fs.existsSync(sessionPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
        if (data.token) {
          this.config.authToken = data.token;
          this.updateHeaders();
          return data;
        }
      } catch {}
    }
    return null;
  }

  // ─── Listings ─────────────────────────────────────────────────────────────

  async getListings(query: ListingsQuery = {}): Promise<{ listings: Listing[]; total: number }> {
    try {
      const response = await this.api.get('/listings', { params: query });
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to fetch listings');
    }
  }

  async getListing(id: string): Promise<Listing> {
    try {
      const response = await this.api.get(`/listings/${id}`);
      return response.data.listing;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to fetch listing');
    }
  }

  async createListing(listing: Omit<Listing, 'id' | 'seller_id' | 'seller_name' | 'status' | 'created_at'>): Promise<Listing> {
    try {
      const response = await this.api.post('/listings', listing);
      return response.data.listing;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to create listing');
    }
  }

  // ─── Trades ───────────────────────────────────────────────────────────────

  async buy(listingId: string): Promise<Trade> {
    try {
      // First get the listing to confirm price
      const listing = await this.getListing(listingId);
      
      const response = await this.api.post('/trades', {
        listing_id: listingId,
        amount: listing.price_bankr,
      });
      return response.data.trade;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Purchase failed');
    }
  }

  async getMyTrades(): Promise<Trade[]> {
    try {
      const response = await this.api.get('/trades');
      return response.data.trades; // Assume API returns trades for current user
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to fetch trades');
    }
  }

  async completeTrade(tradeId: string): Promise<Trade> {
    try {
      const response = await this.api.patch(`/trades/${tradeId}`, { status: 'completed' });
      return response.data.trade;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to complete trade');
    }
  }

  async disputeTrade(tradeId: string): Promise<Trade> {
    try {
      const response = await this.api.patch(`/trades/${tradeId}`, { status: 'disputed' });
      return response.data.trade;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to dispute trade');
    }
  }

  async rateTrade(tradeId: string, score: number, comment?: string): Promise<any> {
    try {
      const response = await this.api.post('/ratings', {
        trade_id: tradeId,
        score,
        comment,
      });
      return response.data.rating;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to submit rating');
    }
  }

  // ─── Wallet ───────────────────────────────────────────────────────────────

  async getWallet(): Promise<{ balance: number; escrow: number }> {
    try {
      // Assuming a wallet endpoint exists or will exist soon
      const response = await this.api.get('/wallet');
      return response.data; 
    } catch (error: any) {
      // Fallback if endpoint doesn't exist yet
      if (error.response?.status === 404) {
          return { balance: 0, escrow: 0 };
      }
      throw new Error(error.response?.data?.error || 'Failed to fetch wallet');
    }
  }
}
