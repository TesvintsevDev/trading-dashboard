import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { candidateSymbols, updateFiveMinuteBars } from './lib/yahoo-market-data.mjs'

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)))
const dbPath = join(rootDir, 'storage', 'trading-dashboard.sqlite')
await mkdir(dirname(dbPath), { recursive: true })

const db = new DatabaseSync(dbPath)
const cliSymbols = process.argv.slice(2).map((symbol) => symbol.trim().toUpperCase()).filter(Boolean)
const symbols = cliSymbols.length ? cliSymbols : candidateSymbols(db)
const result = await updateFiveMinuteBars(db, symbols)

console.log(JSON.stringify(result, null, 2))
