import 'dotenv/config'
import { reconcileTerminalServiceOrders } from '@/lib/service-order-state'

let total = 0
for (;;) {
  const count = await reconcileTerminalServiceOrders()
  total += count
  if (count < 1_000) break
}
console.log(`Reconciled ${total} terminal service order capacity reservations`)
