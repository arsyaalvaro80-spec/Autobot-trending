export type MarketSymbol = 'XAU/USD' | 'BTC/USDT' | 'ETH/USDT' | 'SOL/USDT';

export type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h';

export type ExchangeId = 'binance' | 'bybit' | 'okx' | 'oanda' | 'indodax';

export interface Candle {
  time: number; // Unix timestamp in ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TechnicalIndicators {
  ema9: number;
  ema21: number;
  ema50: number;
  sma20: number;
  rsi14: number;
  macd: {
    line: number;
    signal: number;
    histogram: number;
  };
  bollinger: {
    upper: number;
    middle: number;
    lower: number;
    bandwidthPct: number;
  };
  atr14: number;
  atrPct: number;
  stochastic: {
    k: number;
    d: number;
  };
}

export type CandlestickPatternDirection = 'bullish' | 'bearish' | 'neutral';

export interface CandlestickPatternMatch {
  name: string;
  labelId: string;
  direction: CandlestickPatternDirection;
  reliability: number; // 0..100
  candleIndex: number;
  time: number;
  price: number;
  description: string;
}

export type SignalAction = 'BUY' | 'SELL' | 'HOLD';

export interface StrategyWeights {
  emaTrend: number;
  rsiMomentum: number;
  macdCross: number;
  bollingerMeanRev: number;
  candlestickPattern: number;
  stochastic: number;
}

export interface AnomalyStatus {
  isAnomaly: boolean;
  severity: 'normal' | 'warning' | 'critical';
  reason: string;
  volatilityRatio: number;
  priceMovePct: number;
  shouldHaltTrading: boolean;
}

export interface TradeSignal {
  symbol: MarketSymbol;
  action: SignalAction;
  confidence: number; // 0..100
  riskScore: number; // 0..100 (lower is safer)
  meetsStrictGate: boolean; // confidence >= 90 && riskScore <= maxRiskScore
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  riskRewardRatio: number;
  regime: 'trending_up' | 'trending_down' | 'ranging' | 'volatile';
  reasons: string[];
  patterns: CandlestickPatternMatch[];
  indicators: TechnicalIndicators;
  anomaly: AnomalyStatus;
  timestamp: number;
}

export interface RiskConfig {
  minConfidencePct: number; // Default 90
  maxRiskScore: number; // Default 25 (low risk)
  maxPositionPct: number; // % of equity per trade (e.g., 5%)
  stopLossPct: number; // e.g., 0.6% for XAU/USD, 1.2% for Crypto
  takeProfitPct: number; // e.g., 1.8% for XAU/USD, 3.6% for Crypto
  maxDailyLossPct: number; // e.g., 3%
  volatilityHaltMultiplier: number; // ATR spike multiplier that halts bot (e.g., 2.8x)
  autoTakeProfitEnabled: boolean;
  autoCircuitBreakerEnabled: boolean;
  adaptiveLearningEnabled: boolean;
}

export interface Position {
  id: string;
  symbol: MarketSymbol;
  exchange: ExchangeId;
  side: 'BUY' | 'SELL';
  entryPrice: number;
  currentPrice: number;
  quantity: number;
  notionalUsd: number;
  stopLoss: number;
  takeProfit: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  openedAt: number;
  confidenceAtEntry: number;
  riskScoreAtEntry: number;
}

export interface TradeRecord {
  id: string;
  symbol: MarketSymbol;
  exchange: ExchangeId;
  side: 'BUY' | 'SELL';
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  pnlUsd: number;
  pnlPct: number;
  openedAt: number;
  closedAt: number;
  closeReason: 'TAKE_PROFIT' | 'STOP_LOSS' | 'SIGNAL_EXIT' | 'MANUAL' | 'CIRCUIT_BREAKER';
  confidenceAtEntry: number;
  riskScoreAtEntry: number;
  strategyNote: string;
}

export interface AuditLogEntry {
  id: string;
  timestamp: number;
  category: 'EXECUTION' | 'SIGNAL' | 'RISK' | 'ANOMALY' | 'LEARNING' | 'EXCHANGE' | 'SYSTEM';
  severity: 'info' | 'success' | 'warning' | 'critical';
  symbol?: MarketSymbol;
  exchange?: ExchangeId;
  title: string;
  detail: string;
}

export interface BotNotification {
  id: string;
  timestamp: number;
  type:
    | 'SIGNAL_90'
    | 'TRADE_EXECUTED'
    | 'TAKE_PROFIT'
    | 'ANOMALY_HALT'
    | 'VOLATILITY_ALERT'
    | 'PRICE_TARGET'
    | 'DAILY_LOSS_HALT';
  title: string;
  message: string;
  symbol?: MarketSymbol;
  read: boolean;
  actionRecommended?: SignalAction;
  confidence?: number;
}

export interface PriceAlert {
  id: string;
  symbol: MarketSymbol;
  condition: 'ABOVE' | 'BELOW';
  targetPrice: number;
  recommendedAction: 'BUY' | 'SELL';
  note: string;
  triggered: boolean;
  triggeredAt?: number;
  createdAt: number;
}

export interface ExchangeConnectionPublic {
  id: string;
  exchange: ExchangeId;
  label: string;
  mode: 'paper' | 'live_encrypted';
  apiKeyMasked: string;
  permissions: string[];
  status: 'connected' | 'degraded' | 'disconnected';
  latencyMs: number;
  supportedSymbols: MarketSymbol[];
  createdAt: number;
  encryptionCipher: 'AES-256-GCM';
}

export interface BacktestParams {
  symbol: MarketSymbol;
  initialCapital: number;
  candlesCount: number;
  minConfidencePct: number;
  maxRiskScore: number;
  stopLossPct: number;
  takeProfitPct: number;
  positionSizePct: number;
  rsiOversold: number;
  rsiOverbought: number;
}

export interface BacktestEquityPoint {
  index: number;
  time: number;
  equity: number;
  drawdownPct: number;
}

export interface BacktestResult {
  symbol: MarketSymbol;
  initialCapital: number;
  finalEquity: number;
  totalReturnPct: number;
  netProfitUsd: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRatePct: number;
  profitFactor: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  avgRiskReward: number;
  equityCurve: BacktestEquityPoint[];
  trades: TradeRecord[];
}
