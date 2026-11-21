import type { MultiTimeframeSummary } from '../engine/timeframe';
import type {
  AuditLogEntry,
  BotNotification,
  Candle,
  ExchangeConnectionPublic,
  MarketSymbol,
  Position,
  PriceAlert,
  RiskConfig,
  StrategyWeights,
  TradeRecord,
  TradeSignal,
} from '../engine/types';

export type NavSection =
  | 'terminal'
  | 'analytics'
  | 'backtest'
  | 'exchanges'
  | 'audit'
  | 'gemini';

export interface DailyProfitBar {
  dayLabel: string;
  profitUsd: number;
  tradesCount: number;
  winRatePct: number;
}

export interface AppStateSnapshot {
  running: boolean;
  feedSource: 'live_public' | 'simulated';
  lastLiveSyncAt: number | null;
  circuitBreakerTripped: boolean;
  circuitBreakerReason: string | null;
  equityUsd: number;
  balanceUsd: number;
  startingCapitalUsd: number;
  unrealizedPnlUsd: number;
  realizedPnlTodayUsd: number;
  totalReturnPct: number;
  winRatePct: number;
  totalTrades: number;
  riskConfig: RiskConfig;
  strategyWeights: StrategyWeights;
  learningCycles: number;
  candlesBySymbol: Record<MarketSymbol, Candle[]>;
  signalsBySymbol: Record<MarketSymbol, TradeSignal>;
  multiTimeframeBySymbol: Record<MarketSymbol, MultiTimeframeSummary>;
  positions: Position[];
  trades: TradeRecord[];
  priceAlerts: PriceAlert[];
  auditLogs: AuditLogEntry[];
  notifications: BotNotification[];
  dailyProfits: DailyProfitBar[];
  equityHistory: Array<{ time: number; equity: number }>;
  exchanges: ExchangeConnectionPublic[];
}

export function formatUsd(value: number, withSign = false): string {
  const abs = Math.abs(value);
  const formatted = abs.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (value < 0) return `-$${formatted}`;
  if (withSign && value > 0) return `+$${formatted}`;
  return `$${formatted}`;
}

export function formatPrice(symbol: MarketSymbol, price: number): string {
  const decimals = symbol === 'SOL/USDT' ? 2 : 2;
  return price.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatShortTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function formatDateTime(ts: number): string {
  return new Date(ts).toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
