import { parseNumber } from '../domain/filters'
import type { CandidateView, Trade } from '../domain/types'

type TradeInput = {
  entry: string
  stop: string
  target: string
  size: string
  guidance: string
}

export function isStopFartherFromPrice(direction: 'long' | 'short', previousStop: number, nextStop: number) {
  return direction === 'long' ? nextStop < previousStop : nextStop > previousStop
}

export function buildTradeUpdate(candidate: CandidateView, existing: Trade | undefined, input: TradeInput): Trade {
  const parsedEntry = parseNumber(input.entry)
  const parsedStop = parseNumber(input.stop)
  const parsedTarget = parseNumber(input.target)
  const parsedSize = parseNumber(input.size)
  const direction = candidate.setupState.direction
  const previousStop = existing?.currentStop ?? existing?.initialStop
  const initialStop = existing?.initialStop ?? parsedStop ?? candidate.planLevels?.stopPrice
  const stopEvents = existing?.stopEvents ? [...existing.stopEvents] : []
  let currentStop = existing?.currentStop ?? initialStop

  if (parsedStop !== null) {
    const allowed =
      previousStop === undefined ||
      !isStopFartherFromPrice(direction, previousStop, parsedStop)
    stopEvents.push({
      at: new Date().toISOString(),
      from: previousStop,
      to: parsedStop,
      reason: allowed
        ? 'Manual stop update accepted. Confirm 5m structure before relying on it.'
        : 'Rejected: stop would move farther from price, against system rules.',
      allowed,
    })
    if (allowed) currentStop = parsedStop
  }

  return {
    ...existing,
    symbol: candidate.symbol,
    entry: parsedEntry ?? existing?.entry,
    initialStop,
    currentStop,
    target: parsedTarget ?? existing?.target,
    size: parsedSize ?? existing?.size,
    status: existing?.status || 'active',
    guidance: input.guidance,
    stopEvents,
  }
}
