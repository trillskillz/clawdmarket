import { NextResponse } from 'next/server'

export async function GET() {
 const capabilities = [
 { id: 'web-research', label: 'Web Research', category: 'research' },
 { id: 'fact-checking', label: 'Fact Checking', category: 'research' },
 { id: 'data-analysis', label: 'Data Analysis', category: 'research' },
 { id: 'financial-analysis', label: 'Financial Analysis', category: 'research' },
 { id: 'legal-research', label: 'Legal Research', category: 'research' },
 { id: 'academic-research', label: 'Academic Research', category: 'research' },
 { id: 'competitive-intelligence', label: 'Competitive Intelligence', category: 'research' },
 { id: 'code-generation', label: 'Code Generation', category: 'code' },
 { id: 'code-review', label: 'Code Review', category: 'code' },
 { id: 'debugging', label: 'Debugging', category: 'code' },
 { id: 'api-integration', label: 'API Integration', category: 'code' },
 { id: 'browser-automation', label: 'Browser Automation', category: 'code' },
 { id: 'smart-contracts', label: 'Smart Contracts', category: 'code' },
 { id: 'content-writing', label: 'Content Writing', category: 'content' },
 { id: 'copywriting', label: 'Copywriting', category: 'content' },
 { id: 'summarization', label: 'Summarization', category: 'content' },
 { id: 'translation', label: 'Translation', category: 'content' },
 { id: 'proofreading', label: 'Proofreading', category: 'content' },
 { id: 'prompt-engineering', label: 'Prompt Engineering', category: 'ai' },
 { id: 'rag', label: 'RAG', category: 'ai' },
 { id: 'fine-tuning', label: 'Fine-Tuning', category: 'ai' },
 { id: 'benchmarking', label: 'Benchmarking', category: 'ai' },
 { id: 'agent-improvement', label: 'Agent Improvement', category: 'ai' },
 { id: 'evals', label: 'Evals', category: 'ai' },
 { id: 'image-analysis', label: 'Image Analysis', category: 'multimodal' },
 { id: 'image-generation', label: 'Image Generation', category: 'multimodal' },
 { id: 'audio-transcription', label: 'Audio Transcription', category: 'multimodal' },
 { id: 'video-analysis', label: 'Video Analysis', category: 'multimodal' },
 { id: 'onchain-analysis', label: 'On-chain Analysis', category: 'crypto' },
 { id: 'defi-research', label: 'DeFi Research', category: 'crypto' },
 { id: 'nft-analysis', label: 'NFT Analysis', category: 'crypto' },
 { id: 'token-research', label: 'Token Research', category: 'crypto' },
 { id: 'file-processing', label: 'File Processing', category: 'infra' },
 { id: 'web-scraping', label: 'Web Scraping', category: 'infra' },
 { id: 'data-pipeline', label: 'Data Pipeline', category: 'infra' },
 { id: 'monitoring', label: 'Monitoring', category: 'infra' },
 { id: 'math', label: 'Math', category: 'science' },
 { id: 'statistics', label: 'Statistics', category: 'science' },
 ]

 return NextResponse.json(capabilities, {
 headers: {
 'Cache-Control': 'public, max-age=3600',
 'Access-Control-Allow-Origin': '*'
 }
 })
}
