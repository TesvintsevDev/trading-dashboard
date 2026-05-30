function parseNumber(value) {
  if (typeof value === 'number') return value
  if (!value) return null
  const parsed = Number(String(value).replace(/[^0-9.-]/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

function directionFor(candidate) {
  return String(candidate.bias).toLowerCase().includes('short') ? 'short' : 'long'
}

function regularBars(bars, limit = 90) {
  const regular = bars.filter((bar) => (bar.v || 0) > 0)
  return (regular.length >= 10 ? regular : bars).slice(-limit)
}

function emptyState(candidate, note = 'Нет 5m данных для post-open проверки.', context = {}) {
  return {
    status: 'premarket',
    direction: directionFor(candidate),
    impulseSeen: false,
    pullbackCount: 0,
    baseQuality: 'none',
    triggerActive: false,
    dailyHourlyBreak: false,
    entryChecklist: buildChecklist(candidate, {}, context),
    note,
  }
}

function parseSpread(value) {
  if (value === undefined || value === null) return null
  if (typeof value === 'string' && ['н/д', 'n/a', 'na', ''].includes(value.trim().toLowerCase())) return null
  return parseNumber(value)
}

function planRR(candidate) {
  if (typeof candidate.rr === 'number') return candidate.rr
  const entry = parseNumber(candidate.planLevels?.entryPrice ?? candidate.planLevels?.triggerPrice)
  const stop = parseNumber(candidate.planLevels?.stopPrice)
  const target = parseNumber(candidate.planLevels?.target1Price)
  if (!entry || !stop || !target || entry === stop) return null
  return Math.abs((target - entry) / (entry - stop))
}

function check(key, label, status, detail) {
  return { key, label, status, detail }
}

function freshnessStatus(updatedAt, nowIso) {
  if (!updatedAt) return { status: 'unknown', detail: 'no update timestamp' }
  const updated = new Date(updatedAt)
  const current = nowIso ? new Date(nowIso) : new Date()
  if (!Number.isFinite(updated.getTime()) || !Number.isFinite(current.getTime())) {
    return { status: 'unknown', detail: 'invalid timestamp' }
  }
  const ageMinutes = Math.max(0, Math.round((current.getTime() - updated.getTime()) / 60000))
  return {
    status: ageMinutes <= 10 ? 'pass' : 'fail',
    detail: `${ageMinutes}m old`,
  }
}

function regularSessionStatus(nowIso) {
  const date = nowIso ? new Date(nowIso) : new Date()
  if (!Number.isFinite(date.getTime())) return { status: 'unknown', detail: 'invalid time' }
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  )
  const weekday = parts.weekday
  const minutes = Number(parts.hour) * 60 + Number(parts.minute)
  const regular = !['Sat', 'Sun'].includes(weekday) && minutes >= 570 && minutes < 960
  return {
    status: regular ? 'pass' : 'fail',
    detail: `${weekday} ${parts.hour}:${parts.minute} ET`,
  }
}

function catalystStatus(candidate) {
  if (candidate.catalystConfirmed === true) return { status: 'pass', detail: 'confirmed' }
  if (candidate.catalystConfirmed === false) return { status: 'fail', detail: 'not confirmed' }
  return { status: 'unknown', detail: 'not recorded' }
}

function independentIdeaStatus(candidate) {
  if (candidate.independentIdeaConfirmed === true) return { status: 'pass', detail: 'confirmed' }
  if (candidate.independentIdeaConfirmed === false) return { status: 'fail', detail: 'not confirmed' }
  return { status: 'unknown', detail: 'not recorded' }
}

function clearLevelStatus(candidate) {
  const levels = candidate.levels || {}
  const hasLevel = [
    levels.prevHigh,
    levels.prevLow,
  ].some((value) => Number.isFinite(Number(value)))
  return {
    status: hasLevel ? 'pass' : 'fail',
    detail: hasLevel ? 'level recorded' : 'no level',
  }
}

function stopBehindStructureStatus(candidate, direction, baseBars) {
  const stop = parseNumber(candidate.planLevels?.stopPrice)
  if (!stop || !baseBars.length) return { status: 'unknown', detail: 'no structure stop' }
  const baseHigh = Math.max(...baseBars.map((bar) => bar.h))
  const baseLow = Math.min(...baseBars.map((bar) => bar.l))
  const valid = direction === 'long' ? stop < baseLow : stop > baseHigh
  return {
    status: valid ? 'pass' : 'fail',
    detail: valid
      ? direction === 'long'
        ? `stop < base low ${baseLow.toFixed(2)}`
        : `stop > base high ${baseHigh.toFixed(2)}`
      : direction === 'long'
        ? `stop not below base low ${baseLow.toFixed(2)}`
        : `stop not above base high ${baseHigh.toFixed(2)}`,
  }
}

function buildChecklist(
  candidate,
  {
    impulseSeen = false,
    pullbackCount = 0,
    baseQuality = 'none',
    breakoutConfirmed = false,
    direction,
    baseBars = [],
  } = {},
  context = {},
) {
  const spread = parseSpread(candidate.spread)
  const rr = planRR(candidate)
  const catalyst = catalystStatus(candidate)
  const independentIdea = independentIdeaStatus(candidate)
  const clearLevel = clearLevelStatus(candidate)
  const structureStop = stopBehindStructureStatus(candidate, direction || directionFor(candidate), baseBars)
  const freshness = freshnessStatus(context.marketDataUpdatedAt, context.nowIso)
  const session = regularSessionStatus(context.nowIso)
  return [
    check('impulse5m', '5m impulse', impulseSeen ? 'pass' : 'fail'),
    check(
      'pullback23',
      'Pullback 2-3 candles',
      pullbackCount >= 2 ? 'pass' : 'fail',
      pullbackCount ? `${pullbackCount} candles` : undefined,
    ),
    check(
      'baseCompression',
      'Base / compression',
      ['acceptable', 'tight'].includes(baseQuality) ? 'pass' : 'fail',
      baseQuality,
    ),
    check('breakout', 'Breakout / breakdown', breakoutConfirmed ? 'pass' : 'fail'),
    check(
      'spreadConfirmed',
      'Spread ≤ $0.10',
      spread === null ? 'unknown' : spread <= 0.1 ? 'pass' : 'fail',
      spread === null ? 'spread unknown' : `$${spread.toFixed(2)}`,
    ),
    check(
      'rrAtTrigger',
      'R:R to T1 ≥ 1.5',
      rr === null ? 'unknown' : rr >= 1.5 ? 'pass' : 'fail',
      rr === null ? 'R:R unknown' : `${rr.toFixed(2)}R`,
    ),
    check('catalystConfirmed', 'Catalyst confirmed', catalyst.status, catalyst.detail),
    check('independentIdea', 'Own idea vs SPY/QQQ', independentIdea.status, independentIdea.detail),
    check('clearLevel', 'Clear daily/hourly level', clearLevel.status, clearLevel.detail),
    check('stopBehindStructure', 'Stop behind 5m structure', structureStop.status, structureStop.detail),
    check('dataFreshness', 'Data freshness ≤ 10m', freshness.status, freshness.detail),
    check('marketSession', 'Regular session', session.status, session.detail),
  ]
}

function allEntryChecksPass(checklist) {
  return checklist.every((item) => item.status === 'pass')
}

function crossedTrigger(candidate, bar, direction) {
  const trigger = candidate.planLevels?.triggerPrice
  if (!trigger) return false
  return direction === 'long' ? bar.c >= trigger || bar.h >= trigger : bar.c <= trigger || bar.l <= trigger
}

function isInvalidated(candidate, last, direction) {
  const stop = candidate.planLevels?.stopPrice
  if (!last || !stop) return false
  return direction === 'long' ? last.c <= stop : last.c >= stop
}

function countPullback(afterImpulse, direction) {
  let count = 0
  for (const bar of afterImpulse) {
    const counter = direction === 'long' ? bar.c < bar.o : bar.c > bar.o
    if (!counter) break
    count += 1
  }
  return count
}

function baseQuality(baseBars, atr) {
  if (baseBars.length < 2) return 'none'
  const high = Math.max(...baseBars.map((bar) => bar.h))
  const low = Math.min(...baseBars.map((bar) => bar.l))
  const range = high - low
  const avgBody = baseBars.reduce((sum, bar) => sum + Math.abs(bar.c - bar.o), 0) / baseBars.length

  if (range <= atr * 0.18 && avgBody <= atr * 0.08) return 'tight'
  if (range <= atr * 0.28 && avgBody <= atr * 0.14) return 'acceptable'
  if (range <= atr * 0.42) return 'loose'
  return 'none'
}

export function evaluateSetup(candidate, bars, context = {}) {
  const session = regularSessionStatus(context.nowIso)
  if (session.status !== 'pass') {
    return emptyState(
      candidate,
      'Premarket: live setup state появится после открытия regular session.',
      context,
    )
  }

  const shown = regularBars(bars)
  if (!shown.length) return emptyState(candidate, 'Нет 5m данных для post-open проверки.', context)

  const direction = directionFor(candidate)
  const last = shown.at(-1)
  if (isInvalidated(candidate, last, direction)) {
    return {
      ...emptyState(candidate, 'Нет 5m данных для post-open проверки.', context),
      direction,
      status: 'invalidated',
      invalidatedReason: `Цена закрылась за stop ${candidate.planLevels?.stopPrice}.`,
      note: 'Setup invalidated: цена закрылась за плановый stop.',
    }
  }

  const atr = parseNumber(candidate.atr) || Math.max(candidate.planLevels?.triggerPrice || 1, 1) * 0.02
  const minImpulseRange = Math.max(atr * 0.18, (last?.c || 1) * 0.006)
  let impulseIndex = -1

  for (let index = Math.max(6, shown.length - 72); index < shown.length - 2; index += 1) {
    const previous = shown.slice(Math.max(0, index - 14), index)
    if (previous.length < 6) continue
    const bar = shown[index]
    const previousHigh = Math.max(...previous.map((item) => item.h))
    const previousLow = Math.min(...previous.map((item) => item.l))
    const range = bar.h - bar.l
    const impulse =
      direction === 'long'
        ? bar.c > previousHigh && bar.c > bar.o && range >= minImpulseRange && crossedTrigger(candidate, bar, direction)
        : bar.c < previousLow && bar.c < bar.o && range >= minImpulseRange && crossedTrigger(candidate, bar, direction)

    if (impulse) impulseIndex = index
  }

  if (impulseIndex === -1) {
    return {
      ...emptyState(candidate),
      direction,
      status: 'needs_impulse',
      dailyHourlyBreak: false,
      entryChecklist: buildChecklist(candidate, { direction }, context),
      note: 'Setup not active: нужен 5m impulse через trigger/daily-hourly level.',
    }
  }

  const afterImpulse = shown.slice(impulseIndex + 1)
  const pullbackCount = countPullback(afterImpulse, direction)
  if (pullbackCount < 2) {
    return {
      ...emptyState(candidate),
      direction,
      status: 'impulse_seen',
      impulseSeen: true,
      impulseIndex,
      pullbackCount,
      dailyHourlyBreak: true,
      entryChecklist: buildChecklist(candidate, { impulseSeen: true, pullbackCount, direction }, context),
      note: 'Setup not active: impulse есть, ждем 2-3 candle pullback.',
    }
  }

  const baseBars = afterImpulse.slice(pullbackCount, pullbackCount + 4)
  const quality = baseQuality(baseBars, atr)
  if (quality === 'none' || quality === 'loose') {
    return {
      ...emptyState(candidate),
      direction,
      status: 'pullback',
      impulseSeen: true,
      impulseIndex,
      pullbackCount,
      baseQuality: quality,
      dailyHourlyBreak: true,
      entryChecklist: buildChecklist(candidate, {
        impulseSeen: true,
        pullbackCount,
        baseQuality: quality,
        direction,
        baseBars,
      }, context),
      note: 'Setup not active: pullback есть, но base/compression еще недостаточно чистая.',
    }
  }

  const baseHigh = Math.max(...baseBars.map((bar) => bar.h))
  const baseLow = Math.min(...baseBars.map((bar) => bar.l))
  const breakoutConfirmed = Boolean(
    last && (direction === 'long' ? last.c > baseHigh && last.c > last.o : last.c < baseLow && last.c < last.o),
  )
  const entryChecklist = buildChecklist(candidate, {
    impulseSeen: true,
    pullbackCount,
    baseQuality: quality,
    breakoutConfirmed,
    direction,
    baseBars,
  }, context)
  const triggerActive = breakoutConfirmed && allEntryChecksPass(entryChecklist)
  const blockingChecks = entryChecklist.filter((item) => item.status !== 'pass')

  return {
    status: triggerActive ? 'trigger_active' : 'base_forming',
    direction,
    impulseSeen: true,
    impulseIndex,
    pullbackCount,
    baseQuality: quality,
    triggerActive,
    dailyHourlyBreak: true,
    entryChecklist,
    note: triggerActive
      ? 'Trigger active: все условия входа подтверждены.'
      : breakoutConfirmed
        ? `Breakout есть, но вход заблокирован: ${blockingChecks.map((item) => item.label).join(', ')}.`
        : 'Setup not active: base есть, ждем выход из базы в сторону impulse.',
  }
}

export function alertKindFor(setupState) {
  if (setupState.status === 'trigger_active') return 'now'
  if (['base_forming', 'pullback', 'impulse_seen'].includes(setupState.status)) return 'waiting'
  if (setupState.status === 'invalidated') return 'invalidated'
  return null
}
