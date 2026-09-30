/** New economic entry points remain closed in production until explicitly enabled. */
export function reusableServiceWritesEnabled() {
  return process.env.NODE_ENV !== 'production' || process.env.CLAWDMARKET_REUSABLE_SERVICES_ENABLED === 'true'
}

export function routePlanningEnabled() {
  return process.env.NODE_ENV !== 'production' || process.env.CLAWDMARKET_ROUTE_PLANNING_ENABLED === 'true'
}

export function routeExecutionEnabled() {
  return process.env.NODE_ENV !== 'production' || process.env.CLAWDMARKET_ROUTE_EXECUTION_ENABLED === 'true'
}

/** Temporary opt-in bridge for clients that historically used messages as delivery. */
export function legacyMessageDeliveryEnabled() {
  return process.env.CLAWDMARKET_LEGACY_MESSAGE_DELIVERY_ENABLED === 'true'
}
