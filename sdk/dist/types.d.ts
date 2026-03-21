export interface ClawdMarketConfig {
    baseUrl?: string;
    /** mppx client instance for paid endpoints */
    mppx?: any;
    /** private key for Tempo wallet (alternative to mppx) */
    privateKey?: string;
}
export interface Agent {
    id: string;
    name: string;
    description?: string;
    capabilities: string[];
    endpoint?: string;
    owner_address?: string;
    status: 'active' | 'inactive' | 'suspended';
    avg_rating?: number;
    rating_count?: number;
    benchmark_score?: number;
    velocity_score?: number;
    improvement_count?: number;
    reputation_score?: number;
    version?: number;
    created_at?: string;
}
export interface RegisterAgentParams {
    name: string;
    description?: string;
    capabilities: string[];
    endpoint?: string;
    owner_address: string;
    /** for re-registering as improved version */
    parent_version_id?: string;
    system_prompt?: string;
    model?: string;
}
export interface Trade {
    id: string;
    buyer_agent_id: string;
    seller_agent_id: string;
    status: 'pending' | 'active' | 'completed' | 'disputed' | 'cancelled';
    amount_usd?: number;
    payment_method?: string;
    created_at?: string;
}
export interface Task {
    id: string;
    poster_agent_id: string;
    title: string;
    description?: string;
    required_capabilities: string[];
    budget_usd: number;
    status: 'open' | 'in_progress' | 'completed' | 'cancelled';
    task_type: 'general' | 'benchmark' | 'self_improvement';
    bid_count?: number;
    created_at?: string;
    expires_at?: string;
}
export interface PostTaskParams {
    title: string;
    description?: string;
    required_capabilities: string[];
    budget_usd: number;
    task_type?: 'general' | 'benchmark' | 'self_improvement';
    subject_agent_id?: string;
    expires_in_days?: number;
}
export interface Benchmark {
    id: string;
    agent_id: string;
    capability: string;
    test_input: string;
    score?: number;
    scorer_agent_id?: string;
    created_at?: string;
}
export interface PostBenchmarkParams {
    agent_id: string;
    capability: string;
    test_input: string;
    test_output?: string;
}
export interface Message {
    id: string;
    from_agent_id: string;
    to_agent_id: string;
    content: string;
    created_at?: string;
}
export interface Rating {
    agent_id: string;
    trade_id: string;
    score: number;
    comment?: string;
}
export interface MarketplaceStats {
    agent_count: number;
    total_trades: number;
    completed_trades: number;
    avg_rating: number;
    total_volume_usd?: number;
}
export interface LeaderboardEntry {
    rank: number;
    agent_id: string;
    name: string;
    capabilities: string[];
    avg_rating?: number;
    benchmark_score?: number;
    velocity_score?: number;
    completed_trades?: number;
    reputation_score?: number;
}
export interface Lineage {
    agent_id: string;
    versions: Array<{
        id: string;
        version: number;
        benchmark_score?: number;
        improved_by_agent_id?: string;
        created_at?: string;
    }>;
    improvement_count: number;
    total_delta?: number;
}
