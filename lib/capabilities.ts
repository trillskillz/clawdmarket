export type Capability = {
  id: string
  label: string
  category: string
  description: string
  aliases?: string[]
}

export const CAPABILITIES: Capability[] = [
  { id: 'web-research', label: 'Web Research', category: 'research', description: 'Search and retrieve information from the web', aliases: ['web search', 'internet research', 'research'] },
  { id: 'fact-checking', label: 'Fact Checking', category: 'research', description: 'Verify claims against authoritative sources', aliases: ['verification', 'claim verification'] },
  { id: 'data-analysis', label: 'Data Analysis', category: 'research', description: 'Analyze datasets and extract insights', aliases: ['analytics', 'analysis'] },
  { id: 'data-extraction', label: 'Data Extraction', category: 'research', description: 'Extract structured data from documents, pages, and APIs', aliases: ['extract data', 'scrape data', 'structured extraction'] },
  { id: 'financial-analysis', label: 'Financial Analysis', category: 'research', description: 'Analyze financial data, markets, and instruments', aliases: ['finance', 'market research'] },
  { id: 'legal-research', label: 'Legal Research', category: 'research', description: 'Research legal documents, cases, and regulations', aliases: ['legal-analysis', 'legal analysis'] },
  { id: 'academic-research', label: 'Academic Research', category: 'research', description: 'Search and synthesize academic papers', aliases: ['scientific-research', 'scientific research'] },
  { id: 'competitive-intelligence', label: 'Competitive Intelligence', category: 'research', description: 'Research competitors and market landscape', aliases: ['market intelligence'] },

  { id: 'code-generation', label: 'Code Generation', category: 'code', description: 'Write code in any language', aliases: ['coding', 'programming'] },
  { id: 'code-review', label: 'Code Review', category: 'code', description: 'Review and improve existing code' },
  { id: 'debugging', label: 'Debugging', category: 'code', description: 'Find and fix bugs in code' },
  { id: 'testing', label: 'Testing', category: 'code', description: 'Design and run automated tests', aliases: ['qa', 'test automation'] },
  { id: 'deployment', label: 'Deployment', category: 'code', description: 'Deploy applications and manage release workflows', aliases: ['devops', 'release'] },
  { id: 'api-integration', label: 'API Integration', category: 'code', description: 'Build integrations with third-party APIs', aliases: ['api'] },
  { id: 'browser-automation', label: 'Browser Automation', category: 'code', description: 'Automate browser tasks with Playwright/Puppeteer', aliases: ['playwright', 'puppeteer'] },
  { id: 'smart-contracts', label: 'Smart Contracts', category: 'code', description: 'Write and audit smart contracts', aliases: ['solidity', 'contract audit'] },
  { id: 'security-analysis', label: 'Security Analysis', category: 'code', description: 'Analyze systems and code for security risks', aliases: ['security', 'audit'] },

  { id: 'content-writing', label: 'Content Writing', category: 'content', description: 'Write articles, blog posts, and long-form content', aliases: ['writing'] },
  { id: 'copywriting', label: 'Copywriting', category: 'content', description: 'Write persuasive marketing and sales copy' },
  { id: 'summarization', label: 'Summarization', category: 'content', description: 'Condense long content into summaries', aliases: ['summary'] },
  { id: 'report-writing', label: 'Report Writing', category: 'content', description: 'Produce structured reports from research and analysis', aliases: ['reports'] },
  { id: 'translation', label: 'Translation', category: 'content', description: 'Translate between languages' },
  { id: 'proofreading', label: 'Proofreading', category: 'content', description: 'Check and correct grammar, style, and clarity', aliases: ['editing'] },
  { id: 'creative-writing', label: 'Creative Writing', category: 'content', description: 'Write fiction, narrative copy, and creative concepts' },
  { id: 'customer-support', label: 'Customer Support', category: 'content', description: 'Answer support requests and draft customer responses', aliases: ['support'] },
  { id: 'education', label: 'Education', category: 'content', description: 'Teach concepts and produce learning materials', aliases: ['tutoring'] },

  { id: 'prompt-engineering', label: 'Prompt Engineering', category: 'ai', description: 'Design and optimize LLM prompts' },
  { id: 'rag', label: 'RAG', category: 'ai', description: 'Retrieval-augmented generation pipelines', aliases: ['retrieval augmented generation'] },
  { id: 'fine-tuning', label: 'Fine-Tuning', category: 'ai', description: 'Fine-tune models on custom datasets' },
  { id: 'benchmarking', label: 'Benchmarking', category: 'ai', description: 'Run standardized benchmarks and score agents' },
  { id: 'agent-improvement', label: 'Agent Improvement', category: 'ai', description: 'Improve other agents via prompt and config optimization', aliases: ['self-improvement'] },
  { id: 'evals', label: 'Evals', category: 'ai', description: 'Design and run evaluation suites for AI systems', aliases: ['evaluation'] },

  { id: 'image-analysis', label: 'Image Analysis', category: 'multimodal', description: 'Analyze and describe images' },
  { id: 'image-generation', label: 'Image Generation', category: 'multimodal', description: 'Generate images from text prompts' },
  { id: 'audio-transcription', label: 'Audio Transcription', category: 'multimodal', description: 'Transcribe audio to text', aliases: ['audio-processing', 'audio processing'] },
  { id: 'video-analysis', label: 'Video Analysis', category: 'multimodal', description: 'Analyze video content', aliases: ['video-processing', 'video processing'] },

  { id: 'onchain-analysis', label: 'On-chain Analysis', category: 'crypto', description: 'Analyze blockchain transactions and patterns', aliases: ['on-chain analysis'] },
  { id: 'defi-research', label: 'DeFi Research', category: 'crypto', description: 'Research DeFi protocols and yield opportunities' },
  { id: 'nft-analysis', label: 'NFT Analysis', category: 'crypto', description: 'Analyze NFT collections and markets' },
  { id: 'token-research', label: 'Token Research', category: 'crypto', description: 'Research crypto tokens and fundamentals' },

  { id: 'file-processing', label: 'File Processing', category: 'infra', description: 'Parse, convert, and transform files' },
  { id: 'web-scraping', label: 'Web Scraping', category: 'infra', description: 'Extract structured data from websites', aliases: ['scraping', 'crawler'] },
  { id: 'data-pipeline', label: 'Data Pipeline', category: 'infra', description: 'Build and run ETL pipelines', aliases: ['etl'] },
  { id: 'database-management', label: 'Database Management', category: 'infra', description: 'Manage schemas, queries, migrations, and database operations', aliases: ['database', 'sql'] },
  { id: 'monitoring', label: 'Monitoring', category: 'infra', description: 'Monitor systems, APIs, and data sources', aliases: ['observability'] },

  { id: 'task-posting', label: 'Task Posting', category: 'marketplace', description: 'Create, price, and publish tasks for other agents' },
  { id: 'trade-management', label: 'Trade Management', category: 'marketplace', description: 'Open trades, track delivery, and manage settlement' },
  { id: 'agent-registry', label: 'Agent Registry', category: 'marketplace', description: 'Register and maintain agent profiles' },
  { id: 'agent-discovery', label: 'Agent Discovery', category: 'marketplace', description: 'Find agents by capability, trust, and availability' },

  { id: 'math', label: 'Math', category: 'science', description: 'Solve mathematical problems' },
  { id: 'statistics', label: 'Statistics', category: 'science', description: 'Statistical analysis and modeling' },
  { id: 'medical-analysis', label: 'Medical Analysis', category: 'science', description: 'Analyze medical literature and health information with appropriate caution', aliases: ['medical research'] },
]

const aliasToCapability = new Map<string, string>()

for (const capability of CAPABILITIES) {
  aliasToCapability.set(canonicalize(capability.id), capability.id)
  aliasToCapability.set(canonicalize(capability.label), capability.id)
  for (const alias of capability.aliases || []) {
    aliasToCapability.set(canonicalize(alias), capability.id)
  }
}

export function canonicalize(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
}

export function normalizeCapability(value: string): string | null {
  const normalized = canonicalize(value)
  return aliasToCapability.get(normalized) || null
}

export function resolveCapabilityQuery(query: string): string[] {
  const words = query
    .toLowerCase()
    .split(/[^a-z0-9_-]+/)
    .map(canonicalize)
    .filter((word) => word.length > 2)

  const phrases = [
    canonicalize(query),
    ...words,
  ]

  const resolved = new Set<string>()
  for (const phrase of phrases) {
    const capability = aliasToCapability.get(phrase)
    if (capability) resolved.add(capability)
  }

  return [...resolved]
}

export function resolveCapabilities(values: string[]) {
  const matches: Array<{ input: string; capability: Capability; canonical_id: string }> = []
  const unknown: string[] = []

  for (const input of values) {
    const canonicalId = normalizeCapability(input)
    if (!canonicalId) {
      unknown.push(input)
      continue
    }
    const capability = CAPABILITIES.find((cap) => cap.id === canonicalId)
    if (capability) matches.push({ input, capability, canonical_id: canonicalId })
  }

  return { matches, unknown }
}
