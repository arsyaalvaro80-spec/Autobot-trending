import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateATR,
  calculateBollingerBands,
  calculateEMA,
  calculateMACD,
  calculateRSI,
  computeIndicatorSnapshot,
} from './indicators';
import { detectCandlestickPatterns } from './patterns';
import {
  adaptStrategyWeights,
  DEFAULT_RISK_CONFIG,
  DEFAULT_STRATEGY_WEIGHTS,
  detectMarketAnomaly,
  evaluateOpenPositions,
  evaluateTradeSignal,
} from './signals';
import { generateHistoricalCandles, runBacktest } from './backtest';
import { decryptCredential, encryptCredential, maskApiKey } from './cryptoVault';
import { aggregateCandles, computeMultiTimeframeAlignment } from './timeframe';
import type { Candle, Position } from './types';

test('calculateEMA and calculateRSI produce mathematically consistent directional readings', () => {
  const rising = Array.from({ length: 30 }, (_, i) => 100 + i * 2);
  const ema9 = calculateEMA(rising, 9);
  const ema21 = calculateEMA(rising, 21);
  assert.ok(ema9[ema9.length - 1] > ema21[ema21.length - 1], 'Fast EMA must lead slow EMA in uptrend');

  const rsiRising = calculateRSI(rising, 14);
  assert.ok(rsiRising[rsiRising.length - 1] > 80, 'Monotonic rising closes must have high RSI');

  const falling = Array.from({ length: 30 }, (_, i) => 200 - i * 2);
  const rsiFalling = calculateRSI(falling, 14);
  assert.ok(rsiFalling[rsiFalling.length - 1] < 20, 'Monotonic falling closes must have low RSI');
});

test('MACD and Bollinger Bands compute valid envelopes and histogram', () => {
  const candles = generateHistoricalCandles('XAU/USD', 80);
  const closes = candles.map((c) => c.close);
  const macd = calculateMACD(closes);
  const bb = calculateBollingerBands(closes, 20, 2);
  const last = closes.length - 1;

  assert.equal(macd.line.length, closes.length);
  assert.ok(bb.upper[last] >= bb.middle[last]);
  assert.ok(bb.middle[last] >= bb.lower[last]);

  const snap = computeIndicatorSnapshot(candles);
  assert.ok(snap.atr14 > 0);
  assert.ok(snap.rsi14 >= 0 && snap.rsi14 <= 100);
});

test('detectCandlestickPatterns identifies Bullish Engulfing and Hammer accurately', () => {
  const candles: Candle[] = [
    { time: 1, open: 110, high: 111, low: 104, close: 105, volume: 100 },
    { time: 2, open: 105, high: 106, low: 99, close: 100, volume: 120 },
    // Bullish Engulfing candle
    { time: 3, open: 99, high: 108, low: 98.5, close: 107, volume: 220 },
    // Pullback followed by Hammer
    { time: 4, open: 107, high: 107.5, low: 102, close: 103, volume: 140 },
    { time: 5, open: 102, high: 103.5, low: 95, close: 103, volume: 190 },
  ];

  const patterns = detectCandlestickPatterns(candles, 10);
  const names = patterns.map((p) => p.name);
  assert.ok(names.includes('Bullish Engulfing'), `Expected Bullish Engulfing in ${names.join(', ')}`);
  assert.ok(names.includes('Hammer'), `Expected Hammer in ${names.join(', ')}`);
});

test('detectMarketAnomaly triggers automatic circuit breaker on sharp volatility spike', () => {
  const calmCandles = generateHistoricalCandles('XAU/USD', 40);
  const atr = calculateATR(calmCandles, 14);
  const lastAtr = atr[atr.length - 1];
  const last = calmCandles[calmCandles.length - 1];

  // Inject extreme flash-crash candle (> 4x ATR and > 3% drop)
  const spikeCandle: Candle = {
    time: last.time + 60_000,
    open: last.close,
    high: last.close * 1.004,
    low: last.close * 0.96,
    close: last.close * 0.965,
    volume: last.volume * 5,
  };

  const anomaly = detectMarketAnomaly([...calmCandles, spikeCandle], lastAtr, 2.8);
  assert.equal(anomaly.isAnomaly, true);
  assert.equal(anomaly.severity, 'critical');
  assert.equal(anomaly.shouldHaltTrading, true);

  const signal = evaluateTradeSignal('XAU/USD', [...calmCandles, spikeCandle], DEFAULT_RISK_CONFIG);
  assert.equal(signal.action, 'HOLD');
  assert.equal(signal.meetsStrictGate, false);
});

test('strict >=90% confidence & low-risk gate approves aligned low-volatility trend and blocks risky setups', () => {
  // Construct low-volatility uptrend with healthy pullback into EMA21 then fresh Bullish Engulfing
  const candles: Candle[] = [];
  let price = 2700;
  for (let i = 0; i < 65; i++) {
    const open = price;
    let delta = 0.65;
    if (i >= 54 && i <= 62) {
      // Healthy pullback cooling RSI & Bollinger Band
      delta = -0.55;
    } else if (i === 63) {
      delta = -0.8;
    } else if (i === 64) {
      // Bullish Engulfing continuation
      delta = 1.6;
    }
    const close = open + delta;
    candles.push({
      time: 1_700_000_000_000 + i * 60_000,
      open,
      high: Math.max(open, close) + 0.35,
      low: Math.min(open, close) - 0.35,
      close,
      volume: 1000 + i * 5,
    });
    price = close;
  }

  const strictSignal = evaluateTradeSignal('XAU/USD', candles, {
    ...DEFAULT_RISK_CONFIG,
    minConfidencePct: 90,
    maxRiskScore: 30,
  });

  assert.equal(strictSignal.action, 'BUY');
  assert.ok(strictSignal.confidence >= 85, `Expected strong confidence, got ${strictSignal.confidence}`);
  assert.ok(strictSignal.takeProfit > strictSignal.entryPrice);
  assert.ok(strictSignal.stopLoss < strictSignal.entryPrice);

  // Setting impossible minConfidence 99 must fail the strict gate
  const impossibleGate = evaluateTradeSignal('XAU/USD', candles, {
    ...DEFAULT_RISK_CONFIG,
    minConfidencePct: 99,
  });
  assert.equal(impossibleGate.meetsStrictGate, false);
});

test('evaluateOpenPositions closes positions automatically at Take-Profit and Stop-Loss targets', () => {
  const positions: Position[] = [
    {
      id: 'p1',
      symbol: 'XAU/USD',
      exchange: 'oanda',
      side: 'BUY',
      entryPrice: 2740,
      currentPrice: 2740,
      quantity: 2,
      notionalUsd: 5480,
      stopLoss: 2720,
      takeProfit: 2780,
      unrealizedPnl: 0,
      unrealizedPnlPct: 0,
      openedAt: Date.now() - 60_000,
      confidenceAtEntry: 93,
      riskScoreAtEntry: 18,
    },
  ];

  // Hit Take Profit
  const tpRes = evaluateOpenPositions(positions, 'XAU/USD', 2785, true);
  assert.equal(tpRes.remaining.length, 0);
  assert.equal(tpRes.closed.length, 1);
  assert.equal(tpRes.closed[0].closeReason, 'TAKE_PROFIT');
  assert.equal(tpRes.closed[0].pnlUsd, 90);

  // Hit Stop Loss
  const slRes = evaluateOpenPositions(positions, 'XAU/USD', 2715, true);
  assert.equal(slRes.remaining.length, 0);
  assert.equal(slRes.closed.length, 1);
  assert.equal(slRes.closed[0].closeReason, 'STOP_LOSS');
  assert.equal(slRes.closed[0].pnlUsd, -50);
});

test('adaptStrategyWeights normalizes weights to 1.0 across regimes', () => {
  const { weights, summary } = adaptStrategyWeights(DEFAULT_STRATEGY_WEIGHTS, [], 'trending_up');
  const total =
    weights.emaTrend +
    weights.rsiMomentum +
    weights.macdCross +
    weights.bollingerMeanRev +
    weights.candlestickPattern +
    weights.stochastic;
  assert.ok(Math.abs(total - 1) < 0.02, `Expected weights to sum near 1, got ${total}`);
  assert.ok(summary.length > 10);
});

test('runBacktest produces deterministic equity curve and valid risk metrics', () => {
  const params = {
    symbol: 'XAU/USD' as const,
    initialCapital: 10000,
    candlesCount: 180,
    minConfidencePct: 90,
    maxRiskScore: 25,
    stopLossPct: 0.65,
    takeProfitPct: 1.95,
    positionSizePct: 5,
    rsiOversold: 32,
    rsiOverbought: 68,
  };

  const run1 = runBacktest(params);
  const run2 = runBacktest(params);

  assert.equal(run1.finalEquity, run2.finalEquity);
  assert.equal(run1.totalTrades, run2.totalTrades);
  assert.ok(run1.equityCurve.length > 100);
  assert.ok(run1.maxDrawdownPct >= 0);
});

test('AES-256-GCM vault encrypts, decrypts, and safely masks exchange API keys', () => {
  const secret = 'ex_live_9876543210abcdef_secret';
  const encrypted = encryptCredential(secret, 'unit-test-master-secret');
  assert.notEqual(encrypted.ciphertextHex, secret);
  assert.equal(encrypted.algorithm, 'AES-256-GCM');

  const decrypted = decryptCredential(encrypted, 'unit-test-master-secret');
  assert.equal(decrypted, secret);

  const masked = maskApiKey('BINANCE_KEY_ABCDEF1234');
  assert.equal(masked, 'BINA••••••••1234');
});

test('aggregateCandles accurately aggregates OHLCV bars for 15m, 1h, and 4h timeframes', () => {
  const baseCandles: Candle[] = Array.from({ length: 12 }, (_, i) => ({
    time: 1_700_000_000_000 + i * 60_000,
    open: 100 + i,
    high: 105 + i,
    low: 98 + i,
    close: 101 + i,
    volume: 10,
  }));

  const tf5m = aggregateCandles(baseCandles, '5m');
  assert.equal(tf5m.length, 12);

  const tf15m = aggregateCandles(baseCandles, '15m');
  assert.equal(tf15m.length, 4);
  assert.equal(tf15m[0].open, baseCandles[0].open);
  assert.equal(tf15m[0].close, baseCandles[2].close);
  assert.equal(tf15m[0].high, Math.max(baseCandles[0].high, baseCandles[1].high, baseCandles[2].high));
  assert.equal(tf15m[0].low, Math.min(baseCandles[0].low, baseCandles[1].low, baseCandles[2].low));
  assert.equal(tf15m[0].volume, 30);

  const tf1h = aggregateCandles(baseCandles, '1h');
  assert.equal(tf1h.length, 2);
  assert.equal(tf1h[1].volume, 60);
});

test('computeMultiTimeframeAlignment detects aligned bullish and bearish trends across 5m-4h', () => {
  const rising: Candle[] = Array.from({ length: 96 }, (_, i) => {
    const open = 2600 + i * 1.4;
    const close = open + 1.2;
    return {
      time: 1_700_000_000_000 + i * 60_000,
      open,
      high: close + 0.5,
      low: open - 0.5,
      close,
      volume: 500,
    };
  });

  const bullSummary = computeMultiTimeframeAlignment(rising);
  assert.equal(bullSummary.biases.length, 4);
  assert.equal(bullSummary.alignedDirection, 'bullish');
  assert.ok(bullSummary.alignedCount >= 3);

  const falling: Candle[] = Array.from({ length: 96 }, (_, i) => {
    const open = 2900 - i * 1.4;
    const close = open - 1.2;
    return {
      time: 1_700_000_000_000 + i * 60_000,
      open,
      high: open + 0.5,
      low: close - 0.5,
      close,
      volume: 500,
    };
  });

  const bearSummary = computeMultiTimeframeAlignment(falling);
  assert.equal(bearSummary.alignedDirection, 'bearish');
  assert.ok(bearSummary.alignedCount >= 3);
});

