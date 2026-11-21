import type { Candle, TechnicalIndicators } from './types';

export function calculateSMA(values: number[], period: number): number[] {
  const result: number[] = [];
  if (values.length === 0 || period <= 0) return result;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) {
      sum -= values[i - period];
    }
    if (i >= period - 1) {
      result.push(sum / period);
    } else {
      result.push(sum / (i + 1));
    }
  }
  return result;
}

export function calculateEMA(values: number[], period: number): number[] {
  const result: number[] = [];
  if (values.length === 0 || period <= 0) return result;
  const k = 2 / (period + 1);
  let ema = values[0];
  result.push(ema);
  for (let i = 1; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
    result.push(ema);
  }
  return result;
}

export function calculateRSI(closes: number[], period = 14): number[] {
  if (closes.length === 0) return [];
  if (closes.length === 1) return [50];

  const rsi: number[] = [50];
  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;

    if (i <= period) {
      avgGain = (avgGain * (i - 1) + gain) / i;
      avgLoss = (avgLoss * (i - 1) + loss) / i;
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
    }

    if (avgLoss === 0 && avgGain === 0) {
      rsi.push(50);
    } else if (avgLoss === 0) {
      rsi.push(100);
    } else {
      const rs = avgGain / avgLoss;
      rsi.push(100 - 100 / (1 + rs));
    }
  }
  return rsi;
}

export function calculateMACD(
  closes: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9
): { line: number[]; signal: number[]; histogram: number[] } {
  if (closes.length === 0) return { line: [], signal: [], histogram: [] };
  const fast = calculateEMA(closes, fastPeriod);
  const slow = calculateEMA(closes, slowPeriod);
  const line = fast.map((f, idx) => f - slow[idx]);
  const signal = calculateEMA(line, signalPeriod);
  const histogram = line.map((l, idx) => l - signal[idx]);
  return { line, signal, histogram };
}

export function calculateBollingerBands(
  closes: number[],
  period = 20,
  stdDevMultiplier = 2
): { upper: number[]; middle: number[]; lower: number[]; bandwidthPct: number[] } {
  const middle = calculateSMA(closes, period);
  const upper: number[] = [];
  const lower: number[] = [];
  const bandwidthPct: number[] = [];

  for (let i = 0; i < closes.length; i++) {
    const start = Math.max(0, i - period + 1);
    const slice = closes.slice(start, i + 1);
    const mean = middle[i];
    const variance =
      slice.reduce((acc, val) => acc + (val - mean) * (val - mean), 0) / slice.length;
    const std = Math.sqrt(variance);
    const u = mean + stdDevMultiplier * std;
    const l = mean - stdDevMultiplier * std;
    upper.push(u);
    lower.push(l);
    bandwidthPct.push(mean > 0 ? ((u - l) / mean) * 100 : 0);
  }

  return { upper, middle, lower, bandwidthPct };
}

export function calculateATR(candles: Candle[], period = 14): number[] {
  if (candles.length === 0) return [];
  const trs: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (i === 0) {
      trs.push(c.high - c.low);
    } else {
      const prevClose = candles[i - 1].close;
      const tr = Math.max(
        c.high - c.low,
        Math.abs(c.high - prevClose),
        Math.abs(c.low - prevClose)
      );
      trs.push(tr);
    }
  }
  const atr: number[] = [];
  let current = trs[0];
  atr.push(current);
  for (let i = 1; i < trs.length; i++) {
    if (i < period) {
      current = (current * i + trs[i]) / (i + 1);
    } else {
      current = (current * (period - 1) + trs[i]) / period;
    }
    atr.push(current);
  }
  return atr;
}

export function calculateStochastic(
  candles: Candle[],
  kPeriod = 14,
  dPeriod = 3
): { k: number[]; d: number[] } {
  const kValues: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    const start = Math.max(0, i - kPeriod + 1);
    let highestHigh = -Infinity;
    let lowestLow = Infinity;
    for (let j = start; j <= i; j++) {
      if (candles[j].high > highestHigh) highestHigh = candles[j].high;
      if (candles[j].low < lowestLow) lowestLow = candles[j].low;
    }
    const range = highestHigh - lowestLow;
    if (range <= 0) {
      kValues.push(50);
    } else {
      kValues.push(((candles[i].close - lowestLow) / range) * 100);
    }
  }
  const dValues = calculateSMA(kValues, dPeriod);
  return { k: kValues, d: dValues };
}

export function computeIndicatorSnapshot(candles: Candle[]): TechnicalIndicators {
  if (candles.length === 0) {
    return {
      ema9: 0,
      ema21: 0,
      ema50: 0,
      sma20: 0,
      rsi14: 50,
      macd: { line: 0, signal: 0, histogram: 0 },
      bollinger: { upper: 0, middle: 0, lower: 0, bandwidthPct: 0 },
      atr14: 0,
      atrPct: 0,
      stochastic: { k: 50, d: 50 },
    };
  }

  const closes = candles.map((c) => c.close);
  const lastIdx = closes.length - 1;
  const lastClose = closes[lastIdx];

  const ema9Arr = calculateEMA(closes, 9);
  const ema21Arr = calculateEMA(closes, 21);
  const ema50Arr = calculateEMA(closes, 50);
  const sma20Arr = calculateSMA(closes, 20);
  const rsiArr = calculateRSI(closes, 14);
  const macd = calculateMACD(closes, 12, 26, 9);
  const bb = calculateBollingerBands(closes, 20, 2);
  const atrArr = calculateATR(candles, 14);
  const stoch = calculateStochastic(candles, 14, 3);

  const atr14 = atrArr[lastIdx] ?? 0;

  return {
    ema9: roundTo(ema9Arr[lastIdx], 4),
    ema21: roundTo(ema21Arr[lastIdx], 4),
    ema50: roundTo(ema50Arr[lastIdx], 4),
    sma20: roundTo(sma20Arr[lastIdx], 4),
    rsi14: roundTo(rsiArr[lastIdx], 2),
    macd: {
      line: roundTo(macd.line[lastIdx], 4),
      signal: roundTo(macd.signal[lastIdx], 4),
      histogram: roundTo(macd.histogram[lastIdx], 4),
    },
    bollinger: {
      upper: roundTo(bb.upper[lastIdx], 4),
      middle: roundTo(bb.middle[lastIdx], 4),
      lower: roundTo(bb.lower[lastIdx], 4),
      bandwidthPct: roundTo(bb.bandwidthPct[lastIdx], 3),
    },
    atr14: roundTo(atr14, 4),
    atrPct: lastClose > 0 ? roundTo((atr14 / lastClose) * 100, 3) : 0,
    stochastic: {
      k: roundTo(stoch.k[lastIdx], 2),
      d: roundTo(stoch.d[lastIdx], 2),
    },
  };
}

export function roundTo(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return 0;
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}
