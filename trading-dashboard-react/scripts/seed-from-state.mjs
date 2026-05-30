import { readFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)))
const dbPath = join(rootDir, 'storage', 'trading-dashboard.sqlite')
const statePath = join(rootDir, 'src', 'data', 'state.json')
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
`)

const state = JSON.parse(await readFile(statePath, 'utf8'))
const createdAt = new Date().toISOString()
db.prepare('INSERT INTO scan_snapshots (trade_date, source, state_json, created_at) VALUES (?, ?, ?, ?)').run(
  state.date || createdAt.slice(0, 10),
  'cli:seed-from-state',
  JSON.stringify(state),
  createdAt,
)
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

console.log(JSON.stringify({ ok: true, candidates: state.candidates?.length || 0, createdAt }, null, 2))
