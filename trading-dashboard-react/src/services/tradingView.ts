import type { Candidate } from '../domain/types'

export function tradingViewSymbol(candidate: Candidate) {
  const exchange =
    candidate.exchange && !candidate.exchange.includes('/') ? candidate.exchange : 'NASDAQ'

  return `${exchange}:${candidate.symbol}`
}
