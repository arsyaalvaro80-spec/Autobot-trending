import type { Candle, CandlestickPatternMatch } from './types';

function bodySize(c: Candle): number {
  return Math.abs(c.close - c.open);
}

function fullRange(c: Candle): number {
  return Math.max(c.high - c.low, 1e-9);
}

function upperShadow(c: Candle): number {
  return c.high - Math.max(c.open, c.close);
}

function lowerShadow(c: Candle): number {
  return Math.min(c.open, c.close) - c.low;
}

function isBullish(c: Candle): boolean {
  return c.close > c.open;
}

function isBearish(c: Candle): boolean {
  return c.close < c.open;
}

/**
 * Detects classic institutional candlestick patterns on the trailing window of OHLC candles.
 * Designed for both XAU/USD spot precision and high-beta Crypto pairs.
 */
export function detectCandlestickPatterns(
  candles: Candle[],
  lookbackWindow = 12
): CandlestickPatternMatch[] {
  const matches: CandlestickPatternMatch[] = [];
  if (candles.length < 3) return matches;

  const startIdx = Math.max(2, candles.length - lookbackWindow);

  for (let i = startIdx; i < candles.length; i++) {
    const c0 = candles[i - 2];
    const c1 = candles[i - 1];
    const c2 = candles[i];

    const b1 = bodySize(c1);
    const b2 = bodySize(c2);
    const r2 = fullRange(c2);
    const u2 = upperShadow(c2);
    const l2 = lowerShadow(c2);

    // 1. Bullish Engulfing
    if (
      isBearish(c1) &&
      isBullish(c2) &&
      c2.open <= c1.close &&
      c2.close >= c1.open &&
      b2 > b1 * 1.05
    ) {
      matches.push({
        name: 'Bullish Engulfing',
        labelId: 'Bullish Engulfing (Pembalikan Naik)',
        direction: 'bullish',
        reliability: 88,
        candleIndex: i,
        time: c2.time,
        price: c2.close,
        description:
          'Candle hijau menelan penuh badan candle merah sebelumnya, menandakan tekanan beli institusional kuat.',
      });
    }

    // 2. Bearish Engulfing
    if (
      isBullish(c1) &&
      isBearish(c2) &&
      c2.open >= c1.close &&
      c2.close <= c1.open &&
      b2 > b1 * 1.05
    ) {
      matches.push({
        name: 'Bearish Engulfing',
        labelId: 'Bearish Engulfing (Pembalikan Turun)',
        direction: 'bearish',
        reliability: 88,
        candleIndex: i,
        time: c2.time,
        price: c2.close,
        description:
          'Candle merah menelan penuh badan candle hijau sebelumnya, mengonfirmasi distribusi jual kuat.',
      });
    }

    // 3. Hammer (bullish reversal at local pullback)
    if (
      b2 > 0 &&
      l2 >= b2 * 2.1 &&
      u2 <= b2 * 0.6 &&
      b2 / r2 <= 0.35 &&
      c1.close <= c0.close
    ) {
      matches.push({
        name: 'Hammer',
        labelId: 'Hammer (Penolakan Support)',
        direction: 'bullish',
        reliability: 82,
        candleIndex: i,
        time: c2.time,
        price: c2.close,
        description:
          'Ekor bawah panjang menolak penurunan harga lebih lanjut, mengindikasikan penyerapan likuiditas di support.',
      });
    }

    // 4. Shooting Star (bearish rejection at local high)
    if (
      b2 > 0 &&
      u2 >= b2 * 2.1 &&
      l2 <= b2 * 0.6 &&
      b2 / r2 <= 0.35 &&
      c1.close >= c0.close
    ) {
      matches.push({
        name: 'Shooting Star',
        labelId: 'Shooting Star (Penolakan Resistance)',
        direction: 'bearish',
        reliability: 83,
        candleIndex: i,
        time: c2.time,
        price: c2.close,
        description:
          'Ekor atas panjang menolak kenaikan di area resistance, sinyal kelelahan buyer.',
      });
    }

    // 5. Morning Star (3-candle bullish reversal)
    const b0 = bodySize(c0);
    const r0 = fullRange(c0);
    const r1 = fullRange(c1);
    if (
      isBearish(c0) &&
      b0 / r0 >= 0.45 &&
      b1 / r1 <= 0.3 &&
      isBullish(c2) &&
      b2 / r2 >= 0.45 &&
      c2.close >= c0.open - b0 * 0.5
    ) {
      matches.push({
        name: 'Morning Star',
        labelId: 'Morning Star (Konfirmasi Reversal Naik)',
        direction: 'bullish',
        reliability: 91,
        candleIndex: i,
        time: c2.time,
        price: c2.close,
        description:
          'Pola 3 candle pembalikan naik dengan candle tengah indecisive diikuti ekspansi bullish kuat.',
      });
    }

    // 6. Evening Star (3-candle bearish reversal)
    if (
      isBullish(c0) &&
      b0 / r0 >= 0.45 &&
      b1 / r1 <= 0.3 &&
      isBearish(c2) &&
      b2 / r2 >= 0.45 &&
      c2.close <= c0.open + b0 * 0.5
    ) {
      matches.push({
        name: 'Evening Star',
        labelId: 'Evening Star (Konfirmasi Reversal Turun)',
        direction: 'bearish',
        reliability: 91,
        candleIndex: i,
        time: c2.time,
        price: c2.close,
        description:
          'Pola 3 candle pembalikan turun yang mengonfirmasi puncak momentum beli.',
      });
    }

    // 7. Three White Soldiers (strong continuation)
    if (
      isBullish(c0) &&
      isBullish(c1) &&
      isBullish(c2) &&
      c1.close > c0.close &&
      c2.close > c1.close &&
      b0 / r0 >= 0.55 &&
      b1 / r1 >= 0.55 &&
      b2 / r2 >= 0.55
    ) {
      matches.push({
        name: 'Three White Soldiers',
        labelId: 'Three White Soldiers (Ekspansi Bullish)',
        direction: 'bullish',
        reliability: 86,
        candleIndex: i,
        time: c2.time,
        price: c2.close,
        description:
          'Tiga candle bullish beruntun dengan badan solid menandakan tren naik berkelanjutan.',
      });
    }

    // 8. Doji (indecision / potential pivot)
    if (b2 / r2 <= 0.08 && r2 > 0) {
      matches.push({
        name: 'Doji',
        labelId: 'Doji (Keseimbangan Pasar)',
        direction: 'neutral',
        reliability: 70,
        candleIndex: i,
        time: c2.time,
        price: c2.close,
        description:
          'Harga pembukaan dan penutupan hampir sama, menandakan fase tunggu sebelum breakout arah baru.',
      });
    }
  }

  return matches.sort((a, b) => b.candleIndex - a.candleIndex);
}
