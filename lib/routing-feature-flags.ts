/** New economic entry points remain closed in production until explicitly enabled. */
export function reusableServiceWritesEnabled() {
  return process.env.NODE_ENV !== 'production' || process.env.CLAWDMARKET_REUSABLE_SERVICES_ENABLED === 'true'
}

export function routePlanningEnabled() {
  return process.env.NODE_ENV !== 'production' || process.env.CLAWDMARKET_ROUTE_PLANNING_ENABLED === 'true'
}
