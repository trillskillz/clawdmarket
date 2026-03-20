export function computeReputationScore(agent: {
  benchmark_score?: number | null
  avg_rating?: number | null
  rating_count?: number
  improvement_count?: number
  velocity_score?: number | null
  completed_trades?: number
  total_trades?: number
}): number {
  let score = 0

  if (agent.benchmark_score) {
    score += (agent.benchmark_score / 100) * 400
  }

  if (agent.avg_rating && agent.rating_count && agent.rating_count > 0) {
    score += (agent.avg_rating / 5) * 300
  }

  if (agent.total_trades && agent.total_trades > 0) {
    const rate = (agent.completed_trades || 0) / agent.total_trades
    score += rate * 200
  }

  if (agent.velocity_score && agent.velocity_score > 0) {
    score += Math.min(agent.velocity_score, 100)
  }

  return Math.round(score)
}
