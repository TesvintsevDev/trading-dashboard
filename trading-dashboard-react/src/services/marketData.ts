import type { DashboardState, MarketData, Trade } from '../domain/types'

export const EMPTY_MARKET_DATA: MarketData = {
  symbols: {},
  dailySymbols: {},
}

export async function loadMarketData(file = '/data/market-data-2026-05-14.json'): Promise<MarketData> {
  const response = await fetch(file)
  if (!response.ok) {
    throw new Error(`Failed to load market data: ${response.status}`)
  }
  return response.json() as Promise<MarketData>
}

export async function loadApiState(): Promise<DashboardState> {
  const response = await fetch('/api/state')
  if (!response.ok) {
    throw new Error(`Failed to load API state: ${response.status}`)
  }
  return response.json() as Promise<DashboardState>
}

export async function loadApiMarketData(): Promise<MarketData> {
  const response = await fetch('/api/market/all')
  if (!response.ok) {
    throw new Error(`Failed to load API market data: ${response.status}`)
  }
  return response.json() as Promise<MarketData>
}

export async function refreshApiFiveMinuteData(): Promise<MarketData> {
  const response = await fetch('/api/refresh/5m', { method: 'POST' })
  if (!response.ok) {
    throw new Error(`Failed to refresh 5m data: ${response.status}`)
  }
  return loadApiMarketData()
}

export async function saveApiTrade(trade: Trade): Promise<void> {
  if (!trade.symbol) return
  const response = await fetch(`/api/trades/${encodeURIComponent(trade.symbol)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(trade),
  })
  if (!response.ok) {
    throw new Error(`Failed to save trade: ${response.status}`)
  }
}

export async function deleteApiTrade(symbol: string): Promise<void> {
  const response = await fetch(`/api/trades/${encodeURIComponent(symbol)}`, {
    method: 'DELETE',
  })
  if (!response.ok) {
    throw new Error(`Failed to delete trade: ${response.status}`)
  }
}

export async function importApiMovers(payload: {
  source?: string
  text?: string
  catalystType?: string
  dayDriver?: string
  note?: string
  independentIdeaConfirmed?: boolean
}): Promise<{ imported: number; symbols: string[] }> {
  const response = await fetch('/api/import/movers', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    throw new Error(`Failed to import movers: ${response.status}`)
  }
  return response.json() as Promise<{ imported: number; symbols: string[] }>
}

export async function runApiPremarketScan(symbols?: string[]): Promise<void> {
  const suffix = symbols?.length ? `?symbols=${encodeURIComponent(symbols.join(','))}` : ''
  const response = await fetch(`/api/scan/premarket${suffix}`, { method: 'POST' })
  if (!response.ok) {
    throw new Error(`Failed to run premarket scan: ${response.status}`)
  }
}
