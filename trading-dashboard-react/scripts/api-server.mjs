import { createServer } from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { parseMoversPayload, saveImportedMovers } from './lib/movers-import.mjs'
import { buildPremarketScan } from './lib/premarket-scan.mjs'
import { alertKindFor, evaluateSetup } from './lib/setup-evaluator.mjs'
import { insertBars, updateDailyBars, updateFiveMinuteBars } from './lib/yahoo-market-data.mjs'

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)))
const dbPath = join(rootDir, 'storage', 'trading-dashboard.sqlite')
const statePath = join(rootDir, 'src', 'data', 'state.json')
const marketPath = join(rootDir, 'public', 'data', 'market-data-2026-05-14.json')
const port = Number(process.env.API_PORT || 8787)

await mkdir(dirname(dbPath), { recursive: true })
const db = new DatabaseSync(dbPath)

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS scan_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trade_date TEXT NOT NULL,
    source TEXT NOT NULL,
    state_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS candidates (
    symbol TEXT PRIMARY KEY,
    trade_date TEXT NOT NULL,
    exchange TEXT NOT NULL,
    bias TEXT NOT NULL,
    group_name TEXT,
    setup_status TEXT DEFAULT 'premarket',
    candidate_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS bars (
    symbol TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    bar_time INTEGER NOT NULL,
    open REAL NOT NULL,
    high REAL NOT NULL,
    low REAL NOT NULL,
    close REAL NOT NULL,
    volume REAL NOT NULL,
    PRIMARY KEY (symbol, timeframe, bar_time)
  );

  CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    alert_kind TEXT NOT NULL,
    note TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS trades (
    symbol TEXT PRIMARY KEY,
    trade_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS trade_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    event_type TEXT NOT NULL,
    event_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS journal_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trade_date TEXT NOT NULL,
    review_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS imported_movers (
    symbol TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    catalyst_type TEXT NOT NULL,
    day_driver TEXT NOT NULL,
    note TEXT NOT NULL,
    independent_idea_confirmed INTEGER NOT NULL DEFAULT 0,
    imported_at TEXT NOT NULL
  );
`)

try {
  db.exec('ALTER TABLE imported_movers ADD COLUMN independent_idea_confirmed INTEGER NOT NULL DEFAULT 0')
} catch {
  // Column already exists on newer databases.
}

const now = () => new Date().toISOString()
const json = (value) => JSON.stringify(value)

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

function latestSnapshot() {
  return db
    .prepare('SELECT state_json FROM scan_snapshots ORDER BY id DESC LIMIT 1')
    .get()
}

function setMetadata(key, value) {
  db.prepare(
    'INSERT INTO metadata (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
  ).run(key, value, now())
}

function getMetadata(key) {
  return db.prepare('SELECT value FROM metadata WHERE key = ?').get(key)?.value
}

async function seedIfNeeded() {
  const count = db.prepare('SELECT COUNT(*) AS count FROM scan_snapshots').get().count
  if (count) return
  await saveSnapshot(await readJson(statePath), 'seed:src/data/state.json')
  await refreshBarsFromFile()
}

async function saveSnapshot(state, source) {
  const createdAt = now()
  db.prepare(
    'INSERT INTO scan_snapshots (trade_date, source, state_json, created_at) VALUES (?, ?, ?, ?)',
  ).run(state.date || createdAt.slice(0, 10), source, json(state), createdAt)
  db.prepare('DELETE FROM candidates').run()

  const insertCandidate = db.prepare(`
    INSERT INTO candidates (symbol, trade_date, exchange, bias, group_name, setup_status, candidate_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(symbol) DO UPDATE SET
      trade_date = excluded.trade_date,
      exchange = excluded.exchange,
      bias = excluded.bias,
      group_name = excluded.group_name,
      candidate_json = excluded.candidate_json,
      updated_at = excluded.updated_at
  `)

  for (const candidate of state.candidates || []) {
    insertCandidate.run(
      candidate.symbol,
      state.date || createdAt.slice(0, 10),
      candidate.exchange || '',
      candidate.bias || '',
      candidate.group || null,
      candidate.setupStatus || 'premarket',
      json(candidate),
      createdAt,
    )
  }
}

async function refreshBarsFromFile() {
  const market = await readJson(marketPath)
  const updatedAt = now()

  for (const [symbol, bars] of Object.entries(market.symbols || {})) {
    insertBars(db, symbol, '5m', bars)
  }
  for (const [symbol, bars] of Object.entries(market.dailySymbols || {})) {
    insertBars(db, symbol, 'daily', bars)
  }

  setMetadata('marketDataUpdatedAt', updatedAt)
  return { updatedAt, symbols: Object.keys(market.symbols || {}).length }
}

function barsFor(symbol, timeframe) {
  return db
    .prepare(
      'SELECT bar_time AS t, open AS o, high AS h, low AS l, close AS c, volume AS v FROM bars WHERE symbol = ? AND timeframe = ? ORDER BY bar_time',
    )
    .all(symbol, timeframe)
}

function allMarketData() {
  const symbols = {}
  const dailySymbols = {}
  const rows = db.prepare('SELECT DISTINCT symbol FROM bars ORDER BY symbol').all()
  for (const { symbol } of rows) {
    const intraday = barsFor(symbol, '5m')
    const daily = barsFor(symbol, 'daily')
    if (intraday.length) symbols[symbol] = intraday
    if (daily.length) dailySymbols[symbol] = daily
  }
  return { updatedAt: getMetadata('marketDataUpdatedAt') || now(), symbols, dailySymbols }
}

function stateFromDb() {
  const snapshot = latestSnapshot()
  const state = snapshot ? JSON.parse(snapshot.state_json) : null
  if (!state) return null
  const candidates = db.prepare('SELECT candidate_json FROM candidates ORDER BY rowid').all()
  if (candidates.length) {
    state.candidates = candidates.map((row) => JSON.parse(row.candidate_json))
    state.premarketSnapshot = state.candidates
  }
  const trades = db.prepare('SELECT symbol, trade_json FROM trades ORDER BY symbol').all()
  state.tradeManagement = Object.fromEntries(trades.map((row) => [row.symbol, JSON.parse(row.trade_json)]))
  state.lastRefreshAt = getMetadata('marketDataUpdatedAt') || state.lastRefreshAt
  return state
}

function recalculateSetups() {
  const rows = db.prepare('SELECT symbol, candidate_json FROM candidates ORDER BY rowid').all()
  const updateCandidate = db.prepare(`
    UPDATE candidates
    SET setup_status = ?, candidate_json = ?, updated_at = ?
    WHERE symbol = ?
  `)
  db.prepare('DELETE FROM alerts').run()
  const insertAlert = db.prepare('INSERT INTO alerts (symbol, alert_kind, note, created_at) VALUES (?, ?, ?, ?)')
  const updatedAt = now()
  const context = {
    marketDataUpdatedAt: getMetadata('marketDataUpdatedAt'),
    nowIso: updatedAt,
  }
  const statuses = []

  for (const row of rows) {
    const candidate = JSON.parse(row.candidate_json)
    const setupState = evaluateSetup(candidate, barsFor(row.symbol, '5m'), context)
    const updatedCandidate = {
      ...candidate,
      setupStatus: setupState.status,
      setupState,
    }
    updateCandidate.run(setupState.status, json(updatedCandidate), updatedAt, row.symbol)

    const alertKind = alertKindFor(setupState)
    if (alertKind) {
      insertAlert.run(row.symbol, alertKind, setupState.invalidatedReason || setupState.note, updatedAt)
    }
    statuses.push({ symbol: row.symbol, setupState })
  }

  return {
    updatedAt,
    candidatesUpdated: statuses.length,
    alerts: statuses.filter((item) => alertKindFor(item.setupState)).length,
    statuses,
  }
}

async function readBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  if (!chunks.length) return null
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function send(response, status, payload) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type',
  })
  response.end(json(payload))
}

function notFound(response) {
  send(response, 404, { error: 'Not found' })
}

await seedIfNeeded()
recalculateSetups()

const server = createServer(async (request, response) => {
  if (request.method === 'OPTIONS') {
    send(response, 204, {})
    return
  }

  try {
    const url = new URL(request.url || '/', `http://${request.headers.host}`)

    if (request.method === 'GET' && url.pathname === '/api/health') {
      send(response, 200, {
        ok: true,
        dbPath,
        seeded: existsSync(dbPath),
      })
      return
    }

    if (request.method === 'GET' && url.pathname === '/api/state') {
      send(response, 200, stateFromDb() || await readJson(statePath))
      return
    }

    if (request.method === 'GET' && url.pathname === '/api/market/all') {
      send(response, 200, allMarketData())
      return
    }

    const marketMatch = url.pathname.match(/^\/api\/market\/([^/]+)$/)
    if (request.method === 'GET' && marketMatch) {
      const symbol = decodeURIComponent(marketMatch[1]).toUpperCase()
      const timeframe = url.searchParams.get('tf') === 'daily' ? 'daily' : '5m'
      send(response, 200, { symbol, timeframe, bars: barsFor(symbol, timeframe) })
      return
    }

    if (request.method === 'POST' && url.pathname === '/api/refresh/5m') {
      const symbolsParam = url.searchParams.get('symbols')
      const symbols = symbolsParam
        ? symbolsParam.split(',').map((symbol) => symbol.trim().toUpperCase()).filter(Boolean)
        : undefined
      const result = await updateFiveMinuteBars(db, symbols)
      setMetadata('marketDataUpdatedAt', result.updatedAt)
      const recalc = recalculateSetups()
      send(response, 200, { ...result, recalc })
      return
    }

    if (request.method === 'POST' && url.pathname === '/api/refresh/daily') {
      const symbolsParam = url.searchParams.get('symbols')
      const symbols = symbolsParam
        ? symbolsParam.split(',').map((symbol) => symbol.trim().toUpperCase()).filter(Boolean)
        : undefined
      const result = await updateDailyBars(db, symbols)
      setMetadata('marketDataUpdatedAt', result.updatedAt)
      send(response, 200, result)
      return
    }

    if (request.method === 'POST' && url.pathname === '/api/recalculate/setups') {
      send(response, 200, recalculateSetups())
      return
    }

    if (request.method === 'POST' && url.pathname === '/api/scan/premarket') {
      const symbolsParam = url.searchParams.get('symbols')
      const body = await readBody(request)
      const symbols = symbolsParam
        ? symbolsParam.split(',').map((symbol) => symbol.trim().toUpperCase()).filter(Boolean)
        : Array.isArray(body?.symbols)
          ? body.symbols.map((symbol) => String(symbol).trim().toUpperCase()).filter(Boolean)
          : undefined
      const { state, summary } = await buildPremarketScan({ db, rootDir, symbols })
      await saveSnapshot(state, 'backend:premarket-scan')
      setMetadata('marketDataUpdatedAt', state.updatedAt)
      const recalc = recalculateSetups()
      send(response, 200, { ok: true, ...summary, recalc })
      return
    }

    if (request.method === 'POST' && url.pathname === '/api/import/movers') {
      const payload = await readBody(request)
      const movers = parseMoversPayload(payload || {})
      saveImportedMovers(db, movers)
      send(response, 200, {
        ok: true,
        imported: movers.length,
        symbols: movers.map((mover) => mover.symbol),
      })
      return
    }

    if (request.method === 'GET' && url.pathname === '/api/trades') {
      const trades = db.prepare('SELECT trade_json FROM trades ORDER BY symbol').all()
      send(response, 200, trades.map((row) => JSON.parse(row.trade_json)))
      return
    }

    const tradeMatch = url.pathname.match(/^\/api\/trades\/([^/]+)$/)
    if (tradeMatch) {
      const symbol = decodeURIComponent(tradeMatch[1]).toUpperCase()
      if (request.method === 'PUT') {
        const trade = await readBody(request)
        const updatedAt = now()
        db.prepare(
          'INSERT INTO trades (symbol, trade_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(symbol) DO UPDATE SET trade_json = excluded.trade_json, updated_at = excluded.updated_at',
        ).run(symbol, json({ ...trade, symbol }), updatedAt)
        db.prepare('INSERT INTO trade_events (symbol, event_type, event_json, created_at) VALUES (?, ?, ?, ?)').run(
          symbol,
          'upsert',
          json(trade),
          updatedAt,
        )
        send(response, 200, { ok: true, trade: { ...trade, symbol } })
        return
      }
      if (request.method === 'DELETE') {
        db.prepare('DELETE FROM trades WHERE symbol = ?').run(symbol)
        db.prepare('INSERT INTO trade_events (symbol, event_type, event_json, created_at) VALUES (?, ?, ?, ?)').run(
          symbol,
          'delete',
          '{}',
          now(),
        )
        send(response, 200, { ok: true })
        return
      }
    }

    notFound(response)
  } catch (error) {
    send(response, 500, { error: error instanceof Error ? error.message : 'Unknown server error' })
  }
})

server.listen(port, '127.0.0.1', () => {
  console.log(`Trading dashboard API listening on http://127.0.0.1:${port}`)
})
