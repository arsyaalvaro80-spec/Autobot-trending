import { computeIndicatorSnapshot, roundTo } from './indicators';
import { detectCandlestickPatterns } from './patterns';
import type {
  AnomalyStatus,
  Candle,
  MarketSymbol,
  Position,
  RiskConfig,
  SignalAction,
  StrategyWeights,
  TradeRecord,
  TradeSignal,
} from './types';

export const DEFAULT_STRATEGY_WEIGHTS: StrategyWeights = {
  emaTrend: 0.24,
  rsiMomentum: 0.2,
  macdCross: 0.2,
  bollingerMeanRev: 0.14,
  candlestickPattern: 0.14,
  stochastic: 0.08,
};

export const DEFAULT_RISK_CONFIG: RiskConfig = {
  minConfidencePct: 90,
  maxRiskScore: 25,
  maxPositionPct: 5,
  stopLossPct: 0.65,
  takeProfitPct: 1.95,
  maxDailyLossPct: 3.0,
  volatilityHaltMultiplier: 2.8,
  autoTakeProfitEnabled: true,
  autoCircuitBreakerEnabled: true,
  adaptiveLearningEnabled: true,
};

export function detectMarketAnomaly(
  candles: Candle[],
  atr14: number,
  volatilityHaltMultiplier = 2.8
): AnomalyStatus {
  if (candles.length < 5 || atr14 <= 0) {
    return {
      isAnomaly: false,
      severity: 'normal',
      reason: 'Kondisi pasar stabil dalam rentang volatilitas normal.',
      volatilityRatio: 1,
      priceMovePct: 0,
      shouldHaltTrading: false,
    };
  }

  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const currentRange = last.high - last.low;
  const volatilityRatio = roundTo(currentRange / Math.max(atr14, 1e-6), 2);
  const priceMovePct = roundTo(
    prev.close > 0 ? ((last.close - prev.close) / prev.close) * 100 : 0,
    3
  );

  // Average volume spike check
  const recentVols = candles.slice(-15, -1).map((c) => c.volume);
  const avgVol =
    recentVols.length > 0
      ? recentVols.reduce((a, b) => a + b, 0) / recentVols.length
      : last.volume;
  const volSpikeRatio = avgVol > 0 ? last.volume / avgVol : 1;

  if (volatilityRatio >= volatilityHaltMultiplier || Math.abs(priceMovePct) >= 2.6) {
    return {
      isAnomaly: true,
      severity: 'critical',
      reason: `Fluktuasi ekstrem terdeteksi (${volatilityRatio}x ATR, pergerakan ${priceMovePct >= 0 ? '+' : ''}${priceMovePct}%). Circuit breaker aktif untuk melindungi modal.`,
      volatilityRatio,
      priceMovePct,
      shouldHaltTrading: true,
    };
  }

  if (volatilityRatio >= volatilityHaltMultiplier * 0.72 || volSpikeRatio >= 2.8) {
    return {
      isAnomaly: true,
      severity: 'warning',
      reason: `Lonjakan volatilitas pasar (${volatilityRatio}x ATR, volume ${roundTo(volSpikeRatio, 1)}x rata-rata). Sistem memperketat filter risiko.`,
      volatilityRatio,
      priceMovePct,
      shouldHaltTrading: false,
    };
  }

  return {
    isAnomaly: false,
    severity: 'normal',
    reason: 'Volatilitas pasar terkendali dan likuiditas seimbang.',
    volatilityRatio,
    priceMovePct,
    shouldHaltTrading: false,
  };
}

/**
 * Evaluates multi-indicator confluence + candlestick patterns + anomaly/risk filters.
 * Strictly enforces the 90% confidence & low-risk gate before marking `meetsStrictGate = true`.
 */
export function evaluateTradeSignal(
  symbol: MarketSymbol,
  candles: Candle[],
  riskConfig: RiskConfig = DEFAULT_RISK_CONFIG,
  weights: StrategyWeights = DEFAULT_STRATEGY_WEIGHTS
): TradeSignal {
  const indicators = computeIndicatorSnapshot(candles);
  const patterns = detectCandlestickPatterns(candles, 8);
  const anomaly = detectMarketAnomaly(
    candles,
    indicators.atr14,
    riskConfig.volatilityHaltMultiplier
  );

  const lastCandle = candles[candles.length - 1];
  const price = lastCandle ? lastCandle.close : 0;
  const reasons: string[] = [];

  // Directional score in range [-1, +1] for each indicator component
  let bullScore = 0;
  let bearScore = 0;
  let alignedBullComponents = 0;
  let alignedBearComponents = 0;

  // 1. EMA Trend Alignment (9 vs 21 vs 50)
  if (indicators.ema9 > indicators.ema21 && indicators.ema21 > indicators.ema50) {
    bullScore += weights.emaTrend;
    alignedBullComponents++;
    reasons.push('Struktur EMA 9 > EMA 21 > EMA 50 mengonfirmasi tren naik solid');
  } else if (indicators.ema9 < indicators.ema21 && indicators.ema21 < indicators.ema50) {
    bearScore += weights.emaTrend;
    alignedBearComponents++;
    reasons.push('Struktur EMA 9 < EMA 21 < EMA 50 mengonfirmasi tren turun solid');
  } else if (indicators.ema9 > indicators.ema21) {
    bullScore += weights.emaTrend * 0.55;
  } else if (indicators.ema9 < indicators.ema21) {
    bearScore += weights.emaTrend * 0.55;
  }

  // 2. RSI-14 Momentum / Extremes
  if (indicators.rsi14 <= 30) {
    bullScore += weights.rsiMomentum;
    alignedBullComponents++;
    reasons.push(`RSI-14 di area jenuh jual (${indicators.rsi14}) mendukung pembalikan beli`);
  } else if (indicators.rsi14 >= 72) {
    bearScore += weights.rsiMomentum;
    alignedBearComponents++;
    reasons.push(`RSI-14 di area jenuh beli (${indicators.rsi14}) mendukung eksekusi jual`);
  } else if (indicators.rsi14 >= 50 && indicators.rsi14 < 72) {
    bullScore += weights.rsiMomentum * 0.85;
    alignedBullComponents++;
  } else if (indicators.rsi14 <= 48 && indicators.rsi14 > 30) {
    bearScore += weights.rsiMomentum * 0.85;
    alignedBearComponents++;
  }

  // 3. MACD Momentum & Histogram
  if (indicators.macd.line > indicators.macd.signal && indicators.macd.histogram > 0) {
    bullScore += weights.macdCross;
    alignedBullComponents++;
    reasons.push('MACD bullish crossover dengan histogram positif meningkat');
  } else if (indicators.macd.line < indicators.macd.signal && indicators.macd.histogram < 0) {
    bearScore += weights.macdCross;
    alignedBearComponents++;
    reasons.push('MACD bearish crossover dengan momentum turun terkonfirmasi');
  }

  // 4. Bollinger Bands position
  const bbSpan = Math.max(indicators.bollinger.upper - indicators.bollinger.lower, 1e-6);
  const bbPos = (price - indicators.bollinger.lower) / bbSpan; // 0 = lower band, 1 = upper band
  if (bbPos <= 0.25) {
    bullScore += weights.bollingerMeanRev;
    alignedBullComponents++;
    reasons.push('Harga berada dekat Lower Bollinger Band dengan ruang rebound optimal');
  } else if (bbPos >= 0.75) {
    bearScore += weights.bollingerMeanRev;
    alignedBearComponents++;
    reasons.push('Harga menyentuh Upper Bollinger Band dengan risiko koreksi tinggi');
  } else if (bbPos > 0.5) {
    bullScore += weights.bollingerMeanRev * 0.35;
  } else {
    bearScore += weights.bollingerMeanRev * 0.35;
  }

  // 5. Recent Candlestick Patterns (last 2 candles)
  const freshPatterns = patterns.filter((p) => p.candleIndex >= candles.length - 2);
  const topPattern = freshPatterns[0];
  if (topPattern) {
    if (topPattern.direction === 'bullish') {
      bullScore += weights.candlestickPattern * (topPattern.reliability / 100);
      alignedBullComponents++;
      reasons.push(`Pola candlestick ${topPattern.name} terdeteksi (reliabilitas ${topPattern.reliability}%)`);
    } else if (topPattern.direction === 'bearish') {
      bearScore += weights.candlestickPattern * (topPattern.reliability / 100);
      alignedBearComponents++;
      reasons.push(`Pola candlestick ${topPattern.name} terdeteksi (reliabilitas ${topPattern.reliability}%)`);
    }
  }

  // 6. Stochastic Oscillator
  if (indicators.stochastic.k < 25 && indicators.stochastic.k >= indicators.stochastic.d) {
    bullScore += weights.stochastic;
    alignedBullComponents++;
    reasons.push(`Stochastic %K/${indicators.stochastic.k} keluar dari area oversold`);
  } else if (indicators.stochastic.k > 75 && indicators.stochastic.k <= indicators.stochastic.d) {
    bearScore += weights.stochastic;
    alignedBearComponents++;
    reasons.push(`Stochastic %K/${indicators.stochastic.k} berbalik turun dari area overbought`);
  } else if (indicators.stochastic.k > indicators.stochastic.d) {
    bullScore += weights.stochastic * 0.45;
  } else {
    bearScore += weights.stochastic * 0.45;
  }

  // Normalize total weights
  const totalWeight =
    weights.emaTrend +
    weights.rsiMomentum +
    weights.macdCross +
    weights.bollingerMeanRev +
    weights.candlestickPattern +
    weights.stochastic;

  const normBull = totalWeight > 0 ? bullScore / totalWeight : 0;
  const normBear = totalWeight > 0 ? bearScore / totalWeight : 0;

  let action: SignalAction = 'HOLD';
  let rawConfidence = 50;
  let confluenceBonus = 0;

  if (normBull > normBear + 0.08) {
    action = 'BUY';
    confluenceBonus = alignedBullComponents >= 4 ? 14 : alignedBullComponents >= 3 ? 8 : 0;
    rawConfidence = Math.min(98, Math.round(52 + normBull * 44 + confluenceBonus));
  } else if (normBear > normBull + 0.08) {
    action = 'SELL';
    confluenceBonus = alignedBearComponents >= 4 ? 14 : alignedBearComponents >= 3 ? 8 : 0;
    rawConfidence = Math.min(98, Math.round(52 + normBear * 44 + confluenceBonus));
  } else {
    action = 'HOLD';
    rawConfidence = Math.round(45 + Math.abs(normBull - normBear) * 50);
  }

  // Compute strict Risk Score (0 = ultra-low risk, 100 = extreme risk)
  // Factors: ATR volatility %, anomaly ratio, conflicting indicator pressure, XAU/USD tighter spread discipline
  const conflictPenalty = Math.min(normBull, normBear) * 45;
  const volPenalty = Math.min(40, indicators.atrPct * (symbol === 'XAU/USD' ? 28 : 14));
  const anomalyPenalty = anomaly.severity === 'critical' ? 50 : anomaly.severity === 'warning' ? 22 : 0;
  const alignmentDiscount =
    Math.max(alignedBullComponents, alignedBearComponents) >= 4 ? 14 : 0;

  const riskScore = Math.max(
    5,
    Math.min(99, Math.round(12 + conflictPenalty + volPenalty + anomalyPenalty - alignmentDiscount))
  );

  // If circuit breaker anomaly is critical, force HOLD and suppress gate
  const effectiveAction: SignalAction =
    anomaly.shouldHaltTrading && riskConfig.autoCircuitBreakerEnabled ? 'HOLD' : action;

  const confidence = anomaly.shouldHaltTrading ? Math.min(rawConfidence, 40) : rawConfidence;

  // Dynamic SL/TP adjusted for symbol volatility (tighter for XAU/USD precision)
  const symbolSlMultiplier = symbol === 'XAU/USD' ? 1.0 : 1.5;
  const slPct = Math.max(0.25, riskConfig.stopLossPct * symbolSlMultiplier);
  const tpPct = Math.max(slPct * 2.2, riskConfig.takeProfitPct * symbolSlMultiplier);

  const stopLoss =
    effectiveAction === 'SELL'
      ? roundTo(price * (1 + slPct / 100), symbol === 'XAU/USD' ? 2 : 2)
      : roundTo(price * (1 - slPct / 100), symbol === 'XAU/USD' ? 2 : 2);
  const takeProfit =
    effectiveAction === 'SELL'
      ? roundTo(price * (1 - tpPct / 100), symbol === 'XAU/USD' ? 2 : 2)
      : roundTo(price * (1 + tpPct / 100), symbol === 'XAU/USD' ? 2 : 2);

  const riskRewardRatio = roundTo(tpPct / Math.max(slPct, 0.01), 2);

  const meetsStrictGate =
    effectiveAction !== 'HOLD' &&
    confidence >= riskConfig.minConfidencePct &&
    riskScore <= riskConfig.maxRiskScore &&
    !anomaly.shouldHaltTrading;

  let regime: TradeSignal['regime'] = 'ranging';
  if (anomaly.severity !== 'normal') {
    regime = 'volatile';
  } else if (indicators.ema9 > indicators.ema21 && indicators.ema21 > indicators.ema50) {
    regime = 'trending_up';
  } else if (indicators.ema9 < indicators.ema21 && indicators.ema21 < indicators.ema50) {
    regime = 'trending_down';
  }

  return {
    symbol,
    action: effectiveAction,
    confidence,
    riskScore,
    meetsStrictGate,
    entryPrice: roundTo(price, 2),
    stopLoss,
    takeProfit,
    riskRewardRatio,
    regime,
    reasons: reasons.length > 0 ? reasons : ['Indikator teknikal masih netral, menunggu konfluensi kuat.'],
    patterns: patterns.slice(0, 5),
    indicators,
    anomaly,
    timestamp: lastCandle ? lastCandle.time : Date.now(),
  };
}

/**
 * Evaluates all open positions against live price for automatic Take-Profit / Stop-Loss execution.
 */
export function evaluateOpenPositions(
  positions: Position[],
  symbol: MarketSymbol,
  currentPrice: number,
  autoTakeProfitEnabled: boolean,
  forceCloseAll = false,
  forceReason: TradeRecord['closeReason'] = 'CIRCUIT_BREAKER'
): { remaining: Position[]; closed: TradeRecord[] } {
  const remaining: Position[] = [];
  const closed: TradeRecord[] = [];
  const now = Date.now();

  for (const pos of positions) {
    if (pos.symbol !== symbol) {
      remaining.push(pos);
      continue;
    }

    const direction = pos.side === 'BUY' ? 1 : -1;
    const pnlUsd = roundTo((currentPrice - pos.entryPrice) * pos.quantity * direction, 2);
    const pnlPct = roundTo(
      pos.entryPrice > 0 ? (((currentPrice - pos.entryPrice) / pos.entryPrice) * 100) * direction : 0,
      2
    );

    const hitTakeProfit =
      autoTakeProfitEnabled &&
      ((pos.side === 'BUY' && currentPrice >= pos.takeProfit) ||
        (pos.side === 'SELL' && currentPrice <= pos.takeProfit));

    const hitStopLoss =
      (pos.side === 'BUY' && currentPrice <= pos.stopLoss) ||
      (pos.side === 'SELL' && currentPrice >= pos.stopLoss);

    if (forceCloseAll || hitTakeProfit || hitStopLoss) {
      const closeReason: TradeRecord['closeReason'] = forceCloseAll
        ? forceReason
        : hitTakeProfit
          ? 'TAKE_PROFIT'
          : 'STOP_LOSS';

      closed.push({
        id: `trd_${pos.id}_${now}`,
        symbol: pos.symbol,
        exchange: pos.exchange,
        side: pos.side,
        entryPrice: pos.entryPrice,
        exitPrice: roundTo(currentPrice, 2),
        quantity: pos.quantity,
        pnlUsd,
        pnlPct,
        openedAt: pos.openedAt,
        closedAt: now,
        closeReason,
        confidenceAtEntry: pos.confidenceAtEntry,
        riskScoreAtEntry: pos.riskScoreAtEntry,
        strategyNote:
          closeReason === 'TAKE_PROFIT'
            ? 'Target profit tercapai — posisi ditutup otomatis'
            : closeReason === 'STOP_LOSS'
              ? 'Batas Stop-Loss aktif — modal terlindungi'
              : 'Circuit breaker volatilitas menutup posisi otomatis',
      });
    } else {
      remaining.push({
        ...pos,
        currentPrice: roundTo(currentPrice, 2),
        unrealizedPnl: pnlUsd,
        unrealizedPnlPct: pnlPct,
      });
    }
  }

  return { remaining, closed };
}

/**
 * Self-learning adaptive weight optimizer: adjusts indicator weights smoothly
 * based on recent trade win-rate and market regime so the bot continuously optimizes strategy.
 */
export function adaptStrategyWeights(
  current: StrategyWeights,
  recentTrades: TradeRecord[],
  regime: TradeSignal['regime']
): { weights: StrategyWeights; summary: string } {
  const next = { ...current };
  const sample = recentTrades.slice(0, 12);
  const wins = sample.filter((t) => t.pnlUsd > 0).length;
  const winRate = sample.length > 0 ? wins / sample.length : 0.72;

  if (regime === 'trending_up' || regime === 'trending_down') {
    next.emaTrend = Math.min(0.34, current.emaTrend + 0.02);
    next.macdCross = Math.min(0.28, current.macdCross + 0.015);
    next.bollingerMeanRev = Math.max(0.08, current.bollingerMeanRev - 0.02);
  } else if (regime === 'ranging') {
    next.rsiMomentum = Math.min(0.3, current.rsiMomentum + 0.02);
    next.bollingerMeanRev = Math.min(0.24, current.bollingerMeanRev + 0.02);
    next.emaTrend = Math.max(0.14, current.emaTrend - 0.02);
  } else if (regime === 'volatile') {
    next.candlestickPattern = Math.min(0.24, current.candlestickPattern + 0.02);
    next.stochastic = Math.max(0.05, current.stochastic - 0.01);
  }

  // If recent win rate dipped below 65%, boost multi-confirmation candlestick & RSI weights
  if (sample.length >= 3 && winRate < 0.65) {
    next.candlestickPattern = Math.min(0.25, next.candlestickPattern + 0.02);
    next.rsiMomentum = Math.min(0.28, next.rsiMomentum + 0.015);
  }

  // Normalize weights to sum to 1.0
  const sum =
    next.emaTrend +
    next.rsiMomentum +
    next.macdCross +
    next.bollingerMeanRev +
    next.candlestickPattern +
    next.stochastic;

  const normalized: StrategyWeights = {
    emaTrend: roundTo(next.emaTrend / sum, 3),
    rsiMomentum: roundTo(next.rsiMomentum / sum, 3),
    macdCross: roundTo(next.macdCross / sum, 3),
    bollingerMeanRev: roundTo(next.bollingerMeanRev / sum, 3),
    candlestickPattern: roundTo(next.candlestickPattern / sum, 3),
    stochastic: roundTo(next.stochastic / sum, 3),
  };

  return {
    weights: normalized,
    summary: `Optimasi adaptif pada rezim ${regime.replace('_', ' ')} (win-rate sampel ${Math.round(winRate * 100)}%). Bobot EMA ${(normalized.emaTrend * 100).toFixed(1)}%, RSI ${(normalized.rsiMomentum * 100).toFixed(1)}%, Pola Candle ${(normalized.candlestickPattern * 100).toFixed(1)}%.`,
  };
}
