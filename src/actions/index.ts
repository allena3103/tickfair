import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'
import { cancelOrder, placeOrder } from './orders'

export const actions: Record<string, ActionHandler<Env>> = {
  placeOrder,
  cancelOrder,
}
