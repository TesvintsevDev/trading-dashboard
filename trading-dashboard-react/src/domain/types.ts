export type Bias = 'Long' | 'Short' | 'Watch' | string

export type TapeCheck = {
  direction?: string
  impulse5m?: boolean
  dailyHourlyBreak?: boolean
  pullback23?: boolean
  note?: string
}

export type FilterFlag = {
  label: string
  severity?: 'hard' | 'warn' | string
}

export type PlanLevels = {
  entryPrice?: number
  triggerPrice?: number
  stopPrice?: number
  target1Price?: number
  target2Price?: number
}

export type Candidate = {
  symbol: string
  exchange: string
  bias: Bias
  group?: string
  status: string
  score: string
  scoreReason?: string
  price: string
  atr: string
  avgVolume: string
  spread?: string | number
  rr?: number | null
  why?: string
  trigger?: string
  invalidation?: string
  targets?: string
  tradeCharacter?: string
  sectorPeers?: string
  traderChatter?: string
  dayDriver?: string
  catalystConfirmed?: boolean
  independentIdeaConfirmed?: boolean
  companyDesc?: string
  riskContext?: string
  tapeCheck?: TapeCheck
  postOpen?: boolean
  setupStatus?: SetupStatus
  setupState?: SetupState
  filterFlags?: FilterFlag[]
  planLevels?: PlanLevels
  levels?: Record<string, number>
}

export type Bar = {
  t: number
  o: number
  h: number
  l: number
  c: number
  v: number
}

export type MarketData = {
  updatedAt?: string
  symbols: Record<string, Bar[]>
  dailySymbols?: Record<string, Bar[]>
}

export type SetupStatus =
  | 'premarket'
  | 'needs_impulse'
  | 'impulse_seen'
  | 'pullback'
  | 'base_forming'
  | 'trigger_active'
  | 'invalidated'

export type BaseQuality = 'none' | 'loose' | 'acceptable' | 'tight'

export type EntryCheckStatus = 'pass' | 'fail' | 'unknown'

export type EntryCheck = {
  key:
    | 'impulse5m'
    | 'pullback23'
    | 'baseCompression'
    | 'breakout'
    | 'spreadConfirmed'
    | 'rrAtTrigger'
    | 'catalystConfirmed'
    | 'independentIdea'
    | 'clearLevel'
    | 'stopBehindStructure'
    | 'dataFreshness'
    | 'marketSession'
  label: string
  status: EntryCheckStatus
  detail?: string
}

export type SetupState = {
  status: SetupStatus
  direction: 'long' | 'short'
  impulseSeen: boolean
  impulseIndex?: number
  pullbackCount: number
  baseQuality: BaseQuality
  triggerActive: boolean
  dailyHourlyBreak: boolean
  entryChecklist: EntryCheck[]
  invalidatedReason?: string
  note: string
}

export type CandidateView = Candidate & {
  validationFlags: FilterFlag[]
  effectiveGroup: string
  setupState: SetupState
}

export type AlertCandidate = CandidateView & {
  alertNote: string
  alertKind: 'now' | 'near' | 'blocked' | 'monitoring' | 'invalidated'
}

export type StopEvent = {
  at: string
  from?: number
  to?: number
  reason: string
  allowed: boolean
}

export type TradePartial = {
  at: string
  price?: number
  size?: number
  note?: string
}

export type Trade = {
  symbol?: string
  side?: 'long' | 'short' | string
  entry?: number
  entryPrice?: number
  initialStop?: number
  currentStop?: number
  stopPrice?: number
  exitPrice?: number
  target?: number
  size?: number
  quantity?: number
  status?: 'active' | 'closed' | string
  guidance?: string
  stopEvents?: StopEvent[]
  partials?: TradePartial[]
  realizedPnl?: number
  realizedExit?: number
  mfe?: number
  mae?: number
  rResult?: number
}

export type DashboardState = {
  date: string
  pageTitle: string
  note: string
  defaultSymbol: string
  candidates: Candidate[]
  premarketSnapshot?: Candidate[]
  activeTrades: Trade[]
  tradeManagement: Record<string, Trade>
  lastRefreshAt?: string
}
