function normalizeSymbol(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z.-]/g, '')
}

export function parseMoversPayload(payload = {}) {
  const importedAt = new Date().toISOString()
  const source = payload.source || 'manual'
  const rows = []

  if (Array.isArray(payload.movers)) {
    for (const mover of payload.movers) {
      const symbol = normalizeSymbol(mover.symbol)
      if (!symbol) continue
      rows.push({
        symbol,
        source: mover.source || source,
        catalystType: mover.catalystType || 'manual',
        dayDriver: mover.dayDriver || '',
        note: mover.note || '',
        independentIdeaConfirmed: Boolean(mover.independentIdeaConfirmed),
        importedAt,
      })
    }
  }

  if (Array.isArray(payload.symbols)) {
    for (const rawSymbol of payload.symbols) {
      const symbol = normalizeSymbol(rawSymbol)
      if (!symbol) continue
      rows.push({
        symbol,
        source,
        catalystType: payload.catalystType || 'manual',
        dayDriver: payload.dayDriver || '',
        note: payload.note || '',
        independentIdeaConfirmed: Boolean(payload.independentIdeaConfirmed),
        importedAt,
      })
    }
  }

  if (typeof payload.text === 'string') {
    for (const rawSymbol of payload.text.split(/[\s,;]+/)) {
      const symbol = normalizeSymbol(rawSymbol)
      if (!symbol) continue
      rows.push({
        symbol,
        source,
        catalystType: payload.catalystType || 'manual',
        dayDriver: payload.dayDriver || '',
        note: payload.note || '',
        independentIdeaConfirmed: Boolean(payload.independentIdeaConfirmed),
        importedAt,
      })
    }
  }

  const unique = new Map()
  for (const row of rows) unique.set(row.symbol, row)
  return [...unique.values()]
}

export function saveImportedMovers(db, movers) {
  const insert = db.prepare(`
    INSERT INTO imported_movers (symbol, source, catalyst_type, day_driver, note, independent_idea_confirmed, imported_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(symbol) DO UPDATE SET
      source = excluded.source,
      catalyst_type = excluded.catalyst_type,
      day_driver = excluded.day_driver,
      note = excluded.note,
      independent_idea_confirmed = excluded.independent_idea_confirmed,
      imported_at = excluded.imported_at
  `)

  for (const mover of movers) {
    insert.run(
      mover.symbol,
      mover.source,
      mover.catalystType,
      mover.dayDriver,
      mover.note,
      mover.independentIdeaConfirmed ? 1 : 0,
      mover.importedAt,
    )
  }
}

export function importedMoverMap(db, symbols) {
  if (!symbols.length) return new Map()
  const placeholders = symbols.map(() => '?').join(',')
  const rows = db
    .prepare(
      `SELECT symbol, source, catalyst_type AS catalystType, day_driver AS dayDriver, note, independent_idea_confirmed AS independentIdeaConfirmed, imported_at AS importedAt FROM imported_movers WHERE symbol IN (${placeholders})`,
    )
    .all(...symbols)
  return new Map(rows.map((row) => [row.symbol, { ...row, independentIdeaConfirmed: Boolean(row.independentIdeaConfirmed) }]))
}
