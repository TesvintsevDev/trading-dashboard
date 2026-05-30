import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { buildPremarketScan } from './lib/premarket-scan.mjs'

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)))
const dbPath = join(rootDir, 'storage', 'trading-dashboard.sqlite')
await mkdir(dirname(dbPath), { recursive: true })

const db = new DatabaseSync(dbPath)
db.exec(`
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
    imported_at TEXT NOT NULL
  );
`)

function saveSnapshot(state) {
  const createdAt = new Date().toISOString()
  db.prepare(
    'INSERT INTO scan_snapshots (trade_date, source, state_json, created_at) VALUES (?, ?, ?, ?)',
  ).run(state.date || createdAt.slice(0, 10), 'cli:premarket-scan', JSON.stringify(state), createdAt)
  db.prepare('DELETE FROM candidates').run()
  const insertCandidate = db.prepare(`
    INSERT INTO candidates (symbol, trade_date, exchange, bias, group_name, setup_status, candidate_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  for (const candidate of state.candidates || []) {
    insertCandidate.run(
      candidate.symbol,
      state.date || createdAt.slice(0, 10),
      candidate.exchange || '',
      candidate.bias || '',
      candidate.group || null,
      candidate.setupStatus || 'premarket',
      JSON.stringify(candidate),
      createdAt,
    )
  }
  db.prepare(
    'INSERT INTO metadata (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
  ).run('marketDataUpdatedAt', state.updatedAt || createdAt, createdAt)
}

const symbols = process.argv.slice(2).map((symbol) => symbol.trim().toUpperCase()).filter(Boolean)
const { state, summary } = await buildPremarketScan({ db, rootDir, symbols })
saveSnapshot(state)

console.log(JSON.stringify(summary, null, 2))
