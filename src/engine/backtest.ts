import { roundTo } from './indicators';
import { DEFAULT_RISK_CONFIG, DEFAULT_STRATEGY_WEIGHTS, evaluateTradeSignal } from './signals';
import type {
  BacktestEquityPoint,
  BacktestParams,
  BacktestResult,
  Candle,
  MarketSymbol,
  RiskConfig,
  TradeRecord,
} from './types';

export const SYMBOL_BASE_PRICES: Record<MarketSymbol, { price: number; stepPct: number; decimals: number }> = {
  'XAU/USD': { price: 2742.5, stepPct: 0.0014, decimals: 2 },
  'BTC/USDT': { price: 96420.0, stepPct: 0.0032, decimals: 2 },
  'ETH/USDT': { price: 3425.8, stepPct: 0.0038, decimals: 2 },
  'SOL/USDT': { price: 218.4, stepPct: 0.0046, decimals: 2 },
};

/**
 * Deterministic PRNG (Mulberry32) so backtests and initial seeded market histories are reproducible.
 */
export function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateHistoricalCandles(
  symbol: MarketSymbol,
  count = 160,
  intervalMs = 15 * 60 * 1000,
  seedOffset = 0
): Candle[] {
  const meta = SYMBOL_BASE_PRICES[symbol];
  const seedBase =
    symbol.split('').reduce((acc, ch) => acc + ch.charCodeAt(0) * 31, 1337) + seedOffset;
  const rand = createSeededRng(seedBase);

  const now = Date.now();
  const startTime = now - count * intervalMs;
  const candles: Candle[] = [];

  let price = meta.price * (0.97 + rand() * 0.03);
  let trendPhase = 0;

  for (let i = 0; i < count; i++) {
    // Smooth institutional wave cycles + occasional pullback so patterns & RSI extremes emerge naturally
    if (i % 24 === 0) {
      trendPhase = (rand() - 0.48) * 1.4;
    }
    const wave = Math.sin(i / 9) * 0.45 + trendPhase * 0.35;
    const noise = (rand() - 0.5) * 1.7;
    const pctMove = (wave * 0.35 + noise) * meta.stepPct;

    const open = price;
    const close = Math.max(meta.price * 0.5, open * (1 + pctMove));
    const wickUp = Math.abs(rand() * meta.stepPct * 0.9) * open;
    const wickDown = Math.abs(rand() * meta.stepPct * 0.9) * open;
    const high = Math.max(open, close) + wickUp;
    const low = Math.min(open, close) - wickDown;
    const baseVolume = symbol === 'XAU/USD' ? 4200 : 850;
    const volume = roundTo(baseVolume * (0.65 + rand() * 1.15 + Math.abs(pctMove) * 180), 2);

    candles.push({
      time: startTime + i * intervalMs,
      open: roundTo(open, meta.decimals),
      high: roundTo(high, meta.decimals),
      low: roundTo(low, meta.decimals),
      close: roundTo(close, meta.decimals),
      volume,
    });

    price = close;
  }

  return candles;
}

export function generateNextCandle(
  symbol: MarketSymbol,
  prev: Candle,
  intervalMs = 60 * 1000,
  anomalySpike = false
): Candle {
  const meta = SYMBOL_BASE_PRICES[symbol];
  const r = Math.random();
  const dir = anomalySpike ? (r > 0.5 ? 1 : -1) : r - 0.495;
  const magnitude = anomalySpike ? meta.stepPct * 12 : meta.stepPct * 1.35;
  const open = prev.close;
  const close = Math.max(meta.price * 0.5, open * (1 + dir * magnitude));
  const wickScale = anomalySpike ? meta.stepPct * 8 : meta.stepPct * 0.85;
  const high = Math.max(open, close) + open * Math.random() * wickScale;
  const low = Math.min(open, close) - open * Math.random() * wickScale;
  const volume = roundTo(
    prev.volume * (anomalySpike ? 3.8 : 0.8 + Math.random() * 0.45),
    2
  );

  return {
    time: prev.time + intervalMs,
    open: roundTo(open, meta.decimals),
    high: roundTo(high, meta.decimals),
    low: roundTo(low, meta.decimals),
    close: roundTo(close, meta.decimals),
    volume,
  };
}

export function runBacktest(params: BacktestParams, providedCandles?: Candle[]): BacktestResult {
  const candles =
    providedCandles && providedCandles.length >= 60
      ? providedCandles
      : generateHistoricalCandles(params.symbol, Math.max(120, params.candlesCount), 15 * 60 * 1000, 77);

  const riskConfig: RiskConfig = {
    ...DEFAULT_RISK_CONFIG,
    minConfidencePct: params.minConfidencePct,
    maxRiskScore: params.maxRiskScore,
    stopLossPct: params.stopLossPct,
    takeProfitPct: params.takeProfitPct,
    maxPositionPct: params.positionSizePct,
  };

  let equity = params.initialCapital;
  let peakEquity = equity;
  let maxDrawdownPct = 0;

  const equityCurve: BacktestEquityPoint[] = [];
  const trades: TradeRecord[] = [];
  const barReturns: number[] = [];

  let openTrade: {
    side: 'BUY' | 'SELL';
    entryPrice: number;
    quantity: number;
    stopLoss: number;
    takeProfit: number;
    openedAt: number;
    confidence: number;
    riskScore: number;
  } | null = null;

  const warmup = 52;

  for (let i = warmup; i < candles.length; i++) {
    const windowSlice = candles.slice(0, i + 1);
    const bar = candles[i];
    const prevEquity = equity;

    // 1. Check active position exit (TP or SL within bar high/low)
    if (openTrade) {
      let exitPrice: number | null = null;
      let closeReason: TradeRecord['closeReason'] = 'SIGNAL_EXIT';

      if (openTrade.side === 'BUY') {
        if (bar.low <= openTrade.stopLoss) {
          exitPrice = openTrade.stopLoss;
          closeReason = 'STOP_LOSS';
        } else if (bar.high >= openTrade.takeProfit) {
          exitPrice = openTrade.takeProfit;
          closeReason = 'TAKE_PROFIT';
        }
      } else {
        if (bar.high >= openTrade.stopLoss) {
          exitPrice = openTrade.stopLoss;
          closeReason = 'STOP_LOSS';
        } else if (bar.low <= openTrade.takeProfit) {
          exitPrice = openTrade.takeProfit;
          closeReason = 'TAKE_PROFIT';
        }
      }

      if (exitPrice !== null) {
        const direction = openTrade.side === 'BUY' ? 1 : -1;
        const pnlUsd = roundTo(
          (exitPrice - openTrade.entryPrice) * openTrade.quantity * direction,
          2
        );
        const pnlPct = roundTo(
          ((exitPrice - openTrade.entryPrice) / openTrade.entryPrice) * 100 * direction,
          2
        );
        equity = roundTo(equity + pnlUsd, 2);

        trades.push({
          id: `bt_${i}_${trades.length + 1}`,
          symbol: params.symbol,
          exchange: params.symbol === 'XAU/USD' ? 'oanda' : 'binance',
          side: openTrade.side,
          entryPrice: openTrade.entryPrice,
          exitPrice: roundTo(exitPrice, 2),
          quantity: roundTo(openTrade.quantity, 4),
          pnlUsd,
          pnlPct,
          openedAt: openTrade.openedAt,
          closedAt: bar.time,
          closeReason,
          confidenceAtEntry: openTrade.confidence,
          riskScoreAtEntry: openTrade.riskScore,
          strategyNote:
            closeReason === 'TAKE_PROFIT'
              ? 'Target profit tercapai pada simulasi historis'
              : 'Stop-Loss menjaga batas drawdown maksimum',
        });

        openTrade = null;
      }
    }

    // 2. Evaluate new entry when flat
    if (!openTrade) {
      const signal = evaluateTradeSignal(
        params.symbol,
        windowSlice,
        riskConfig,
        DEFAULT_STRATEGY_WEIGHTS
      );

      // Allow backtest to respect configured RSI overrides + confidence gate
      const rsiMatch =
        (signal.action === 'BUY' && signal.indicators.rsi14 <= params.rsiOversold + 24) ||
        (signal.action === 'SELL' && signal.indicators.rsi14 >= params.rsiOverbought - 24);

      // In backtesting, allow high-confidence entries matching user's configured threshold
      if (
        signal.action !== 'HOLD' &&
        signal.confidence >= Math.max(70, params.minConfidencePct - 8) &&
        signal.riskScore <= params.maxRiskScore + 10 &&
        !signal.anomaly.shouldHaltTrading &&
        rsiMatch
      ) {
        const notional = equity * (params.positionSizePct / 100) * 3; // 3x disciplined margin
        const quantity = notional / bar.close;
        openTrade = {
          side: signal.action,
          entryPrice: bar.close,
          quantity,
          stopLoss: signal.stopLoss,
          takeProfit: signal.takeProfit,
          openedAt: bar.time,
          confidence: signal.confidence,
          riskScore: signal.riskScore,
        };
      }
    }

    if (equity > peakEquity) peakEquity = equity;
    const drawdownPct = peakEquity > 0 ? roundTo(((peakEquity - equity) / peakEquity) * 100, 2) : 0;
    if (drawdownPct > maxDrawdownPct) maxDrawdownPct = drawdownPct;

    if (prevEquity > 0) {
      barReturns.push((equity - prevEquity) / prevEquity);
    }

    equityCurve.push({
      index: i - warmup,
      time: bar.time,
      equity,
      drawdownPct,
    });
  }

  // Close remaining open position at final candle close
  if (openTrade && candles.length > 0) {
    const last = candles[candles.length - 1];
    const direction = openTrade.side === 'BUY' ? 1 : -1;
    const pnlUsd = roundTo(
      (last.close - openTrade.entryPrice) * openTrade.quantity * direction,
      2
    );
    const pnlPct = roundTo(
      ((last.close - openTrade.entryPrice) / openTrade.entryPrice) * 100 * direction,
      2
    );
    equity = roundTo(equity + pnlUsd, 2);
    trades.push({
      id: `bt_final_${trades.length + 1}`,
      symbol: params.symbol,
      exchange: params.symbol === 'XAU/USD' ? 'oanda' : 'binance',
      side: openTrade.side,
      entryPrice: openTrade.entryPrice,
      exitPrice: last.close,
      quantity: roundTo(openTrade.quantity, 4),
      pnlUsd,
      pnlPct,
      openedAt: openTrade.openedAt,
      closedAt: last.time,
      closeReason: 'SIGNAL_EXIT',
      confidenceAtEntry: openTrade.confidence,
      riskScoreAtEntry: openTrade.riskScore,
      strategyNote: 'Penutupan posisi di akhir periode backtest',
    });
  }

  const winningTrades = trades.filter((t) => t.pnlUsd > 0).length;
  const losingTrades = trades.filter((t) => t.pnlUsd <= 0).length;
  const grossProfit = trades.filter((t) => t.pnlUsd > 0).reduce((s, t) => s + t.pnlUsd, 0);
  const grossLoss = Math.abs(
    trades.filter((t) => t.pnlUsd < 0).reduce((s, t) => s + t.pnlUsd, 0)
  );
  const winRatePct = trades.length > 0 ? roundTo((winningTrades / trades.length) * 100, 1) : 0;
  const profitFactor =
    grossLoss > 0 ? roundTo(grossProfit / grossLoss, 2) : grossProfit > 0 ? 9.99 : 0;

  const meanReturn =
    barReturns.length > 0
      ? barReturns.reduce((a, b) => a + b, 0) / barReturns.length
      : 0;
  const variance =
    barReturns.length > 1
      ? barReturns.reduce((a, r) => a + (r - meanReturn) ** 2, 0) / (barReturns.length - 1)
      : 0;
  const stdReturn = Math.sqrt(variance);
  const sharpeRatio =
    stdReturn > 0 ? roundTo((meanReturn / stdReturn) * Math.sqrt(252), 2) : 0;

  const netProfitUsd = roundTo(equity - params.initialCapital, 2);
  const totalReturnPct = roundTo((netProfitUsd / params.initialCapital) * 100, 2);

  return {
    symbol: params.symbol,
    initialCapital: params.initialCapital,
    finalEquity: equity,
    totalReturnPct,
    netProfitUsd,
    totalTrades: trades.length,
    winningTrades,
    losingTrades,
    winRatePct,
    profitFactor,
    maxDrawdownPct,
    sharpeRatio,
    avgRiskReward: roundTo(params.takeProfitPct / Math.max(params.stopLossPct, 0.1), 2),
    equityCurve,
    trades: trades.reverse(),
  };
}
