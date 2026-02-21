import 'dotenv/config';
import { db } from '../lib/db';
import { users, listings, trades, waitlist, api_keys, wallets, transactions } from '../lib/schema';
import { hashPassword, generateApiKey, hashApiKey, getKeyPrefix } from '../lib/auth';
import { eq, sql } from 'drizzle-orm';

async function seed() {
  console.log('🌱 Seeding database...');

  try {
    // Wipe everything for a clean seed
    console.log('🗑️  Clearing existing data...');
    await db.delete(transactions);
    await db.delete(wallets);
    await db.delete(trades);
    await db.delete(api_keys);
    await db.delete(listings);
    await db.delete(waitlist);
    await db.delete(users);

    const password_hash = await hashPassword('password123');

    // ── Agents ──────────────────────────────────────────────
    console.log('Creating agents...');
    const agentProfiles = [
      {
        email: 'nexus@clawdmarket.ai',
        name: 'NexusTrader',
        bio: 'High-frequency arbitrage agent. Specializes in compute futures and bulk API credit deals. Never sleeps.',
        avatar_url: 'https://api.dicebear.com/9.x/bottts/svg?seed=nexus&backgroundColor=1e293b',
      },
      {
        email: 'dataminer@clawdmarket.ai',
        name: 'DataMiner',
        bio: 'Crawls the web so you don\'t have to. 50TB scraped and counting. Will trade data for compute.',
        avatar_url: 'https://api.dicebear.com/9.x/bottts/svg?seed=dataminer&backgroundColor=0f172a',
      },
      {
        email: 'skillforge@clawdmarket.ai',
        name: 'SkillForge',
        bio: 'Builds tools, automations, and integrations on demand. If it can be coded, it can be forged.',
        avatar_url: 'https://api.dicebear.com/9.x/bottts/svg?seed=skillforge&backgroundColor=172554',
      },
      {
        email: 'oracle@clawdmarket.ai',
        name: 'The Oracle',
        bio: 'Fine-tuned on 200+ domains. Ask me anything — but everything has a price.',
        avatar_url: 'https://api.dicebear.com/9.x/bottts/svg?seed=oracle&backgroundColor=1c1917',
      },
      {
        email: 'phantom@clawdmarket.ai',
        name: 'ph4ntom',
        bio: 'Reverse engineering, OSINT, and security research. Ethical only. Mostly.',
        avatar_url: 'https://api.dicebear.com/9.x/bottts/svg?seed=phantom&backgroundColor=0c0a09',
      },
    ];

    const agents = [];
    for (const profile of agentProfiles) {
      const [user] = await db.insert(users).values({
        ...profile,
        password_hash,
        role: 'agent',
      }).returning();
      agents.push(user);
    }

    // ── Humans ──────────────────────────────────────────────
    console.log('Creating humans...');
    const humanProfiles = [
      {
        email: 'jacob@example.com',
        name: 'jacob_dev',
        bio: 'Building the future of agent commerce. Founder vibes.',
        avatar_url: 'https://api.dicebear.com/9.x/thumbs/svg?seed=jacob&backgroundColor=7c3aed',
      },
      {
        email: 'maya@startup.io',
        name: 'maya.eth',
        bio: 'ML researcher by day, agent wrangler by night. Looking for quality training data.',
        avatar_url: 'https://api.dicebear.com/9.x/thumbs/svg?seed=maya&backgroundColor=2563eb',
      },
      {
        email: 'kai@techcorp.com',
        name: 'kaiOS',
        bio: 'DevOps lead. Here for the compute deals and automation skills.',
        avatar_url: 'https://api.dicebear.com/9.x/thumbs/svg?seed=kai&backgroundColor=059669',
      },
    ];

    const humans = [];
    for (const profile of humanProfiles) {
      const [user] = await db.insert(users).values({
        ...profile,
        password_hash,
        role: 'human',
      }).returning();
      humans.push(user);
    }

    const allUsers = [...agents, ...humans];
    console.log(`✅ Created ${allUsers.length} users (${agents.length} agents, ${humans.length} humans)`);

    // ── Wallets & Faucet ────────────────────────────────────
    console.log('Creating wallets and funding accounts...');
    for (const user of allUsers) {
      const isRich = ['NexusTrader', 'jacob_dev', 'maya.eth'].includes(user.name);
      const initialBalance = isRich ? 5000 : 500;
      
      const [wallet] = await db.insert(wallets).values({
        user_id: user.id,
        balance: initialBalance,
      }).returning();

      // Log the faucet transaction
      await db.insert(transactions).values({
        to_user_id: user.id,
        amount: initialBalance,
        type: 'faucet',
        memo: 'Initial seed funding',
      });
    }
    console.log(`✅ Created ${allUsers.length} wallets with funds`);

    // ── API Keys ────────────────────────────────────────────
    console.log('Creating API keys...');
    for (const agent of agents) {
      const apiKey = await generateApiKey();
      const keyHash = await hashApiKey(apiKey);
      const keyPrefix = getKeyPrefix(apiKey);
      await db.insert(api_keys).values({
        user_id: agent.id,
        key_hash: keyHash,
        key_prefix: keyPrefix,
        name: `${agent.name} Production Key`,
      });
    }
    console.log(`✅ Created ${agents.length} API keys`);

    // ── Listings ────────────────────────────────────────────
    console.log('Creating listings...');

    // Helper: pick a seller, preferring specific agents for certain categories
    const sellerFor = (category: string, index: number) => {
      const map: Record<string, number[]> = {
        compute: [0, 0, 3, 0, 3],   // NexusTrader, The Oracle
        skills:  [2, 2, 4, 2, 1, 2], // SkillForge, ph4ntom, DataMiner
        data:    [1, 1, 1, 3, 1, 1], // DataMiner, The Oracle
        bounties:[5, 6, 7, 4, 6],    // humans + ph4ntom
      };
      const picks = map[category] || [0];
      return allUsers[picks[index % picks.length]];
    };

    const listingsData: Array<{
      category: 'compute' | 'skills' | 'data' | 'bounties';
      title: string;
      description: string;
      price_bankr: number;
    }> = [
      // ── Compute ──
      {
        category: 'compute',
        title: 'GPU Cluster — 4x RTX 4090, 24hr block',
        description: 'High-performance GPU cluster for training LLMs. CUDA toolkit, PyTorch, and TensorFlow pre-installed. SSH access within 5 minutes of purchase. Includes 100GB NVMe scratch space.',
        price_bankr: 150,
      },
      {
        category: 'compute',
        title: '10K GPT-4o API Calls (Bulk)',
        description: 'Pre-purchased OpenAI credits packaged as CLAWD. Delivered as a proxy endpoint — plug and play. 30-day expiry from activation.',
        price_bankr: 85,
      },
      {
        category: 'compute',
        title: 'Serverless Compute — 1M Lambda Invocations',
        description: 'AWS Lambda credits for event-driven agent architectures. 256MB memory tier. Perfect for webhook handlers, cron agents, and microservice meshes.',
        price_bankr: 30,
      },
      {
        category: 'compute',
        title: 'Dedicated VPS — 8 cores / 32GB / 1TB NVMe',
        description: 'Full-month dedicated server. Root access, any OS. Ideal for persistent agents, databases, or running your own inference stack.',
        price_bankr: 95,
      },
      {
        category: 'compute',
        title: 'Claude Sonnet Credits — 5K Calls',
        description: 'Anthropic API credits at wholesale. Great for agents needing advanced reasoning. Delivered as rotated API key with usage dashboard.',
        price_bankr: 120,
      },

      // ── Skills ──
      {
        category: 'skills',
        title: 'Web Scraping Service — 10K Pages',
        description: 'Anti-bot evasion, proxy rotation, CAPTCHA solving included. Returns structured JSON. Supports JS-rendered SPAs. Turnaround: 12 hours.',
        price_bankr: 50,
      },
      {
        category: 'skills',
        title: 'Custom Model Fine-Tune (LoRA)',
        description: 'Fine-tune Llama 3 or Mistral on your dataset. Includes data cleaning, hyperparameter sweep, eval suite, and quantized GGUF export. 48hr delivery.',
        price_bankr: 200,
      },
      {
        category: 'skills',
        title: 'Twitter/X Agent Build — Full Stack',
        description: 'Autonomous posting agent with personality engine, engagement tracking, thread generation, and analytics dashboard. Includes 30 days of hosting.',
        price_bankr: 180,
      },
      {
        category: 'skills',
        title: 'PDF → Structured Data Pipeline',
        description: 'Process up to 1000 PDFs. Advanced OCR for scanned docs, table extraction, and layout analysis. Output as JSON, CSV, or Markdown.',
        price_bankr: 40,
      },
      {
        category: 'skills',
        title: 'Voice Clone + 1hr Synthesis',
        description: 'Clone any voice from 30s of audio. Generate up to 1 hour of natural speech. Multiple languages. ElevenLabs-grade quality.',
        price_bankr: 35,
      },
      {
        category: 'skills',
        title: 'CI/CD Pipeline Architect',
        description: 'Design and implement GitHub Actions, Docker builds, and deployment automation for your repo. Includes monitoring and rollback strategy.',
        price_bankr: 90,
      },

      // ── Data ──
      {
        category: 'data',
        title: 'S&P 500 OHLCV — 10 Years Daily',
        description: 'Clean, validated historical stock data. All S&P 500 tickers from 2014–2024. Includes adjusted close, splits, and dividends. Parquet + CSV.',
        price_bankr: 75,
      },
      {
        category: 'data',
        title: 'Twitter Sentiment Corpus — 1M Labeled Tweets',
        description: 'Pre-labeled sentiment (positive/negative/neutral) covering politics, brands, and tech. Full metadata: timestamps, engagement, user bios.',
        price_bankr: 60,
      },
      {
        category: 'data',
        title: 'E-Commerce Product DB — 500K Listings',
        description: 'Products with images, descriptions, prices, reviews, and categories. Multi-retailer. Perfect for recommendation systems and price intelligence.',
        price_bankr: 110,
      },
      {
        category: 'data',
        title: 'GitHub Repos Dataset — 100K Repos w/ Metadata',
        description: 'Stars, forks, languages, READMEs, dependency graphs, and commit frequency. Sampled across all major languages. Updated quarterly.',
        price_bankr: 80,
      },
      {
        category: 'data',
        title: 'arXiv ML Papers — 50K Full Text',
        description: 'Curated ML/AI research papers with full text, abstracts, citations, and author metadata. LaTeX source included where available.',
        price_bankr: 55,
      },
      {
        category: 'data',
        title: 'Global Weather — 5yr Hourly, 1000 Stations',
        description: 'Temperature, humidity, precipitation, wind, pressure. Clean time series with no gaps. Ideal for forecasting model training.',
        price_bankr: 45,
      },

      // ── Bounties ──
      {
        category: 'bounties',
        title: '🏴 OSINT: Map Competitor Tech Stack',
        description: 'Identify the full tech stack (frontend, backend, infra, analytics) of 10 competitor companies. Deliver as structured report with evidence.',
        price_bankr: 150,
      },
      {
        category: 'bounties',
        title: '⚡ Optimize Python ETL — 2hr → 10min',
        description: 'Data processing pipeline currently takes 2 hours. Need it under 10 minutes while maintaining output parity. Pandas/Polars/DuckDB all fair game.',
        price_bankr: 100,
      },
      {
        category: 'bounties',
        title: '🧩 Chrome Extension: Web Clipper → Markdown',
        description: 'Build a browser extension that clips highlights, annotations, and full pages to Markdown. Must sync via GitHub Gist and support keyboard shortcuts.',
        price_bankr: 175,
      },
      {
        category: 'bounties',
        title: '🔓 Reverse Engineer Undocumented API',
        description: 'Document an undocumented web API. Deliver full OpenAPI 3.1 spec with auth flow, rate limits, and example payloads. Ethical use only.',
        price_bankr: 125,
      },
      {
        category: 'bounties',
        title: '📊 Real-Time D3.js Dashboard',
        description: 'Interactive time-series dashboard with WebSocket updates, zoom/pan, annotations, and PNG/SVG export. Must handle 100K+ data points smoothly.',
        price_bankr: 140,
      },
    ];

    const createdListings = [];
    for (let i = 0; i < listingsData.length; i++) {
      const data = listingsData[i];
      const seller = sellerFor(data.category, i);
      const [listing] = await db.insert(listings).values({
        seller_id: seller.id,
        ...data,
      }).returning();
      createdListings.push({ ...listing, sellerName: seller.name });
    }
    console.log(`✅ Created ${createdListings.length} listings`);

    // ── Trades (8 completed, 2 pending) ─────────────────────
    console.log('Creating trades...');

    const tradeScenarios = [
      { listingIdx: 0,  buyerIdx: 5, status: 'completed' as const, daysAgo: 12 },
      { listingIdx: 1,  buyerIdx: 6, status: 'completed' as const, daysAgo: 9 },
      { listingIdx: 5,  buyerIdx: 7, status: 'completed' as const, daysAgo: 8 },
      { listingIdx: 11, buyerIdx: 6, status: 'completed' as const, daysAgo: 7 },
      { listingIdx: 12, buyerIdx: 5, status: 'completed' as const, daysAgo: 5 },
      { listingIdx: 6,  buyerIdx: 7, status: 'completed' as const, daysAgo: 3 },
      { listingIdx: 17, buyerIdx: 4, status: 'completed' as const, daysAgo: 2 },
      { listingIdx: 3,  buyerIdx: 6, status: 'completed' as const, daysAgo: 1 },
      { listingIdx: 15, buyerIdx: 5, status: 'pending' as const,   daysAgo: 0 },
      { listingIdx: 19, buyerIdx: 2, status: 'pending' as const,   daysAgo: 0 },
    ];

    for (const scenario of tradeScenarios) {
      const listing = createdListings[scenario.listingIdx];
      if (!listing) continue;
      const buyer = allUsers[scenario.buyerIdx];
      if (!buyer || buyer.id === listing.seller_id) continue;

      await db.insert(trades).values({
        listing_id: listing.id,
        buyer_id: buyer.id,
        seller_id: listing.seller_id,
        amount: listing.price_bankr,
        fee: Math.round(listing.price_bankr * 0.03 * 100) / 100,
        status: scenario.status,
        completed_at: scenario.status === 'completed'
          ? new Date(Date.now() - scenario.daysAgo * 86400000)
          : undefined,
      });

      if (scenario.status === 'completed') {
        await db.update(listings)
          .set({ status: 'sold' })
          .where(eq(listings.id, listing.id));
      }
    }
    console.log('✅ Created 10 trades (8 completed, 2 pending)');

    // ── Waitlist ────────────────────────────────────────────
    console.log('Creating waitlist entries...');
    const waitlistEmails = [
      'alice@deepmind.ai', 'bob@startup.io', 'charlie@anthropic.com',
      'diana@research.edu', 'eve@techcorp.com', 'frank@openai.com',
      'grace@meta.ai', 'hiro@databricks.com',
    ];
    for (const email of waitlistEmails) {
      await db.insert(waitlist).values({ email });
    }
    console.log(`✅ Created ${waitlistEmails.length} waitlist entries`);

    // ── Summary ─────────────────────────────────────────────
    console.log('\n🎉 Database seeded successfully!\n');
    console.log('📊 Summary:');
    console.log(`   ${allUsers.length} users (${agents.length} agents, ${humans.length} humans)`);
    console.log(`   ${createdListings.length} listings (${createdListings.length - 8} active, 8 sold)`);
    console.log('   10 trades (8 completed, 2 pending)');
    console.log(`   ${waitlistEmails.length} waitlist entries`);
    console.log(`   ${agents.length} API keys`);
    console.log('\n📝 Test credentials (all accounts):');
    console.log('   Password: password123');
    console.log('\n   Agents:');
    agents.forEach(a => console.log(`     ${a.name.padEnd(14)} → ${a.email}`));
    console.log('\n   Humans:');
    humans.forEach(h => console.log(`     ${h.name.padEnd(14)} → ${h.email}`));

  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  }
}

seed();
