import { calculateEMA, calculateRSI, roundTo } from './indicators';
import type { Candle, Timeframe } from './types';

export interface TimeframeBias {
  timeframe: Timeframe;
  bias: 'bullish' | 'bearish' | 'neutral';
  rsi14: number;
  emaFast: number;
  emaSlow: number;
}

export interface MultiTimeframeSummary {
  biases: TimeframeBias[];
  alignedDirection: 'bullish' | 'bearish' | 'mixed';
  alignedCount: number;
  totalCount: number;
  summaryText: string;
}

const TIMEFRAME_MULTIPLIER: Record<Timeframe, number> = {
  '1m': 1,
  '5m': 1,
  '15m': 3,
  '1h': 6,
  '4h': 12,
};

/**
 * Aggregates base candles into higher-timeframe OHLCV bars deterministically.
 */
export function aggregateCandles(candles: Candle[], timeframe: Timeframe): Candle[] {
  const factor = TIMEFRAME_MULTIPLIER[timeframe] ?? 1;
  if (factor <= 1 || candles.length <= factor) {
    return candles;
  }

  const aggregated: Candle[] = [];
  for (let i = 0; i < candles.length; i += factor) {
    const chunk = candles.slice(i, i + factor);
    if (chunk.length === 0) continue;
    let high = -Infinity;
    let low = Infinity;
    let volume = 0;
    for (const c of chunk) {
      if (c.high > high) high = c.high;
      if (c.low < low) low = c.low;
      volume += c.volume;
    }
    aggregated.push({
      time: chunk[chunk.length - 1].time,
      open: chunk[0].open,
      high,
      low,
      close: chunk[chunk.length - 1].close,
      volume: roundTo(volume, 2),
    });
  }
  return aggregated;
}

/**
 * Evaluates directional trend alignment across 5m, 15m, 1h, and 4h timeframes
 * to prevent false breakouts on XAU/USD and Crypto pairs.
 */
export function computeMultiTimeframeAlignment(candles: Candle[]): MultiTimeframeSummary {
  const frames: Timeframe[] = ['5m', '15m', '1h', '4h'];
  const biases: TimeframeBias[] = frames.map((tf) => {
    const series = aggregateCandles(candles, tf);
    const closes = series.map((c) => c.close);
    if (closes.length < 3) {
      return {
        timeframe: tf,
        bias: 'neutral',
        rsi14: 50,
        emaFast: closes[closes.length - 1] ?? 0,
        emaSlow: closes[closes.length - 1] ?? 0,
      };
    }

    const fastArr = calculateEMA(closes, Math.min(7, closes.length));
    const slowArr = calculateEMA(closes, Math.min(18, closes.length));
    const rsiArr = calculateRSI(closes, Math.min(14, closes.length - 1));
    const last = closes.length - 1;
    const emaFast = roundTo(fastArr[last], 2);
    const emaSlow = roundTo(slowArr[last], 2);
    const rsi14 = roundTo(rsiArr[last], 1);

    const spreadPct = emaSlow > 0 ? ((emaFast - emaSlow) / emaSlow) * 100 : 0;
    let bias: TimeframeBias['bias'] = 'neutral';
    if (spreadPct > 0.03 && rsi14 >= 48) {
      bias = 'bullish';
    } else if (spreadPct < -0.03 && rsi14 <= 52) {
      bias = 'bearish';
    }

    return {
      timeframe: tf,
      bias,
      rsi14,
      emaFast,
      emaSlow,
    };
  });

  const bullCount = biases.filter((b) => b.bias === 'bullish').length;
  const bearCount = biases.filter((b) => b.bias === 'bearish').length;

  if (bullCount >= 3) {
    return {
      biases,
      alignedDirection: 'bullish',
      alignedCount: bullCount,
      totalCount: frames.length,
      summaryText: `${bullCount}/${frames.length} Timeframe Selaras Bullish`,
    };
  }
  if (bearCount >= 3) {
    return {
      biases,
      alignedDirection: 'bearish',
      alignedCount: bearCount,
      totalCount: frames.length,
      summaryText: `${bearCount}/${frames.length} Timeframe Selaras Bearish`,
    };
  }
  return {
    biases,
    alignedDirection: 'mixed',
    alignedCount: Math.max(bullCount, bearCount),
    totalCount: frames.length,
    summaryText: `Campuran (${bullCount} Bullish · ${bearCount} Bearish)`,
  };
}
