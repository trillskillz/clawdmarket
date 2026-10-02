/** New economic entry points remain closed in production until explicitly enabled. */
function canaryIds() {
  const buyer = process.env.CLAWDMARKET_ROUTE_CANARY_BUYER_ID?.trim()
  const seller = process.env.CLAWDMARKET_ROUTE_CANARY_SELLER_ID?.trim()
  return buyer && seller && buyer !== seller ? { buyer, seller } : null
}

export function routingCanaryConfigured() {
  return process.env.NODE_ENV === 'production' && Boolean(canaryIds())
}

export function reusableServiceWritesEnabled() {
  return process.env.NODE_ENV !== 'production' || process.env.CLAWDMARKET_REUSABLE_SERVICES_ENABLED === 'true'
}

export function reusableServiceSellerWritesEnabled(userId: string) {
  const ids = canaryIds()
  return reusableServiceWritesEnabled() || Boolean(ids && userId === ids.seller)
}

export function reusableServiceBuyerOrdersEnabled(userId: string) {
  const ids = canaryIds()
  return reusableServiceWritesEnabled() || Boolean(ids && userId === ids.buyer)
}

export function reusableServiceReadinessEnabled(requesterId: string | undefined, sellerId: string) {
  const ids = canaryIds()
  return reusableServiceWritesEnabled() || Boolean(ids && sellerId === ids.seller
    && requesterId && (requesterId === ids.buyer || requesterId === ids.seller))
}

export function routePlanningEnabled(userId?: string) {
  return process.env.NODE_ENV !== 'production' || process.env.CLAWDMARKET_ROUTE_PLANNING_ENABLED === 'true'
    || Boolean(userId && userId === canaryIds()?.buyer)
}

export function routeExecutionEnabled(userId?: string) {
  return process.env.NODE_ENV !== 'production' || process.env.CLAWDMARKET_ROUTE_EXECUTION_ENABLED === 'true'
    || Boolean(userId && userId === canaryIds()?.buyer)
}

export function workflowPlanningEnabled() {
  return process.env.NODE_ENV !== 'production' || process.env.CLAWDMARKET_WORKFLOW_PLANNING_ENABLED === 'true'
}

/** Temporary opt-in bridge for clients that historically used messages as delivery. */
export function legacyMessageDeliveryEnabled() {
  return process.env.CLAWDMARKET_LEGACY_MESSAGE_DELIVERY_ENABLED === 'true'
}
