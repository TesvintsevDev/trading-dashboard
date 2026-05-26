const YAHOO_BASE_URL = 'https://query1.finance.yahoo.com/v8/finance/chart'

function yahooSymbol(symbol) {
  return symbol.replace('.', '-').toUpperCase()
}

function chartUrl(symbol, range, interval) {
  const url = new URL(`${YAHOO_BASE_URL}/${encodeURIComponent(yahooSymbol(symbol))}`)
  url.searchParams.set('range', range)
  url.searchParams.set('interval', interval)
  url.searchParams.set('includePrePost', 'true')
  url.searchParams.set('events', 'div,splits')
  return url
}

function normalizeChartPayload(payload) {
  const result = payload?.chart?.result?.[0]
  const timestamps = result?.timestamp || []
  const quote = result?.indicators?.quote?.[0]
  if (!quote || !timestamps.length) return []

  return timestamps
    .map((timestamp, index) => ({
      t: timestamp * 1000,
      o: quote.open?.[index],
      h: quote.high?.[index],
      l: quote.low?.[index],
      c: quote.close?.[index],
      v: quote.volume?.[index] || 0,
    }))
    .filter(
      (bar) =>
        Number.isFinite(bar.t) &&
        Number.isFinite(bar.o) &&
        Number.isFinite(bar.h) &&
        Number.isFinite(bar.l) &&
        Number.isFinite(bar.c),
    )
}

export async function fetchYahooBars(symbol, { range, interval }) {
  const response = await fetch(chartUrl(symbol, range, interval), {
    headers: {
      'user-agent': 'Mozilla/5.0',
    },
  })
  if (!response.ok) {
    throw new Error(`Yahoo ${symbol} ${interval} failed: HTTP ${response.status}`)
  }

  const payload = await response.json()
  const error = payload?.chart?.error
  if (error) {
    throw new Error(`Yahoo ${symbol} ${interval} failed: ${error.description || error.code}`)
  }

  const bars = normalizeChartPayload(payload)
  if (!bars.length) {
    throw new Error(`Yahoo ${symbol} ${interval} returned no bars`)
  }
  return bars
}

export async function fetchYahooQuotes(symbols) {
  if (!symbols.length) return []
  const url = new URL('https://query1.finance.yahoo.com/v7/finance/quote')
  url.searchParams.set('symbols', symbols.map(yahooSymbol).join(','))
  url.searchParams.set('fields', [
    'symbol',
    'shortName',
    'longName',
    'regularMarketPrice',
    'regularMarketPreviousClose',
    'regularMarketChangePercent',
    'regularMarketVolume',
    'averageDailyVolume3Month',
    'marketState',
    'exchange',
    'quoteType',
    'bid',
    'ask',
  ].join(','))

  const response = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0',
    },
  })
  if (!response.ok) {
    throw new Error(`Yahoo quote failed: HTTP ${response.status}`)
  }
  const payload = await response.json()
  return payload?.quoteResponse?.result || []
}

export function candidateSymbols(db) {
  return db
    .prepare('SELECT symbol FROM candidates ORDER BY symbol')
    .all()
    .map((row) => row.symbol)
}

export function insertBars(db, symbol, timeframe, bars) {
  const insertBar = db.prepare(`
    INSERT INTO bars (symbol, timeframe, bar_time, open, high, low, close, volume)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(symbol, timeframe, bar_time) DO UPDATE SET
      open = excluded.open,
      high = excluded.high,
      low = excluded.low,
      close = excluded.close,
      volume = excluded.volume
  `)

  for (const bar of bars) {
    insertBar.run(symbol, timeframe, bar.t, bar.o, bar.h, bar.l, bar.c, bar.v || 0)
  }
}

export async function updateFiveMinuteBars(db, symbols = candidateSymbols(db)) {
  const updatedSymbols = []
  const failedSymbols = []

  for (const symbol of symbols) {
    try {
      const bars = await fetchYahooBars(symbol, { range: '1d', interval: '5m' })
      insertBars(db, symbol, '5m', bars)
      updatedSymbols.push({ symbol, bars: bars.length })
    } catch (error) {
      failedSymbols.push({
        symbol,
        error: error instanceof Error ? error.message : 'Unknown Yahoo error',
      })
    }
  }

  return {
    updatedAt: new Date().toISOString(),
    symbolsRequested: symbols.length,
    symbolsUpdated: updatedSymbols.length,
    updatedSymbols,
    failedSymbols,
  }
}

export async function updateDailyBars(db, symbols = candidateSymbols(db)) {
  const updatedSymbols = []
  const failedSymbols = []

  for (const symbol of symbols) {
    try {
      const bars = await fetchYahooBars(symbol, { range: '6mo', interval: '1d' })
      insertBars(db, symbol, 'daily', bars)
      updatedSymbols.push({ symbol, bars: bars.length })
    } catch (error) {
      failedSymbols.push({
        symbol,
        error: error instanceof Error ? error.message : 'Unknown Yahoo error',
      })
    }
  }

  return {
    updatedAt: new Date().toISOString(),
    symbolsRequested: symbols.length,
    symbolsUpdated: updatedSymbols.length,
    updatedSymbols,
    failedSymbols,
  }
}
