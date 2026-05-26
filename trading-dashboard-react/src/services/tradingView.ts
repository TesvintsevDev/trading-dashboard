import type { Candidate } from '../domain/types'

const tradingViewExchangeBySymbol: Record<string, string> = {
  BABA: 'NYSE',
  CSCO: 'NASDAQ',
  DOCS: 'NYSE',
  FIG: 'NYSE',
  FPS: 'NYSE',
  HPE: 'NYSE',
  KC: 'NASDAQ',
  KLAR: 'NYSE',
  LUNR: 'NASDAQ',
  LWLG: 'NASDAQ',
  NCLH: 'NYSE',
  PDFS: 'NASDAQ',
  POET: 'NASDAQ',
  QCOM: 'NASDAQ',
  RDW: 'NYSE',
  TNGX: 'NASDAQ',
  UMC: 'NYSE',
  VNET: 'NASDAQ',
  XPEV: 'NYSE',
  YETI: 'NYSE',
}

export function tradingViewSymbol(candidate: Candidate) {
  const exchange =
    tradingViewExchangeBySymbol[candidate.symbol] ||
    (candidate.exchange && !candidate.exchange.includes('/') ? candidate.exchange : 'NASDAQ')

  return `${exchange}:${candidate.symbol}`
}
