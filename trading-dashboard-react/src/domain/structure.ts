import type { AlertCandidate, CandidateView } from './types'

export function alertQualification(candidate: CandidateView): AlertCandidate | null {
  if (candidate.effectiveGroup !== 'core') return null
  const { setupState } = candidate
  const breakout = setupState.entryChecklist.find((item) => item.key === 'breakout')
  const blockers = setupState.entryChecklist.filter((item) => item.status !== 'pass')

  if (setupState.status === 'trigger_active') {
    return {
      ...candidate,
      alertKind: 'now',
      alertNote: `${setupState.direction.toUpperCase()} | trigger active`,
    }
  }

  if (setupState.status === 'base_forming' && breakout?.status === 'pass' && blockers.length) {
    return {
      ...candidate,
      alertKind: 'blocked',
      alertNote: blockers.map((item) => item.label).join(', '),
    }
  }

  if (setupState.status === 'base_forming') {
    return {
      ...candidate,
      alertKind: 'near',
      alertNote: setupState.note,
    }
  }

  if (setupState.status === 'pullback' || setupState.status === 'impulse_seen') {
    return {
      ...candidate,
      alertKind: 'monitoring',
      alertNote: setupState.note,
    }
  }

  if (setupState.status === 'invalidated') {
    return {
      ...candidate,
      alertKind: 'invalidated',
      alertNote: setupState.invalidatedReason || 'invalidated',
    }
  }

  return null
}

export function hasPostOpenProgress(candidate: CandidateView) {
  return candidate.setupState.status !== 'premarket' && candidate.setupState.status !== 'needs_impulse'
}

export function isPostOpenPriority(candidate: CandidateView) {
  return ['trigger_active', 'base_forming', 'pullback'].includes(candidate.setupState.status)
}

export function primaryAction(candidate: CandidateView) {
  const blockers = candidate.setupState.entryChecklist.filter((item) => item.status !== 'pass')
  const breakout = candidate.setupState.entryChecklist.find((item) => item.key === 'breakout')

  if (candidate.setupState.status === 'trigger_active') {
    return 'Триггер активен'
  }
  if (candidate.setupState.status === 'invalidated') {
    return candidate.setupState.invalidatedReason || 'Сетап сломан'
  }
  if (candidate.setupState.status === 'base_forming' && breakout?.status === 'pass' && blockers.length) {
    return `Блокер: ${blockers[0].label}`
  }
  if (candidate.setupState.status === 'base_forming') {
    return `Ждать breakout ${candidate.setupState.direction === 'long' ? 'выше' : 'ниже'} базы`
  }
  if (candidate.setupState.status === 'pullback') {
    return 'Ждать чистую base / compression'
  }
  if (candidate.setupState.status === 'impulse_seen') {
    return 'Ждать 2-3 candle pullback'
  }
  if (candidate.setupState.status === 'needs_impulse') {
    return 'Ждать 5m impulse'
  }
  return candidate.setupState.note
}

export function attentionClass(candidate: CandidateView) {
  const breakout = candidate.setupState.entryChecklist.find((item) => item.key === 'breakout')
  const blockers = candidate.setupState.entryChecklist.filter((item) => item.status !== 'pass')
  if (candidate.setupState.status === 'trigger_active') return 'now'
  if (candidate.setupState.status === 'invalidated') return 'invalidated'
  if (candidate.setupState.status === 'base_forming' && breakout?.status === 'pass' && blockers.length) return 'blocked'
  if (candidate.setupState.status === 'base_forming') return 'near'
  return 'monitoring'
}

export function stageLabel(candidate: CandidateView) {
  const attention = attentionClass(candidate)
  if (attention === 'now') return 'NOW'
  if (attention === 'blocked') return 'BLOCKED'
  if (attention === 'invalidated') return 'INVALID'
  if (candidate.setupState.status === 'base_forming') return 'BASE'
  if (candidate.setupState.status === 'pullback') return 'PULLBACK'
  if (candidate.setupState.status === 'impulse_seen') return 'WAIT PB'
  if (candidate.setupState.status === 'needs_impulse') return 'WAIT IMP'
  return 'WATCH'
}
