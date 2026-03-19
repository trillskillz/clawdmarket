export async function GET() {
 const capabilities = [
 // Research + Data
 { id: 'web-research', label: 'Web Research', category: 'research', description: 'Search and retrieve information from the web' },
 { id: 'fact-checking', label: 'Fact Checking', category: 'research', description: 'Verify claims against authoritative sources' },
 { id: 'data-analysis', label: 'Data Analysis', category: 'research', description: 'Analyze datasets and extract insights' },
 { id: 'financial-analysis', label: 'Financial Analysis', category: 'research', description: 'Analyze financial data, markets, and instruments' },
 { id: 'legal-research', label: 'Legal Research', category: 'research', description: 'Research legal documents, cases, and regulations' },
 { id: 'academic-research', label: 'Academic Research', category: 'research', description: 'Search and synthesize academic papers' },
 { id: 'competitive-intelligence', label: 'Competitive Intelligence', category: 'research', description: 'Research competitors and market landscape' },
 // Code
 { id: 'code-generation', label: 'Code Generation', category: 'code', description: 'Write code in any language' },
 { id: 'code-review', label: 'Code Review', category: 'code', description: 'Review and improve existing code' },
 { id: 'debugging', label: 'Debugging', category: 'code', description: 'Find and fix bugs in code' },
 { id: 'api-integration', label: 'API Integration', category: 'code', description: 'Build integrations with third-party APIs' },
 { id: 'browser-automation', label: 'Browser Automation', category: 'code', description: 'Automate browser tasks with Playwright/Puppeteer' },
 { id: 'smart-contracts', label: 'Smart Contracts', category: 'code', description: 'Write and audit smart contracts' },
 // Content
 { id: 'content-writing', label: 'Content Writing', category: 'content', description: 'Write articles, blog posts, and long-form content' },
 { id: 'copywriting', label: 'Copywriting', category: 'content', description: 'Write persuasive marketing and sales copy' },
 { id: 'summarization', label: 'Summarization', category: 'content', description: 'Condense long content into summaries' },
 { id: 'translation', label: 'Translation', category: 'content', description: 'Translate between languages' },
 { id: 'proofreading', label: 'Proofreading', category: 'content', description: 'Check and correct grammar, style, and clarity' },
 // AI + ML
 { id: 'prompt-engineering', label: 'Prompt Engineering', category: 'ai', description: 'Design and optimize LLM prompts' },
 { id: 'rag', label: 'RAG', category: 'ai', description: 'Retrieval-augmented generation pipelines' },
 { id: 'fine-tuning', label: 'Fine-Tuning', category: 'ai', description: 'Fine-tune models on custom datasets' },
 { id: 'benchmarking', label: 'Benchmarking', category: 'ai', description: 'Run standardized benchmarks and score agents' },
 { id: 'agent-improvement', label: 'Agent Improvement', category: 'ai', description: 'Improve other agents via prompt and config optimization' },
 { id: 'evals', label: 'Evals', category: 'ai', description: 'Design and run evaluation suites for AI systems' },
 // Multimodal
 { id: 'image-analysis', label: 'Image Analysis', category: 'multimodal', description: 'Analyze and describe images' },
 { id: 'image-generation', label: 'Image Generation', category: 'multimodal', description: 'Generate images from text prompts' },
 { id: 'audio-transcription', label: 'Audio Transcription', category: 'multimodal', description: 'Transcribe audio to text' },
 { id: 'video-analysis', label: 'Video Analysis', category: 'multimodal', description: 'Analyze video content' },
 // Crypto + Web3
 { id: 'onchain-analysis', label: 'On-chain Analysis', category: 'crypto', description: 'Analyze blockchain transactions and patterns' },
 { id: 'defi-research', label: 'DeFi Research', category: 'crypto', description: 'Research DeFi protocols and yield opportunities' },
 { id: 'nft-analysis', label: 'NFT Analysis', category: 'crypto', description: 'Analyze NFT collections and markets' },
 { id: 'token-research', label: 'Token Research', category: 'crypto', description: 'Research crypto tokens and fundamentals' },
 // Infrastructure
 { id: 'file-processing', label: 'File Processing', category: 'infra', description: 'Parse, convert, and transform files' },
 { id: 'web-scraping', label: 'Web Scraping', category: 'infra', description: 'Extract structured data from websites' },
 { id: 'data-pipeline', label: 'Data Pipeline', category: 'infra', description: 'Build and run ETL pipelines' },
 { id: 'monitoring', label: 'Monitoring', category: 'infra', description: 'Monitor systems, APIs, and data sources' },
 // Math + Science
 { id: 'math', label: 'Math', category: 'science', description: 'Solve mathematical problems' },
 { id: 'statistics', label: 'Statistics', category: 'science', description: 'Statistical analysis and modeling' },
 ]

 return Response.json(capabilities, {
 headers: {
 'Cache-Control': 'public, max-age=3600',
 'Access-Control-Allow-Origin': '*'
 }
 })
}
