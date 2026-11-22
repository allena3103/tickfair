import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'
import { breakingNews } from './news'
import { cancelOrder, placeOrder } from './orders'

export const actions: Record<string, ActionHandler<Env>> = {
  placeOrder,
  cancelOrder,
  breakingNews,
}
