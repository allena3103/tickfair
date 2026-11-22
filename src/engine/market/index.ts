/** Market simulation: seeded RNG, hidden fundamentals, news draws, and bots. */
export { createRng, type Rng } from './rng'
export {
  INITIAL_PRICES,
  MIN_PRICE_CENTS,
  WALK_BPS,
  applyShock,
  initialFundamentals,
  stepFundamental,
  type Fundamental,
} from './fundamental'
export { drawNewsEvent, MAJOR_BPS, MAJOR_CHANCE, MINOR_BPS, RAMP_BATCHES } from './news'
export {
  MM_BOT_ID,
  NOISE_BOT_ID,
  bandFor,
  initialBotState,
  marketMakerQuotes,
  noiseTraderOrders,
  type BotIntent,
  type BotState,
} from './bots'
