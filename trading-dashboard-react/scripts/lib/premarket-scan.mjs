import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { importedMoverMap } from './movers-import.mjs'
import { fetchYahooBars, fetchYahooQuotes, insertBars } from './yahoo-market-data.mjs'

function formatMoney(value) {
  return Number.isFinite(value) ? `$${value.toFixed(2)}` : 'н/д'
}

function formatVolume(value) {
  if (!Number.isFinite(value)) return 'н/д'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 1 : 2)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K`
  return String(Math.round(value))
}

function avg(values) {
  if (!values.length) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function atr14(dailyBars) {
  const bars = dailyBars.slice(-15)
  const trs = []
  for (let index = 1; index < bars.length; index += 1) {
    const bar = bars[index]
    const prevClose = bars[index - 1].c
    trs.push(Math.max(bar.h - bar.l, Math.abs(bar.h - prevClose), Math.abs(bar.l - prevClose)))
  }
  return avg(trs.slice(-14))
}

function scoreFor({ catalystScore, levelScore, filterScore, rr }) {
  const rrScore = rr >= 2 ? 2 : rr >= 1.5 ? 1.5 : 0.5
  return Math.min(10, catalystScore + levelScore + filterScore + rrScore)
}

function hardFilterFlags({ price, atr, avgVolume, spread, rr }) {
  const flags = []
  if (!Number.isFinite(price) || price < 10 || price > 150) flags.push({ label: 'PRICE FILTER', severity: 'hard' })
  if (!Number.isFinite(atr) || atr < 1) flags.push({ label: 'ATR < $1', severity: 'hard' })
  if (Number.isFinite(atr) && atr > 3.5) flags.push({ label: 'ATR > $3.5', severity: 'hard' })
  if (!Number.isFinite(avgVolume) || avgVolume < 700_000) flags.push({ label: 'VOL < 700K', severity: 'hard' })
  if (!Number.isFinite(spread)) flags.push({ label: 'SPREAD UNKNOWN', severity: 'warn' })
  if (Number.isFinite(spread) && spread > 0.1) flags.push({ label: 'SPREAD > $0.10', severity: 'hard' })
  if (!Number.isFinite(rr) || rr < 1.5) flags.push({ label: 'RR < 1.5', severity: 'hard' })
  return flags
}

function planFromLevels({ bias, price, atr, levels }) {
  const direction = bias.toLowerCase() === 'short' ? 'short' : 'long'
  const baseRisk = Math.max(atr * 0.18, price * 0.006, 0.35)
  const trigger =
    direction === 'long'
      ? Math.max(levels.prevHigh || price, levels.premarketHigh || price, price)
      : Math.min(levels.prevLow || price, levels.premarketLow || price, price)
  const stop = direction === 'long' ? trigger - baseRisk : trigger + baseRisk
  const target1 = direction === 'long' ? trigger + baseRisk * 1.7 : trigger - baseRisk * 1.7
  const target2 = direction === 'long' ? trigger + baseRisk * 2.4 : trigger - baseRisk * 2.4
  const rr = Math.abs((target1 - trigger) / (trigger - stop))

  return {
    rr,
    planLevels: {
      triggerPrice: Number(trigger.toFixed(2)),
      stopPrice: Number(stop.toFixed(2)),
      target1Price: Number(target1.toFixed(2)),
      target2Price: Number(target2.toFixed(2)),
    },
  }
}

function levelsFromBars({ dailyBars, fiveMinuteBars, last }) {
  const previousDaily = dailyBars.at(-2) || dailyBars.at(-1)
  const intraday = fiveMinuteBars.filter((bar) => (bar.v || 0) > 0)
  const allIntraday = fiveMinuteBars.length ? fiveMinuteBars : []
  const premarket = allIntraday.filter((bar) => (bar.v || 0) === 0)
  const premarketHigh = premarket.length ? Math.max(...premarket.map((bar) => bar.h)) : null
  const premarketLow = premarket.length ? Math.min(...premarket.map((bar) => bar.l)) : null
  const dayHigh = intraday.length ? Math.max(...intraday.map((bar) => bar.h)) : last
  const dayLow = intraday.length ? Math.min(...intraday.map((bar) => bar.l)) : last

  return {
    prevHigh: previousDaily?.h,
    prevLow: previousDaily?.l,
    premarketHigh: premarketHigh || undefined,
    premarketLow: premarketLow || undefined,
    dayHigh,
    dayLow,
    last,
  }
}

function candidateFromData({ symbol, quote, dailyBars, fiveMinuteBars, mover }) {
  const price = quote?.regularMarketPrice || fiveMinuteBars.at(-1)?.c || dailyBars.at(-1)?.c
  const previousClose = quote?.regularMarketPreviousClose || dailyBars.at(-2)?.c
  const changePct =
    Number.isFinite(quote?.regularMarketChangePercent) && quote.regularMarketChangePercent !== null
      ? quote.regularMarketChangePercent
      : previousClose && price
        ? ((price - previousClose) / previousClose) * 100
        : 0
  const bias = changePct < 0 ? 'Short' : 'Long'
  const atr = atr14(dailyBars)
  const avgVolume = quote?.averageDailyVolume3Month || avg(dailyBars.slice(-30).map((bar) => bar.v || 0))
  const spread = Number.isFinite(quote?.ask) && Number.isFinite(quote?.bid) && quote.ask > 0 && quote.bid > 0
    ? quote.ask - quote.bid
    : null
  const levels = levelsFromBars({ dailyBars, fiveMinuteBars, last: price })
  const { rr, planLevels } = planFromLevels({ bias, price, atr: atr || price * 0.02, levels })
  const filterFlags = hardFilterFlags({ price, atr, avgVolume, spread, rr })
  const hardViolation = filterFlags.some((flag) => flag.severity === 'hard')
  const catalystType = mover?.catalystType || (Math.abs(changePct) >= 2 ? 'gap' : 'relative_volume')
  const catalystScore = Math.min(2.5, Math.abs(changePct) / 2)
  const levelScore = levels.prevHigh || levels.prevLow ? 2 : 1
  const filterScore = hardViolation ? 1 : 2.5
  const score = scoreFor({ catalystScore, levelScore, filterScore, rr })
  const directionText = bias === 'Short' ? 'Short-сценарий' : 'Long-сценарий'
  const triggerVerb = bias === 'Short' ? 'ниже' : 'выше'
  const invalidationSide = bias === 'Short' ? 'выше' : 'ниже'
  const company = quote?.shortName || quote?.longName || symbol
  const catalystConfirmed = Boolean(mover && mover.catalystType && mover.catalystType !== 'manual' && mover.dayDriver)
  const independentIdeaConfirmed = Boolean(mover?.independentIdeaConfirmed)

  return {
    symbol,
    exchange: quote?.exchange || 'NASDAQ',
    bias,
    group: hardViolation ? 'exception' : 'core',
    setupStatus: 'premarket',
    status: `${directionText}: нужен 5m impulse ${triggerVerb} ${formatMoney(planLevels.triggerPrice)}, откат 2-3 свечи, base/compression и выход из базы. До этой структуры не входить.`,
    score: `${score.toFixed(1)}/10`,
    scoreReason: `${score.toFixed(1)}/10: catalyst ${catalystType}, change ${changePct.toFixed(2)}%, ${rr.toFixed(1)}R до первой цели, ${hardViolation ? 'есть hard-filter нарушения' : 'hard filters пройдены кроме live spread если н/д'}.`,
    price: formatMoney(price),
    atr: formatMoney(atr),
    avgVolume: formatVolume(avgVolume),
    spread: spread === null ? 'н/д' : formatMoney(spread),
    rr,
    why: `${company} в scan из-за ${catalystType}: ${mover?.note || `change ${changePct.toFixed(2)}% относительно previous close`}. Идея требует собственного 5m continuation около дневного/часового уровня, а не входа по самому факту движения.`,
    trigger: `${directionText} активируется только после 5m impulse ${triggerVerb} ${formatMoney(planLevels.triggerPrice)}, pullback 2-3 свечи, tight base и breakout/breakdown из базы.`,
    invalidation: `Идея ломается при 5m close ${invalidationSide} ${formatMoney(planLevels.stopPrice)} или если откат становится широким без базы.`,
    targets: `T1 ${formatMoney(planLevels.target1Price)}. T2 ${formatMoney(planLevels.target2Price)} только при продолжении с объемом и сохранении структуры.`,
    tradeCharacter: 'Сценарий continuation: не догонять первую свечу, ждать структуру impulse -> pullback -> base -> breakout.',
    sectorPeers: 'н/д: sector/peers пока не обогащаются автоматически.',
    traderChatter: 'н/д: trader chatter пока не добавлен вручную.',
    dayDriver: mover?.dayDriver || `${catalystType}: ${changePct.toFixed(2)}% move. Подтверждение для сделки — post-open структура и объем.`,
    catalystConfirmed,
    independentIdeaConfirmed,
    companyDesc: `${company}: использовать только как ticker context, не как причину входа.`,
    riskContext: `Что сломает идею: потеря ${formatMoney(planLevels.stopPrice)}, отсутствие follow-through, широкий 5m stop, spread > $0.10 или движение только вслед за SPY/QQQ.`,
    filterFlags,
    planLevels,
    levels,
    premarket: {
      changePct,
      price,
      volume: formatVolume(quote?.regularMarketVolume),
    },
    importMeta: mover || undefined,
  }
}

async function defaultUniverse(rootDir) {
  const raw = await readFile(join(rootDir, 'config', 'premarket-universe.json'), 'utf8')
  return JSON.parse(raw).symbols || []
}

export async function buildPremarketScan({ db, rootDir, symbols }) {
  const requestedSymbols = [...new Set((symbols?.length ? symbols : await defaultUniverse(rootDir)).map((symbol) => symbol.toUpperCase()))]
  let quoteError = null
  const quotes = await fetchYahooQuotes(requestedSymbols).catch((error) => {
    quoteError = error instanceof Error ? error.message : 'Yahoo quote failed'
    return []
  })
  const quoteBySymbol = new Map(quotes.map((quote) => [String(quote.symbol).replace('-', '.').toUpperCase(), quote]))
  const moverBySymbol = importedMoverMap(db, requestedSymbols)
  const candidates = []
  const failedSymbols = []

  for (const symbol of requestedSymbols) {
    try {
      const [dailyBars, fiveMinuteBars] = await Promise.all([
        fetchYahooBars(symbol, { range: '6mo', interval: '1d' }),
        fetchYahooBars(symbol, { range: '1d', interval: '5m' }),
      ])
      insertBars(db, symbol, 'daily', dailyBars)
      insertBars(db, symbol, '5m', fiveMinuteBars)
      candidates.push(candidateFromData({
        symbol,
        quote: quoteBySymbol.get(symbol) || {},
        dailyBars,
        fiveMinuteBars,
        mover: moverBySymbol.get(symbol),
      }))
    } catch (error) {
      failedSymbols.push({
        symbol,
        error: error instanceof Error ? error.message : 'Unknown scan error',
      })
    }
  }

  candidates.sort((left, right) => Number(right.score.split('/')[0]) - Number(left.score.split('/')[0]))

  if (!candidates.length) {
    throw new Error(
      `Premarket scan produced 0 candidates (${failedSymbols.length} symbol fetch failures). Database was not modified.`,
    )
  }

  const updatedAt = new Date().toISOString()
  const state = {
    appVersion: 2,
    importedFrom: 'backend scan: Yahoo quote + Yahoo chart API',
    date: updatedAt.slice(0, 10),
    pageTitle: `Отбор на ${updatedAt.slice(0, 10)}`,
    note: 'Backend scan: hard filters price $10-$150, ATR $1-$3.5, avg volume >=700k, spread if available, RR >=1.5. Entry only after 5m impulse -> pullback 2-3 candles -> base -> breakout/breakdown.',
    defaultSymbol: candidates[0]?.symbol || requestedSymbols[0] || '',
    marketDataFile: null,
    lastRefreshAt: updatedAt,
    candidates,
    premarketSnapshot: candidates,
    tradeManagement: {},
    activeTrades: [],
    journal: [],
    topAlerts: candidates.slice(0, 5).map((candidate) => ({
      symbol: candidate.symbol,
      type: `${candidate.bias} watch`,
      trigger: candidate.trigger,
    })),
    dailyContext: {
      market: 'н/д: broad market context пока не обогащается автоматически.',
      risk: 'Yahoo данные могут отличаться от TradingView/брокера; spread доступен не всегда.',
    },
    updatedAt,
  }

  return {
    state,
    summary: {
      updatedAt,
      symbolsRequested: requestedSymbols.length,
      candidates: candidates.length,
      failedSymbols,
      quoteError,
    },
  }
}
