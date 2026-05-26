import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import stateJson from './data/state.json'
import { biasClass, parseNumber, toCandidateView } from './domain/filters'
import {
  alertQualification,
  attentionClass,
  hasPostOpenProgress,
  isPostOpenPriority,
  primaryAction,
  stageLabel,
} from './domain/structure'
import type { AlertCandidate, Bar, Candidate, CandidateView, DashboardState, MarketData, Trade } from './domain/types'
import {
  EMPTY_MARKET_DATA,
  deleteApiTrade,
  loadApiMarketData,
  loadApiState,
  loadMarketData,
  importApiMovers,
  refreshApiFiveMinuteData,
  runApiPremarketScan,
  saveApiTrade,
} from './services/marketData'
import { buildTradeUpdate } from './services/trades'
import { tradingViewSymbol } from './services/tradingView'
import './App.css'

type ViewMode = 'live' | 'premarket' | 'postopen' | 'trades'
type DetailTab = 'Plan' | 'Trade' | 'Context'
type ChartMode = '5m' | 'Daily' | 'Weekly'

type GerchikLevel = {
  price: number
  score: number
  label: string
  types: Set<string>
  touches: number
}

const STORAGE_KEY = 'trading-dashboard.tradeManagement'

const initialState = stateJson as DashboardState

function initialTradeManagement(state: DashboardState) {
  const fromList = Object.fromEntries(
    (state.activeTrades || [])
      .filter((trade) => trade.symbol)
      .map((trade) => [trade.symbol as string, trade]),
  )
  return { ...fromList, ...(state.tradeManagement || {}) }
}

function money(value?: number) {
  if (value === undefined || Number.isNaN(value)) return 'н/д'
  return `$${value.toFixed(2)}`
}

function signedMoney(value?: number) {
  if (value === undefined || Number.isNaN(value)) return 'н/д'
  return `${value < 0 ? '-' : ''}$${Math.abs(value).toFixed(2)}`
}

function tradeEntry(trade: Trade) {
  return trade.entry ?? trade.entryPrice
}

function tradeStop(trade: Trade) {
  return trade.currentStop ?? trade.initialStop ?? trade.stopPrice
}

function tradeSize(trade: Trade) {
  return trade.size ?? trade.quantity
}

function tradeDirection(trade: Trade, candidate?: CandidateView) {
  if (trade.side === 'short' || trade.side === 'long') return trade.side
  return candidate?.setupState.direction || 'long'
}

function tradeRisk(trade: Trade, candidate?: CandidateView) {
  const entry = tradeEntry(trade)
  const stop = tradeStop(trade)
  const size = tradeSize(trade)
  if (entry === undefined || stop === undefined || size === undefined) return undefined
  const direction = tradeDirection(trade, candidate)
  const riskPerShare = direction === 'short' ? stop - entry : entry - stop
  return riskPerShare * Math.abs(size)
}

function isOpenTrade(trade?: Trade) {
  if (!trade) return false
  return trade.status !== 'stopped' && trade.status !== 'closed'
}

function tradeStageLabel(trade?: Trade) {
  return isOpenTrade(trade) ? 'ACTIVE' : undefined
}

function tradePrimaryAction(trade?: Trade) {
  if (!trade || !isOpenTrade(trade)) return undefined
  return `Сделка открыта: hold до stop ${money(tradeStop(trade))}`
}

function freshnessText(value?: string) {
  if (!value) return 'Данные не обновлялись'
  const date = new Date(value)
  const age = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000))
  return `Updated ${date.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  })} (${age}m)`
}

function groupTitle(group: string) {
  return (
    {
      core: 'Core Candidates',
      exception: 'Watch / Exceptions',
      postopenPriority: 'Post-open Priority',
      live: 'Live Board',
      premarket: 'Premarket Snapshot',
      postopen: 'Post-open Check',
      trades: 'Active Trades',
    }[group] || group
  )
}

function groupBy<T>(items: T[], getKey: (item: T) => string) {
  return items.reduce<Record<string, T[]>>((groups, item) => {
    const key = getKey(item)
    groups[key] = groups[key] || []
    groups[key].push(item)
    return groups
  }, {})
}

function App() {
  const [state, setState] = useState(initialState)
  const [marketData, setMarketData] = useState<MarketData>(EMPTY_MARKET_DATA)
  const [marketDataError, setMarketDataError] = useState('')
  const [dataSource, setDataSource] = useState<'api' | 'static'>('static')
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isScanning, setIsScanning] = useState(false)
  const [isImportOpen, setIsImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [importCatalyst, setImportCatalyst] = useState('manual')
  const [importDayDriver, setImportDayDriver] = useState('')
  const [importNote, setImportNote] = useState('')
  const [importIndependentIdea, setImportIndependentIdea] = useState(false)
  const [tradeManagement, setTradeManagement] = useState<Record<string, Trade>>(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY)
      return saved ? JSON.parse(saved) : initialTradeManagement(initialState)
    } catch {
      return initialTradeManagement(initialState)
    }
  })
  const [mode, setMode] = useState<ViewMode>('live')
  const [compactSidebar, setCompactSidebar] = useState(true)
  const [showInvalidated, setShowInvalidated] = useState(false)
  const [detailTab, setDetailTab] = useState<DetailTab>('Plan')
  const [chartMode, setChartMode] = useState<ChartMode>('5m')
  const [selectedSymbol, setSelectedSymbol] = useState(
    initialState.defaultSymbol || initialState.candidates[0]?.symbol,
  )

  const refreshMarketData = async () => {
    setIsRefreshing(true)
    setMarketDataError('')
    try {
      if (dataSource === 'api') {
        const nextMarketData = await refreshApiFiveMinuteData()
        const nextState = await loadApiState()
        setState(nextState)
        setTradeManagement(initialTradeManagement(nextState))
        setMarketData(nextMarketData)
      } else {
        setMarketData(await loadMarketData())
      }
    } catch (error) {
      setMarketDataError(error instanceof Error ? error.message : 'Market data refresh failed')
    } finally {
      setIsRefreshing(false)
    }
  }

  const runPremarketScan = async (symbols?: string[]) => {
    if (dataSource !== 'api') return
    setIsScanning(true)
    setMarketDataError('')
    try {
      await runApiPremarketScan(symbols)
      const [nextState, nextMarketData] = await Promise.all([loadApiState(), loadApiMarketData()])
      setState(nextState)
      setTradeManagement(initialTradeManagement(nextState))
      setMarketData(nextMarketData)
    } catch (error) {
      setMarketDataError(error instanceof Error ? error.message : 'Premarket scan failed')
    } finally {
      setIsScanning(false)
    }
  }

  const importMovers = async () => {
    if (dataSource !== 'api' || !importText.trim()) return
    setMarketDataError('')
    try {
      const imported = await importApiMovers({
        source: 'manual',
        text: importText,
        catalystType: importCatalyst,
        dayDriver: importDayDriver,
        note: importNote,
        independentIdeaConfirmed: importIndependentIdea,
      })
      setIsImportOpen(false)
      setImportText('')
      setImportDayDriver('')
      setImportNote('')
      setImportIndependentIdea(false)
      await runPremarketScan(imported.symbols)
    } catch (error) {
      setMarketDataError(error instanceof Error ? error.message : 'Mover import failed')
    }
  }

  useEffect(() => {
    let cancelled = false
    Promise.all([loadApiState(), loadApiMarketData()])
      .then(([apiState, apiMarketData]) => {
        if (!cancelled) {
          setState(apiState)
          setTradeManagement(initialTradeManagement(apiState))
          setMarketData(apiMarketData)
          setDataSource('api')
        }
      })
      .catch(() => loadMarketData())
      .then((staticMarketData) => {
        if (!cancelled && staticMarketData) {
          setMarketData(staticMarketData)
          setDataSource('static')
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setMarketDataError(error instanceof Error ? error.message : 'Market data refresh failed')
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tradeManagement))
  }, [tradeManagement])

  const candidates = useMemo(
    () =>
      state.candidates.map((candidate) => toCandidateView(candidate, candidate.setupState)),
    [state.candidates],
  )
  const premarketSource = state.premarketSnapshot?.length ? state.premarketSnapshot : state.candidates
  const premarketSnapshot = useMemo(
    () =>
      premarketSource.map((candidate) => toCandidateView(candidate, candidate.setupState)),
    [premarketSource],
  )
  const didSetInitialTab = useRef(false)

  const selectedCandidate =
    candidates.find((candidate) => candidate.symbol === selectedSymbol) || candidates[0] || null

  const candidatesForMode = useMemo(() => {
    if (mode === 'premarket') return premarketSnapshot
    if (mode === 'postopen') {
      return candidates.filter(hasPostOpenProgress)
    }
    if (mode === 'trades') {
      const active = new Set(
        Object.entries(tradeManagement)
          .filter(([, trade]) => isOpenTrade(trade))
          .map(([symbol]) => symbol),
      )
      return candidates.filter((candidate) => active.has(candidate.symbol))
    }
    return candidates
  }, [candidates, mode, premarketSnapshot, tradeManagement])

  const groupedCandidates = useMemo(() => {
    if (mode === 'live') {
      const postOpen = candidatesForMode.filter(isPostOpenPriority)
      const rest = candidatesForMode.filter((candidate) => !isPostOpenPriority(candidate))
      return {
        ...(postOpen.length ? { postopenPriority: postOpen } : {}),
        ...groupBy(rest, (candidate) => candidate.effectiveGroup),
      }
    }
    return { [mode]: candidatesForMode }
  }, [candidatesForMode, mode])

  const visibleGroupedCandidates = useMemo(() => {
    if (mode === 'trades') return groupedCandidates
    if (showInvalidated) return groupedCandidates
    const next: Record<string, CandidateView[]> = {}
    for (const [group, items] of Object.entries(groupedCandidates)) {
      const visible = items.filter((candidate) => candidate.setupState.status !== 'invalidated')
      if (visible.length) next[group] = visible
    }
    return next
  }, [groupedCandidates, mode, showInvalidated])
  const invalidatedCount = useMemo(
    () => candidatesForMode.filter((candidate) => candidate.setupState.status === 'invalidated').length,
    [candidatesForMode],
  )

  const qualified = useMemo(
    () =>
      candidates
        .filter((candidate) => !isOpenTrade(tradeManagement[candidate.symbol]))
        .map((candidate) => alertQualification(candidate))
        .filter((candidate): candidate is AlertCandidate => Boolean(candidate)),
    [candidates, tradeManagement],
  )
  const freshnessAt = marketData.updatedAt || state.lastRefreshAt
  const activeTrade = selectedCandidate ? tradeManagement[selectedCandidate.symbol] : undefined
  const tradeRows = useMemo(
    () =>
      Object.values(tradeManagement)
        .filter((trade) => trade.symbol)
        .filter(isOpenTrade)
        .map((trade) => ({
          trade,
          candidate: candidates.find((candidate) => candidate.symbol === trade.symbol),
        }))
        .sort((a, b) => String(a.trade.symbol).localeCompare(String(b.trade.symbol))),
    [candidates, tradeManagement],
  )

  const selectCandidate = useCallback((symbol: string, forceTradeTab = false) => {
    setSelectedSymbol(symbol)
    if (forceTradeTab || tradeManagement[symbol]) setDetailTab('Trade')
  }, [tradeManagement])

  useEffect(() => {
    if (!didSetInitialTab.current && activeTrade) {
      setDetailTab('Trade')
      didSetInitialTab.current = true
    }
  }, [activeTrade])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select')) return

      const key = event.key.toLowerCase()
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        if (!candidatesForMode.length) return
        const currentIndex = candidatesForMode.findIndex(
          (candidate) => candidate.symbol === selectedCandidate?.symbol,
        )
        const fallbackIndex = currentIndex === -1 ? 0 : currentIndex
        const direction = event.key === 'ArrowDown' ? 1 : -1
        const nextIndex = (fallbackIndex + direction + candidatesForMode.length) % candidatesForMode.length
        const next = candidatesForMode[nextIndex]
        if (next) selectCandidate(next.symbol)
      }
      if (key === 'p') setDetailTab('Plan')
      if (key === 't' || key === 'm') setDetailTab('Trade')
      if (key === 'c') setDetailTab('Context')
      if (key === '5') setChartMode('5m')
      if (key === 'd') setChartMode('Daily')
      if (key === 'w') setChartMode('Weekly')
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [candidatesForMode, selectCandidate, selectedCandidate?.symbol])

  if (!selectedCandidate) {
    return (
      <div className="shell empty-state">
        <main className="main">
          <header className="header">
            <div>
              <div className="eyebrow">Premarket Scan</div>
              <h2>Watchlist пуст</h2>
              <p>
                API вернул 0 кандидатов. Вероятно, premarket scan упал (Yahoo fetch failed) и затёр SQLite.
                В терминале: npm run seed:state
              </p>
              {marketDataError && <p className="freshness bad">{marketDataError}</p>}
            </div>
          </header>
        </main>
      </div>
    )
  }

  return (
    <div className="shell">
      <aside className={`sidebar ${compactSidebar ? 'compact' : ''}`}>
        <section className="brand">
          <div className="eyebrow">Premarket Scan</div>
          <h1>{state.pageTitle}</h1>
          <p>Internet scan: TipRanks/Benzinga + Yahoo OHLCV.</p>
          <div className="system-filters" aria-label="System filters">
            <span>$10-$150</span>
            <span>ATR $1-$3.5</span>
            <span>Vol 700k+</span>
            <span>5m base only</span>
          </div>
        </section>

        <nav className="mode-tabs" aria-label="Watchlist mode">
          {[
            ['live', 'Live'],
            ['premarket', 'Premarket'],
            ['postopen', 'Post-open'],
            ['trades', 'Trades'],
          ].map(([key, label]) => (
            <button
              className={mode === key ? 'active' : ''}
              key={key}
              type="button"
              onClick={() => setMode(key as ViewMode)}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="sidebar-controls">
          <button type="button" onClick={() => setCompactSidebar((value) => !value)}>
            Density: {compactSidebar ? 'Compact' : 'Comfort'}
          </button>
          <button
            type="button"
            disabled={!invalidatedCount}
            onClick={() => setShowInvalidated((value) => !value)}
          >
            {showInvalidated ? 'Hide' : 'Show'} invalidated{invalidatedCount ? ` (${invalidatedCount})` : ''}
          </button>
        </div>

        <section className="watchlist">
          {Object.entries(visibleGroupedCandidates).map(([group, candidates]) => (
            <div className={group === 'postopenPriority' ? 'priority-group' : ''} key={group}>
              <div className="section-title">{groupTitle(group)}</div>
              {candidates.map((candidate) => (
                <CandidateCard
                  candidate={candidate}
                  isActive={candidate.symbol === selectedCandidate.symbol}
                  key={candidate.symbol}
                  onSelect={() => selectCandidate(candidate.symbol)}
                  trade={tradeManagement[candidate.symbol]}
                />
              ))}
            </div>
          ))}
        </section>
      </aside>

      <main className="main">
        <AlertStrip
          candidates={qualified}
          onSelect={(symbol) => {
            selectCandidate(symbol, true)
          }}
        />

        <header className="header">
          <div>
            <div className="eyebrow">Interactive Plan</div>
            <h2>
              {selectedCandidate.symbol} - {selectedCandidate.bias}
            </h2>
            <p>{selectedCandidate.exchange}:{selectedCandidate.symbol} · {stageLabel(selectedCandidate)}</p>
          </div>
          <div className="toolbar">
            <span className={`freshness ${marketDataError ? 'bad' : ''}`}>
              {marketDataError || `${dataSource.toUpperCase()} · ${freshnessText(freshnessAt)}`}
            </span>
            <button className="refresh" type="button" disabled={isRefreshing} onClick={() => void refreshMarketData()}>
              {isRefreshing ? 'Обновляю 5m...' : dataSource === 'api' ? 'Update 5m' : 'Reload JSON'}
            </button>
            {dataSource === 'api' && (
              <>
                <button className="refresh" type="button" onClick={() => setIsImportOpen(true)}>
                  Import movers
                </button>
                <button className="refresh" type="button" disabled={isScanning} onClick={() => void runPremarketScan()}>
                  {isScanning ? 'Scanning...' : 'Premarket scan'}
                </button>
              </>
            )}
          </div>
        </header>

        {mode === 'trades' && (
          <TradesBoard
            rows={tradeRows}
            selectedSymbol={selectedCandidate.symbol}
            onSelect={(symbol) => selectCandidate(symbol, true)}
          />
        )}

        <section className="content">
          <section className="left-panel">
            <nav className="detail-tabs" aria-label="Details">
              {(['Plan', 'Trade', 'Context'] as DetailTab[]).map((tab) => (
                <button
                  className={detailTab === tab ? 'active' : ''}
                  key={tab}
                  type="button"
                  onClick={() => setDetailTab(tab)}
                >
                  {tab}
                </button>
              ))}
            </nav>
            <div className="panel">
              {detailTab === 'Plan' && <PlanPanel candidate={selectedCandidate} />}
              {detailTab === 'Trade' && (
                <TradePanel
                  candidate={selectedCandidate}
                  key={selectedCandidate.symbol}
                  trade={activeTrade}
                  onSave={(trade) =>
                    setTradeManagement((current) => {
                      void saveApiTrade(trade).catch(() => undefined)
                      return {
                        ...current,
                        [selectedCandidate.symbol]: trade,
                      }
                    })
                  }
                  onClear={() =>
                    setTradeManagement((current) => {
                      const next = { ...current }
                      delete next[selectedCandidate.symbol]
                      void deleteApiTrade(selectedCandidate.symbol).catch(() => undefined)
                      return next
                    })
                  }
                />
              )}
              {detailTab === 'Context' && <ContextPanel candidate={selectedCandidate} />}
            </div>
          </section>

          <ChartPanel
            candidate={selectedCandidate}
            bars={marketData.symbols[selectedCandidate.symbol] || []}
            dailyBars={marketData.dailySymbols?.[selectedCandidate.symbol] || []}
            chartMode={chartMode}
            setChartMode={setChartMode}
            trade={activeTrade}
          />
        </section>
      </main>
      {isImportOpen && (
        <div className="modal-backdrop" role="presentation" onClick={() => setIsImportOpen(false)}>
          <section className="import-modal" role="dialog" aria-label="Import movers" onClick={(event) => event.stopPropagation()}>
            <h3>Import movers</h3>
            <label>
              Catalyst
              <select value={importCatalyst} onChange={(event) => setImportCatalyst(event.target.value)}>
                <option value="manual">manual</option>
                <option value="news">news</option>
                <option value="earnings">earnings</option>
                <option value="gap">gap</option>
              </select>
            </label>
            <label>
              Symbols
              <textarea
                placeholder="POET RDW DOCS"
                value={importText}
                onChange={(event) => setImportText(event.target.value)}
              />
            </label>
            <label>
              Что двигает сегодня
              <textarea
                placeholder="Earnings beat / FDA news / sector move / gap after guidance"
                value={importDayDriver}
                onChange={(event) => setImportDayDriver(event.target.value)}
              />
            </label>
            <label>
              Note / source
              <textarea
                placeholder="Коротко: источник, уровень, что проверить после открытия"
                value={importNote}
                onChange={(event) => setImportNote(event.target.value)}
              />
            </label>
            <label className="checkbox-row">
              <input
                checked={importIndependentIdea}
                onChange={(event) => setImportIndependentIdea(event.target.checked)}
                type="checkbox"
              />
              Есть своя идея, не просто повтор SPY/QQQ
            </label>
            <div className="modal-actions">
              <button type="button" onClick={() => setIsImportOpen(false)}>
                Cancel
              </button>
              <button type="button" onClick={() => void importMovers()}>
                Import + scan
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

function CandidateCard({
  candidate,
  isActive,
  onSelect,
  trade,
}: {
  candidate: CandidateView
  isActive: boolean
  onSelect: () => void
  trade?: Trade
}) {
  const rr = candidate.rr ? Number(candidate.rr) : null
  const rrClass = rr ? (rr < 1.5 ? 'low' : rr < 2 ? 'mid' : '') : ''
  const openTrade = isOpenTrade(trade)
  const attention = openTrade ? 'active-trade' : attentionClass(candidate)
  const blockingFlags = candidate.validationFlags.filter((flag) => flag.severity === 'hard')
  const warnFlags = candidate.validationFlags.filter(
    (flag) => flag.severity !== 'hard' && flag.label !== 'SPREAD UNKNOWN',
  )
  const primaryWarning =
    attention === 'blocked'
      ? candidate.setupState.entryChecklist.find((item) => item.status !== 'pass')?.label
      : undefined

  return (
    <button className={`ticker-card ${biasClass(candidate.bias)} ${attention} ${isActive ? 'active' : ''}`} type="button" onClick={onSelect}>
      <div className="ticker-top">
        <span className="symbol">{candidate.symbol}</span>
        <span className={`badge ${biasClass(candidate.bias)}`}>{candidate.bias}</span>
        <span className={`attention-pill ${attention}`}>{tradeStageLabel(trade) || stageLabel(candidate)}</span>
      </div>
      <div className="ticker-meta">
        {rr && <span className={`rr ${rrClass}`}>{rr.toFixed(1)}R</span>}
        <span>
          {candidate.price} · ATR {candidate.atr} · Vol {candidate.avgVolume}
        </span>
      </div>
      <div className="level-row">
        <span>Trig {money(candidate.planLevels?.triggerPrice)}</span>
        <span>Stop {money(candidate.planLevels?.stopPrice)}</span>
        <span>T1 {money(candidate.planLevels?.target1Price)}</span>
      </div>
      <div className="ticker-status">{tradePrimaryAction(trade) || primaryAction(candidate)}</div>
      {!openTrade && primaryWarning && <div className="primary-warning">{primaryWarning}</div>}
      {!!blockingFlags.length && (
        <div className="ticker-flags">
          {blockingFlags.map((flag) => (
            <span className="mini-warn hard" key={flag.label}>
              {flag.label}
            </span>
          ))}
        </div>
      )}
      {!blockingFlags.length && !!warnFlags.length && (
        <div className="ticker-flags compact">
          {warnFlags.slice(0, 2).map((flag) => (
            <span className="mini-warn" key={flag.label}>
              {flag.label}
            </span>
          ))}
        </div>
      )}
    </button>
  )
}

function AlertStrip({
  candidates,
  onSelect,
}: {
  candidates: AlertCandidate[]
  onSelect: (symbol: string) => void
}) {
  const groups = {
    now: candidates.filter((candidate) => candidate.alertKind === 'now'),
    near: candidates.filter((candidate) => candidate.alertKind === 'near'),
    blocked: candidates.filter((candidate) => candidate.alertKind === 'blocked'),
    monitoring: candidates.filter((candidate) => candidate.alertKind === 'monitoring'),
    invalidated: candidates.filter((candidate) => candidate.alertKind === 'invalidated'),
  }

  return (
    <section className="alert-strip">
      <div className="alert-label">Alerts</div>
      <div className="alert-items">
        {candidates.length ? (
          ([
            ['now', 'Now', groups.now],
            ['near', 'Near trigger', groups.near],
            ['blocked', 'Blocked', groups.blocked],
            ['monitoring', 'Monitoring', groups.monitoring],
            ['invalidated', 'Invalidated', groups.invalidated],
          ] as const).map(([kind, label, items]) => (
            <div className={`alert-group ${kind}`} key={kind}>
              <span>{label}</span>
              {items.length ? (
                items.slice(0, 4).map((candidate) => (
                  <button
                    className={`alert-pill ${biasClass(candidate.bias)}`}
                    key={candidate.symbol}
                    type="button"
                    onClick={() => onSelect(candidate.symbol)}
                  >
                    <strong>{candidate.symbol}</strong>
                    <small>{candidate.alertKind === 'blocked' ? candidate.alertNote.split(',')[0] : candidate.alertNote}</small>
                  </button>
                ))
              ) : (
                <em>none</em>
              )}
            </div>
          ))
        ) : (
          <span className="alert-empty">Нет активных post-open сетапов.</span>
        )}
      </div>
    </section>
  )
}

function PlanPanel({ candidate }: { candidate: CandidateView }) {
  const showChecklist =
    candidate.setupState.status === 'trigger_active' ||
    candidate.setupState.status === 'base_forming' ||
    candidate.setupState.entryChecklist.some((item) => item.status !== 'pass')

  return (
    <>
      <h3>{candidate.symbol} план</h3>
      {!!candidate.validationFlags.length && (
        <div className="validation-strip">
          {candidate.validationFlags.map((flag) => (
            <span className={flag.severity === 'hard' ? 'hard' : ''} key={flag.label}>
              {flag.label}
            </span>
          ))}
        </div>
      )}
      <div className="decision-grid">
        <TextBlock className="decision trigger" label="Trigger zone" value={candidate.trigger} />
        <TextBlock className="decision invalidation" label="Invalidation" value={candidate.invalidation} />
        <TextBlock className="decision target" label="Targets" value={candidate.targets} />
      </div>
      <div className="grid-2">
        <Fact label="Setup status" value={candidate.setupState.status.replaceAll('_', ' ')} />
        <Fact label="Plan R:R" value={candidate.rr ? `${candidate.rr.toFixed(2)}R` : 'н/д'} />
        <Fact label="Цена / ATR" value={`${candidate.price} / ATR ${candidate.atr}`} />
        <Fact label="Avg Volume / Spread" value={`${candidate.avgVolume} / ${candidate.spread || 'н/д'}`} />
      </div>
      {!!candidate.setupState.entryChecklist.length && showChecklist && (
        <div className="checklist">
          {candidate.setupState.entryChecklist.map((item) => (
            <div className={`check ${item.status}`} key={item.key}>
              <span>{item.label}</span>
              <strong>{item.status}</strong>
              {item.detail && <small>{item.detail}</small>}
            </div>
          ))}
        </div>
      )}
      <TextBlock label="Post-open status" value={candidate.setupState.note || candidate.status} />
      <TextBlock label="Score reason / filters" value={candidate.scoreReason} />
      <TextBlock label="Почему в игре" value={candidate.why} />
    </>
  )
}

function TradePanel({
  candidate,
  trade,
  onSave,
  onClear,
}: {
  candidate: CandidateView
  trade?: Trade
  onSave: (trade: Trade) => void
  onClear: () => void
}) {
  const [entry, setEntry] = useState(trade?.entry?.toString() || '')
  const [stop, setStop] = useState((trade?.currentStop ?? trade?.initialStop)?.toString() || '')
  const [target, setTarget] = useState(trade?.target?.toString() || '')
  const [size, setSize] = useState(trade?.size?.toString() || '')
  const [guidance, setGuidance] = useState(trade?.guidance || '')

  const parsedEntry = parseNumber(entry)
  const parsedStop = parseNumber(stop)
  const parsedTarget = parseNumber(target)
  const liveRR =
    parsedEntry && parsedStop && parsedTarget && parsedEntry !== parsedStop
      ? Math.abs((parsedTarget - parsedEntry) / (parsedEntry - parsedStop))
      : null

  const saveTrade = () => {
    onSave(buildTradeUpdate(candidate, trade, { entry, stop, target, size, guidance }))
  }

  if (!trade) {
    return (
      <>
        <h3>{candidate.symbol} trade</h3>
        <TextBlock label="Status" value="No active trade - wait for trigger." />
        <TextBlock label="Setup filter" value={candidate.riskContext} />
        <TradeForm
          entry={entry}
          stop={stop}
          target={target}
          size={size}
          guidance={guidance}
          liveRR={liveRR}
          setEntry={setEntry}
          setGuidance={setGuidance}
          setSize={setSize}
          setStop={setStop}
          setTarget={setTarget}
          onSave={saveTrade}
          onClear={onClear}
        />
      </>
    )
  }

  const rr =
    trade.entry && trade.currentStop && trade.target
      ? Math.abs((trade.target - trade.entry) / (trade.entry - trade.currentStop))
      : null

  return (
    <>
      <h3>{candidate.symbol} trade</h3>
      <div className="grid-2">
        <Fact label="Entry" value={money(trade.entry)} />
        <Fact label="Size" value={String(trade.size || 'н/д')} />
        <Fact label="Stop" value={money(trade.currentStop)} />
        <Fact label="Target / R:R" value={`${money(trade.target)}${rr ? ` / ${rr.toFixed(1)}R` : ''}`} />
      </div>
      <TextBlock label="Guidance" value={trade.guidance || candidate.riskContext} />
      {!!trade.stopEvents?.length && (
        <TextBlock
          className={trade.stopEvents.at(-1)?.allowed === false ? 'invalidation' : ''}
          label="Last stop event"
          value={trade.stopEvents.at(-1)?.reason}
        />
      )}
      <TradeForm
        entry={entry}
        stop={stop}
        target={target}
        size={size}
        guidance={guidance}
        liveRR={liveRR}
        setEntry={setEntry}
        setGuidance={setGuidance}
        setSize={setSize}
        setStop={setStop}
        setTarget={setTarget}
        onSave={saveTrade}
        onClear={onClear}
      />
    </>
  )
}

function TradeForm({
  entry,
  stop,
  target,
  size,
  guidance,
  liveRR,
  setEntry,
  setGuidance,
  setSize,
  setStop,
  setTarget,
  onSave,
  onClear,
}: {
  entry: string
  stop: string
  target: string
  size: string
  guidance: string
  liveRR: number | null
  setEntry: (value: string) => void
  setGuidance: (value: string) => void
  setSize: (value: string) => void
  setStop: (value: string) => void
  setTarget: (value: string) => void
  onSave: () => void
  onClear: () => void
}) {
  return (
    <div className="trade-form">
      <div className="grid-2">
        <label>
          Entry
          <input value={entry} onChange={(event) => setEntry(event.target.value)} placeholder="11.21" />
        </label>
        <label>
          Stop
          <input value={stop} onChange={(event) => setStop(event.target.value)} placeholder="10.79" />
        </label>
        <label>
          Target
          <input value={target} onChange={(event) => setTarget(event.target.value)} placeholder="12.50" />
        </label>
        <label>
          Size
          <input value={size} onChange={(event) => setSize(event.target.value)} placeholder="10" />
        </label>
      </div>
      <label>
        Guidance
        <textarea value={guidance} onChange={(event) => setGuidance(event.target.value)} />
      </label>
      <div className="trade-actions">
        <span className={liveRR !== null && liveRR < 1.5 ? 'bad' : ''}>
          Live R:R {liveRR ? `${liveRR.toFixed(2)}R` : 'н/д'}
        </span>
        <button type="button" onClick={onSave}>
          Save trade
        </button>
        <button className="ghost-danger" type="button" onClick={onClear}>
          Clear
        </button>
      </div>
    </div>
  )
}

function ContextPanel({ candidate }: { candidate: CandidateView }) {
  return (
    <>
      <h3>{candidate.symbol} context</h3>
      <TextBlock label="Компания" value={candidate.companyDesc} />
      <TextBlock label="Что двигает сегодня" value={candidate.dayDriver || candidate.why} />
      <TextBlock label="С чем ходит" value={candidate.sectorPeers} />
      <TextBlock label="Что говорят трейдеры" value={candidate.traderChatter} />
      <TextBlock label="Что сломает идею" value={candidate.riskContext} />
    </>
  )
}

function Fact({ label, value }: { label: string; value?: string }) {
  return (
    <div className="fact">
      <small>{label}</small>
      <strong>{value || 'н/д'}</strong>
    </div>
  )
}

function TextBlock({ className = '', label, value }: { className?: string; label: string; value?: string }) {
  return (
    <div className={`text-block ${className}`}>
      <small>{label}</small>
      <p>{value || 'н/д'}</p>
    </div>
  )
}

function TradesBoard({
  rows,
  selectedSymbol,
  onSelect,
}: {
  rows: { trade: Trade; candidate?: CandidateView }[]
  selectedSymbol?: string
  onSelect: (symbol: string) => void
}) {
  const openRisk = rows
    .reduce((sum, row) => sum + Math.max(tradeRisk(row.trade, row.candidate) || 0, 0), 0)
  const realizedPnl = rows.reduce((sum, { trade }) => sum + (trade.realizedPnl || 0), 0)

  return (
    <section className="trades-board" aria-label="Trades board">
      <div className="trades-summary">
        <div>
          <small>Open risk</small>
          <strong>{signedMoney(-openRisk)}</strong>
        </div>
        <div>
          <small>Realized</small>
          <strong className={realizedPnl < 0 ? 'loss' : realizedPnl > 0 ? 'gain' : ''}>
            {signedMoney(realizedPnl)}
          </strong>
        </div>
        <div>
          <small>Trades</small>
          <strong>{rows.length}</strong>
        </div>
      </div>
      <div className="trades-table">
        <div className="trades-row trades-head">
          <span>Symbol</span>
          <span>Side</span>
          <span>Size</span>
          <span>Entry</span>
          <span>Stop / exit</span>
          <span>Risk / P&L</span>
          <span>Status</span>
        </div>
        {rows.length ? (
          rows.map(({ trade, candidate }) => {
            const symbol = trade.symbol || candidate?.symbol || ''
            const status = trade.status || 'active'
            const risk = tradeRisk(trade, candidate)
            const exit = trade.exitPrice ?? trade.realizedExit
            return (
              <button
                className={`trades-row ${symbol === selectedSymbol ? 'active' : ''}`}
                key={symbol}
                type="button"
                onClick={() => symbol && onSelect(symbol)}
              >
                <strong>{symbol}</strong>
                <span>{tradeDirection(trade, candidate)}</span>
                <span>{tradeSize(trade) ?? 'н/д'}</span>
                <span>{money(tradeEntry(trade))}</span>
                <span>{status === 'stopped' || status === 'closed' ? money(exit) : money(tradeStop(trade))}</span>
                <span className={(trade.realizedPnl || 0) < 0 ? 'loss' : ''}>
                  {status === 'stopped' || status === 'closed'
                    ? signedMoney(trade.realizedPnl)
                    : signedMoney(risk === undefined ? undefined : -Math.max(risk, 0))}
                </span>
                <span>{status}</span>
              </button>
            )
          })
        ) : (
          <div className="trades-empty">No trades saved yet.</div>
        )}
      </div>
    </section>
  )
}

function ChartPanel({
  candidate,
  bars,
  dailyBars,
  chartMode,
  setChartMode,
  trade,
}: {
  candidate: Candidate
  bars: Bar[]
  dailyBars: Bar[]
  chartMode: ChartMode
  setChartMode: (mode: ChartMode) => void
  trade?: Trade
}) {
  const tvUrl = `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(
    tradingViewSymbol(candidate),
  )}`
  const chartBars = chartMode === 'Weekly' ? toWeeklyBars(dailyBars) : chartMode === 'Daily' ? dailyBars : bars
  const chartLabel = chartMode === 'Weekly' ? 'weekly' : chartMode === 'Daily' ? 'daily' : '5m'

  return (
    <section className="chart-panel">
      <div className="chart-head">
        <div>
          <h3>
            {candidate.symbol} {chartMode}
          </h3>
        </div>
        <div className="chart-actions">
          {(['5m', 'Daily', 'Weekly'] as ChartMode[]).map((mode) => (
            <button
              className={chartMode === mode ? 'active' : ''}
              key={mode}
              type="button"
              onClick={() => setChartMode(mode)}
            >
              {mode}
            </button>
          ))}
          <a className="refresh" href={tvUrl} rel="noreferrer" target="_blank">
            TV
          </a>
        </div>
      </div>
      <div className="chart-wrap">
        <IntradayChart bars={chartBars} dailyBars={dailyBars} label={chartLabel} trade={trade} />
      </div>
    </section>
  )
}

function toWeeklyBars(dailyBars: Bar[]) {
  const weeks = new Map<string, Bar>()
  dailyBars.forEach((bar) => {
    const date = new Date(bar.t)
    const day = date.getUTCDay() || 7
    const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
    monday.setUTCDate(monday.getUTCDate() - day + 1)
    const key = monday.toISOString().slice(0, 10)
    const current = weeks.get(key)
    if (!current) {
      weeks.set(key, { ...bar, t: monday.getTime() })
      return
    }
    current.h = Math.max(current.h, bar.h)
    current.l = Math.min(current.l, bar.l)
    current.c = bar.c
    current.v += bar.v || 0
  })
  return [...weeks.values()]
}

function IntradayChart({
  bars,
  dailyBars,
  label,
  trade,
}: {
  bars: Bar[]
  dailyBars: Bar[]
  label: string
  trade?: Trade
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const draw = () => {
      const rect = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.floor(rect.width * dpr)
      canvas.height = Math.floor(rect.height * dpr)
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.scale(dpr, dpr)
      ctx.clearRect(0, 0, rect.width, rect.height)

      if (!bars.length) {
        drawEmpty(ctx, rect, `Нет ${label} данных. Открой TradingView.`)
        return
      }

      const limit = label === 'weekly' ? 80 : label === 'daily' ? 120 : 80
      const regularBars = bars.filter((bar) => (bar.v || 0) > 0).slice(-limit)
      const shown = regularBars.length >= 8 ? regularBars : bars.slice(-limit)
      const prices = shown.flatMap((bar) => [bar.h, bar.l])
      const min = Math.min(...prices)
      const max = Math.max(...prices)
      const pad = (max - min) * 0.15 || 1
      const top = max + pad
      const bottom = min - pad
      const chartH = rect.height - 86
      const volH = 60
      const y = (price: number) => 20 + ((top - price) / (top - bottom)) * (chartH - 28)
      const xStep = (rect.width - 52) / shown.length
      const labelSlots: number[] = []

      ctx.strokeStyle = '#1d2b36'
      ctx.lineWidth = 1
      ctx.font = '12px Inter, sans-serif'
      ctx.fillStyle = '#9cadbb'
      for (let i = 0; i < 5; i += 1) {
        const yy = 20 + (i / 4) * (chartH - 28)
        ctx.beginPath()
        ctx.moveTo(0, yy)
        ctx.lineTo(rect.width - 44, yy)
        ctx.stroke()
        const price = top - (i / 4) * (top - bottom)
        ctx.fillText(price.toFixed(2), rect.width - 40, yy + 4)
      }

      const maxVol = Math.max(...shown.map((bar) => bar.v || 0), 1)
      shown.forEach((bar, index) => {
        const x = 8 + index * xStep
        const green = bar.c >= bar.o
        ctx.strokeStyle = green ? '#64c987' : '#f16574'
        ctx.fillStyle = green ? '#64c987' : '#f16574'
        ctx.beginPath()
        ctx.moveTo(x + xStep * 0.45, y(bar.h))
        ctx.lineTo(x + xStep * 0.45, y(bar.l))
        ctx.stroke()
        const bodyTop = y(Math.max(bar.o, bar.c))
        const bodyBottom = y(Math.min(bar.o, bar.c))
        ctx.fillRect(
          x + xStep * 0.18,
          bodyTop,
          Math.max(2, xStep * 0.55),
          Math.max(2, bodyBottom - bodyTop),
        )
        ctx.globalAlpha = 0.42
        ctx.fillRect(
          x + xStep * 0.18,
          rect.height - 16 - ((bar.v || 0) / maxVol) * volH,
          Math.max(2, xStep * 0.55),
          ((bar.v || 0) / maxVol) * volH,
        )
        ctx.globalAlpha = 1
      })

      const gerchikLevels = buildGerchikLevels(dailyBars)
      gerchikLevels.forEach((level, index) => {
        drawLevel(
          ctx,
          rect,
          y,
          level.price,
          level.label,
          gerchikLevelColor(index, gerchikLevels.length),
          index > 0,
          top,
          bottom,
          labelSlots,
          true,
        )
      })

      const activeChartTrade = label === '5m' && isOpenTrade(trade) ? trade : undefined
      if (activeChartTrade) {
        drawLevel(ctx, rect, y, tradeEntry(activeChartTrade), 'entry', '#f2c94c', false, top, bottom, labelSlots, true, 2)
        drawLevel(ctx, rect, y, tradeStop(activeChartTrade), 'stop', '#ff6474', false, top, bottom, labelSlots, true, 2)
        drawLevel(ctx, rect, y, activeChartTrade.target, 'target', '#4fd17b', false, top, bottom, labelSlots, true, 2)
      }
    }

    draw()
    window.addEventListener('resize', draw)
    return () => window.removeEventListener('resize', draw)
  }, [bars, dailyBars, label, trade])

  return <canvas ref={canvasRef} />
}

function buildGerchikLevels(dailyBars: Bar[]) {
  const source = dailyBars.filter((bar) => Number.isFinite(bar.h) && Number.isFinite(bar.l)).slice(-180)
  if (source.length < 12) return []

  const atr = averageTrueRange(source)
  const lastPrice = source.at(-1)?.c || source.at(-1)?.h || 1
  const tolerance = Math.max((atr || lastPrice * 0.02) * 0.16, lastPrice * 0.0035)
  const avgVolume = average(source.slice(-60).map((bar) => bar.v || 0)) || 1
  const levels: GerchikLevel[] = []

  const addLevel = (price: number, type: string, baseScore: number) => {
    if (!Number.isFinite(price) || price <= 0) return
    const existing = levels.find((level) => Math.abs(level.price - price) <= tolerance)
    if (existing) {
      const weight = Math.max(1, baseScore)
      existing.price = (existing.price * existing.score + price * weight) / (existing.score + weight)
      existing.score += baseScore
      existing.types.add(type)
      return
    }
    levels.push({
      price,
      score: baseScore,
      label: '',
      types: new Set([type]),
      touches: 0,
    })
  }

  const highs = source.map((bar) => bar.h)
  const lows = source.map((bar) => bar.l)
  addLevel(Math.max(...highs), 'истор.', 6)
  addLevel(Math.min(...lows), 'истор.', 6)

  source.forEach((bar, index) => {
    if (index < 2 || index > source.length - 3) return
    const prev2 = source[index - 2]
    const prev1 = source[index - 1]
    const next1 = source[index + 1]
    const next2 = source[index + 2]
    if (bar.h > prev1.h && bar.h > prev2.h && bar.h >= next1.h && bar.h >= next2.h) {
      addLevel(bar.h, 'излом', 3.2)
    }
    if (bar.l < prev1.l && bar.l < prev2.l && bar.l <= next1.l && bar.l <= next2.l) {
      addLevel(bar.l, 'излом', 3.2)
    }
  })

  source.forEach((bar, index) => {
    const prev = source[index - 1]
    if (!prev) return
    const range = bar.h - bar.l
    const gap = Math.min(Math.abs(bar.o - prev.c), Math.abs(bar.l - prev.h), Math.abs(bar.h - prev.l))
    if (atr && range > atr * 1.8) {
      addLevel(bar.h, 'паранорм.', 3.6)
      addLevel(bar.l, 'паранорм.', 3.6)
    }
    if (atr && gap > atr * 0.35) {
      addLevel(bar.o, 'гэп', 3.8)
      addLevel(prev.c, 'гэп', 2.6)
    }
    if ((bar.v || 0) > avgVolume * 1.7) {
      addLevel(bar.c, 'проторг.', 3)
    }
  })

  for (const level of levels) {
    let touches = 0
    let recentTouches = 0
    let volumeNearLevel = 0
    source.forEach((bar, index) => {
      const touched =
        Math.abs(bar.h - level.price) <= tolerance ||
        Math.abs(bar.l - level.price) <= tolerance ||
        Math.abs(bar.c - level.price) <= tolerance
      if (!touched) return
      touches += 1
      volumeNearLevel += bar.v || 0
      if (index > source.length - 45) recentTouches += 1
    })
    level.touches = touches
    if (touches >= 3) level.types.add('лимит/зерк.')
    level.score += touches * 0.75 + recentTouches * 0.9 + Math.min(4, volumeNearLevel / avgVolume / 2)
    if (level.types.size >= 2) level.score += 2.5
  }

  return levels
    .filter((level) => level.touches >= 2 || level.score >= 7)
    .sort((left, right) => right.score - left.score)
    .slice(0, 7)
    .map((level, index) => ({
      ...level,
      label: `G${index + 1}`,
    }))
}

function averageTrueRange(bars: Bar[]) {
  const ranges = bars.slice(-15).flatMap((bar, index, recent) => {
    const prev = recent[index - 1]
    if (!prev) return []
    return [Math.max(bar.h - bar.l, Math.abs(bar.h - prev.c), Math.abs(bar.l - prev.c))]
  })
  return average(ranges)
}

function average(values: number[]) {
  const valid = values.filter(Number.isFinite)
  if (!valid.length) return null
  return valid.reduce((sum, value) => sum + value, 0) / valid.length
}

function gerchikLevelColor(index: number, count: number) {
  if (count <= 1) return '#4fd17b'
  const ratio = index / (count - 1)
  const start = { r: 79, g: 209, b: 123 }
  const end = { r: 139, g: 210, b: 255 }
  const r = Math.round(start.r + (end.r - start.r) * ratio)
  const g = Math.round(start.g + (end.g - start.g) * ratio)
  const b = Math.round(start.b + (end.b - start.b) * ratio)
  return `rgb(${r}, ${g}, ${b})`
}

function drawLevel(
  ctx: CanvasRenderingContext2D,
  rect: DOMRect,
  y: (price: number) => number,
  value: number | undefined,
  label: string,
  color: string,
  dashed = false,
  top = Infinity,
  bottom = -Infinity,
  labelSlots: number[] = [],
  showLabel = true,
  lineWidth = 1.5,
) {
  const price = Number(value)
  if (!Number.isFinite(price)) return
  const isAbove = price > top
  const isBelow = price < bottom
  if (isAbove || isBelow) return
  const yy = y(price)

  ctx.save()
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = lineWidth
  if (dashed) ctx.setLineDash([5, 6])
  ctx.beginPath()
  ctx.moveTo(0, yy)
  ctx.lineTo(rect.width - 52, yy)
  ctx.stroke()
  ctx.setLineDash([])

  if (!showLabel || !label) {
    ctx.restore()
    return
  }

  ctx.font = '12px Inter, sans-serif'
  let labelY = yy - 6
  while (labelSlots.some((slot) => Math.abs(slot - labelY) < 22)) {
    labelY += 22
  }
  labelSlots.push(labelY)
  const text = `${label} ${price.toFixed(2)}`
  const width = ctx.measureText(text).width + 12
  ctx.fillStyle = 'rgba(5, 9, 13, 0.82)'
  const x = Math.max(8, rect.width - 64 - width)
  ctx.fillRect(x, labelY - 13, width, 18)
  ctx.strokeStyle = color
  ctx.strokeRect(x, labelY - 13, width, 18)
  ctx.fillStyle = color
  ctx.fillText(text, x + 6, labelY)
  ctx.restore()
}

function drawEmpty(ctx: CanvasRenderingContext2D, rect: DOMRect, text: string) {
  ctx.fillStyle = '#9cadbb'
  ctx.font = '16px Inter, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(text, rect.width / 2, rect.height / 2)
}

export default App
