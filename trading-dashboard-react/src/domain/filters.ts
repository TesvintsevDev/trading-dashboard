import type { Candidate, CandidateView, FilterFlag, SetupState } from './types'

export function parseNumber(value: string | number | undefined) {
  if (typeof value === 'number') return value
  if (!value) return null
  const parsed = Number(String(value).replace(/[^0-9.-]/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

export function parseVolume(value: string | undefined) {
  if (!value) return null
  const clean = value.trim().toUpperCase()
  const parsed = parseNumber(clean)
  if (parsed === null) return null
  if (clean.includes('M')) return parsed * 1_000_000
  if (clean.includes('K')) return parsed * 1_000
  return parsed
}

export function parseSpread(value: string | number | undefined) {
  if (value === undefined || value === null) return null
  if (typeof value === 'string' && ['н/д', 'n/a', 'na', ''].includes(value.trim().toLowerCase())) {
    return null
  }
  return parseNumber(value)
}

export function scoreNumber(score: string) {
  return Number(score.split('/')[0]) || 0
}

export function biasClass(bias: string) {
  return String(bias).toLowerCase()
}

export function planRR(candidate: Candidate) {
  if (typeof candidate.rr === 'number') return candidate.rr
  const entry = parseNumber(candidate.planLevels?.entryPrice ?? candidate.planLevels?.triggerPrice)
  const stop = parseNumber(candidate.planLevels?.stopPrice)
  const target = parseNumber(candidate.planLevels?.target1Price)
  if (!entry || !stop || !target || entry === stop) return null
  return Math.abs((target - entry) / (entry - stop))
}

function uniqueFlags(flags: FilterFlag[]) {
  const seen = new Set<string>()
  return flags.filter((flag) => {
    if (seen.has(flag.label)) return false
    seen.add(flag.label)
    return true
  })
}

export function validateCandidate(candidate: Candidate): FilterFlag[] {
  const flags: FilterFlag[] = []
  const price = parseNumber(candidate.price)
  const atr = parseNumber(candidate.atr)
  const volume = parseVolume(candidate.avgVolume)
  const spread = parseSpread(candidate.spread)
  const rr = planRR(candidate)

  if (price === null || price < 10 || price > 150) {
    flags.push({ label: 'PRICE FILTER', severity: 'hard' })
  }
  if (atr === null || atr < 1) flags.push({ label: 'ATR < $1', severity: 'hard' })
  if (atr !== null && atr > 3.5) flags.push({ label: 'ATR > $3.5', severity: 'hard' })
  if (volume === null || volume < 700_000) {
    flags.push({ label: 'VOL < 700K', severity: 'hard' })
  }
  if (spread === null) flags.push({ label: 'SPREAD UNKNOWN', severity: 'warn' })
  if (spread !== null && spread > 0.1) flags.push({ label: 'SPREAD > $0.10', severity: 'hard' })
  if (rr === null || rr < 1.5) flags.push({ label: 'RR < 1.5', severity: 'hard' })
  if (!candidate.scoreReason) flags.push({ label: 'NO SCORE REASON', severity: 'warn' })
  if (!candidate.planLevels?.triggerPrice || !candidate.planLevels?.stopPrice || !candidate.planLevels?.target1Price) {
    flags.push({ label: 'LEVELS MISSING', severity: 'warn' })
  }

  return uniqueFlags([...(candidate.filterFlags || []), ...flags])
}

function unavailableSetupState(candidate: Candidate): SetupState {
  return {
    status: 'premarket',
    direction: String(candidate.bias).toLowerCase().includes('short') ? 'short' : 'long',
    impulseSeen: false,
    pullbackCount: 0,
    baseQuality: 'none',
    triggerActive: false,
    dailyHourlyBreak: false,
    entryChecklist: [],
    note: 'Setup state недоступен: нужен backend refresh/recalculate.',
  }
}

function normalizeSetupState(candidate: Candidate, setupState?: SetupState): SetupState {
  if (!setupState?.entryChecklist) return unavailableSetupState(candidate)
  return setupState
}

export function toCandidateView(candidate: Candidate, setupState?: SetupState): CandidateView {
  const validationFlags = validateCandidate(candidate)
  const hasHardViolation = validationFlags.some((flag) => flag.severity === 'hard')
  return {
    ...candidate,
    rr: planRR(candidate),
    validationFlags,
    effectiveGroup: candidate.group === 'exception' || hasHardViolation ? 'exception' : 'core',
    setupState: normalizeSetupState(candidate, setupState),
  }
}
