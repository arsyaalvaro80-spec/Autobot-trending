import { useMemo, useState } from 'react';
import {
  calculateBollingerBands,
  calculateEMA,
  calculateRSI,
} from '../engine/indicators';
import { aggregateCandles } from '../engine/timeframe';
import type {
  Candle,
  CandlestickPatternMatch,
  MarketSymbol,
  Timeframe,
  TradeSignal,
} from '../engine/types';
import { formatPrice, formatShortTime } from '../types/app';

const TIMEFRAMES: Timeframe[] = ['5m', '15m', '1h', '4h'];

interface CandlestickChartProps {
  symbol: MarketSymbol;
  candles: Candle[];
  signal: TradeSignal;
  patterns: CandlestickPatternMatch[];
}

export function CandlestickChart({
  symbol,
  candles,
  signal,
  patterns,
}: CandlestickChartProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>('5m');
  const [showEma, setShowEma] = useState(true);
  const [showBollinger, setShowBollinger] = useState(true);
  const [showTargets, setShowTargets] = useState(true);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const visibleCount = 64;

  const computed = useMemo(() => {
    const series = aggregateCandles(candles, timeframe);
    const closes = series.map((c) => c.close);
    const ema9All = calculateEMA(closes, 9);
    const ema21All = calculateEMA(closes, 21);
    const ema50All = calculateEMA(closes, 50);
    const bbAll = calculateBollingerBands(closes, 20, 2);
    const rsiAll = calculateRSI(closes, 14);

    const startOffset = Math.max(0, series.length - visibleCount);
    const slice = series.slice(startOffset);

    return {
      startOffset,
      slice,
      ema9: ema9All.slice(startOffset),
      ema21: ema21All.slice(startOffset),
      ema50: ema50All.slice(startOffset),
      bbUpper: bbAll.upper.slice(startOffset),
      bbLower: bbAll.lower.slice(startOffset),
      rsi: rsiAll.slice(startOffset),
    };
  }, [candles, timeframe]);

  const width = 920;
  const priceHeight = 320;
  const rsiHeight = 92;
  const padLeft = 14;
  const padRight = 76;
  const padTop = 18;
  const padBottom = 26;
  const plotW = width - padLeft - padRight;
  const plotH = priceHeight - padTop - padBottom;

  const { minPrice, maxPrice, maxVol } = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    let mv = 1;
    for (let i = 0; i < computed.slice.length; i++) {
      const c = computed.slice[i];
      if (c.low < min) min = c.low;
      if (c.high > max) max = c.high;
      if (showBollinger) {
        if (computed.bbLower[i] < min) min = computed.bbLower[i];
        if (computed.bbUpper[i] > max) max = computed.bbUpper[i];
      }
      if (c.volume > mv) mv = c.volume;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
      return { minPrice: 0, maxPrice: 100, maxVol: 1 };
    }
    const pad = (max - min) * 0.14;
    return { minPrice: min - pad, maxPrice: max + pad, maxVol: mv };
  }, [computed, showBollinger]);

  const xFor = (i: number) => {
    const count = Math.max(1, computed.slice.length);
    return padLeft + ((i + 0.5) / count) * plotW;
  };

  const yFor = (price: number) => {
    const span = Math.max(maxPrice - minPrice, 1e-6);
    return padTop + ((maxPrice - price) / span) * plotH;
  };

  const clampY = (y: number) => Math.max(padTop + 10, Math.min(padTop + plotH - 10, y));

  const yRsiFor = (val: number) => {
    const top = 12;
    const h = rsiHeight - 24;
    return top + ((100 - Math.min(100, Math.max(0, val))) / 100) * h;
  };

  const buildPolyline = (values: number[]) =>
    values.map((v, i) => `${xFor(i).toFixed(1)},${yFor(v).toFixed(1)}`).join(' ');

  const buildRsiPolyline = (values: number[]) =>
    values.map((v, i) => `${xFor(i).toFixed(1)},${yRsiFor(v).toFixed(1)}`).join(' ');

  const stepX = plotW / Math.max(1, computed.slice.length);
  const candleW = Math.max(3, Math.min(10, stepX * 0.62));

  const gridLevels = 5;
  const priceTicks = Array.from({ length: gridLevels }, (_, idx) => {
    const ratio = idx / (gridLevels - 1);
    const val = maxPrice - ratio * (maxPrice - minPrice);
    return { val, y: padTop + ratio * plotH };
  });

  const activeIndex =
    hoverIdx !== null && hoverIdx >= 0 && hoverIdx < computed.slice.length
      ? hoverIdx
      : computed.slice.length - 1;
  const inspectedCandle = computed.slice[activeIndex];
  const inspectedRsi = computed.rsi[activeIndex] ?? 50;

  const visiblePatterns =
    timeframe === '5m'
      ? patterns.filter((p) => p.candleIndex >= computed.startOffset).slice(0, 4)
      : [];

  const tpY = clampY(yFor(signal.takeProfit));
  const slY = clampY(yFor(signal.stopLoss));
  const tpOutOfBounds = signal.takeProfit > maxPrice || signal.takeProfit < minPrice;
  const slOutOfBounds = signal.stopLoss > maxPrice || signal.stopLoss < minPrice;

  return (
    <div className="bg-white dark:bg-[#11161D] border border-slate-200 dark:border-slate-800/90 rounded-lg overflow-hidden">
      {/* Chart Control Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-800/90">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-mono tabular-nums">
          <span className="font-display font-semibold text-sm text-slate-900 dark:text-slate-100">
            {symbol}
          </span>
          {inspectedCandle && (
            <>
              <span className="text-slate-400" aria-hidden="true">·</span>
              <span className="text-slate-500 dark:text-slate-400">
                O <strong className="text-slate-800 dark:text-slate-200">{formatPrice(symbol, inspectedCandle.open)}</strong>
              </span>
              <span className="text-slate-500 dark:text-slate-400">
                H <strong className="text-emerald-600 dark:text-emerald-400">{formatPrice(symbol, inspectedCandle.high)}</strong>
              </span>
              <span className="text-slate-500 dark:text-slate-400">
                L <strong className="text-rose-600 dark:text-rose-400">{formatPrice(symbol, inspectedCandle.low)}</strong>
              </span>
              <span className="text-slate-500 dark:text-slate-400">
                C <strong className="text-slate-900 dark:text-white">{formatPrice(symbol, inspectedCandle.close)}</strong>
              </span>
              <span className="hidden sm:inline text-slate-400" aria-hidden="true">·</span>
              <span className="hidden sm:inline text-slate-500 dark:text-slate-400">
                {formatShortTime(inspectedCandle.time)}
              </span>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div
            className="flex items-center gap-0.5 pr-2 border-r border-slate-200 dark:border-slate-800"
            role="group"
            aria-label="Pilih timeframe grafik"
          >
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => {
                  setTimeframe(tf);
                  setHoverIdx(null);
                }}
                aria-pressed={timeframe === tf}
                className={`px-2 py-1 text-xs font-mono font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  timeframe === tf
                    ? 'bg-slate-900 dark:bg-amber-600 text-white'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1" role="group" aria-label="Overlay indikator grafik">
            <button
              type="button"
              onClick={() => setShowEma((v) => !v)}
              className={`px-2 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                showEma
                  ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              EMA
            </button>
            <button
              type="button"
              onClick={() => setShowBollinger((v) => !v)}
              className={`px-2 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                showBollinger
                  ? 'bg-sky-500/15 text-sky-700 dark:text-sky-300'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              BB
            </button>
            <button
              type="button"
              onClick={() => setShowTargets((v) => !v)}
              className={`px-2 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                showTargets
                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              TP / SL
            </button>
          </div>
        </div>
      </div>

      {/* Main Price + Candlestick SVG (cleanly scrollable on narrow phones) */}
      <div className="relative px-2 pt-2">
        <div className="overflow-x-auto">
          <div className="min-w-[560px]">
            <svg
              data-testid="candlestick-chart-svg"
              viewBox={`0 0 ${width} ${priceHeight}`}
              className="w-full h-auto block select-none"
              role="img"
              aria-label={`Grafik candlestick real-time ${symbol}`}
              onMouseLeave={() => setHoverIdx(null)}
            >
              {/* Horizontal grid lines */}
              {priceTicks.map((tick, idx) => (
                <g key={idx}>
                  <line
                    x1={padLeft}
                    y1={tick.y}
                    x2={width - padRight}
                    y2={tick.y}
                    stroke="currentColor"
                    className="text-slate-200 dark:text-slate-800/80"
                    strokeWidth="1"
                  />
                  <text
                    x={width - padRight + 8}
                    y={tick.y + 4}
                    className="fill-slate-500 dark:fill-slate-400 font-mono text-[11px]"
                  >
                    {formatPrice(symbol, tick.val)}
                  </text>
                </g>
              ))}

              {/* Bollinger Bands Envelope */}
              {showBollinger && computed.bbUpper.length > 1 && (
                <>
                  <polyline
                    fill="none"
                    stroke="#38BDF8"
                    strokeOpacity="0.45"
                    strokeWidth="1"
                    strokeDasharray="3 3"
                    points={buildPolyline(computed.bbUpper)}
                  />
                  <polyline
                    fill="none"
                    stroke="#38BDF8"
                    strokeOpacity="0.45"
                    strokeWidth="1"
                    strokeDasharray="3 3"
                    points={buildPolyline(computed.bbLower)}
                  />
                </>
              )}

              {/* Volume Histogram at bottom 18% of plot */}
              {computed.slice.map((c, i) => {
                const x = xFor(i);
                const vh = (c.volume / maxVol) * (plotH * 0.18);
                const isUp = c.close >= c.open;
                return (
                  <rect
                    key={`v-${c.time}`}
                    x={x - candleW / 2}
                    y={padTop + plotH - vh}
                    width={candleW}
                    height={Math.max(1, vh)}
                    fill={isUp ? '#16A34A' : '#DC2626'}
                    opacity="0.16"
                  />
                );
              })}

              {/* Auto Take-Profit & Stop-Loss reference lines */}
              {showTargets && signal.entryPrice > 0 && (
                <>
                  <line
                    x1={padLeft}
                    y1={tpY}
                    x2={width - padRight}
                    y2={tpY}
                    stroke="#22C55E"
                    strokeWidth="1"
                    strokeDasharray="5 4"
                    opacity={tpOutOfBounds ? '0.45' : '0.8'}
                  />
                  <rect
                    x={padLeft + 4}
                    y={tpY - 12}
                    width={116}
                    height={15}
                    rx="2"
                    className="fill-white/90 dark:fill-[#11161D]/90"
                  />
                  <text
                    x={padLeft + 8}
                    y={tpY - 1}
                    className="fill-emerald-500 font-mono text-[10px] font-semibold"
                  >
                    TP {formatPrice(symbol, signal.takeProfit)}{tpOutOfBounds ? (signal.takeProfit > maxPrice ? ' ↑' : ' ↓') : ''}
                  </text>

                  <line
                    x1={padLeft}
                    y1={slY}
                    x2={width - padRight}
                    y2={slY}
                    stroke="#EF4444"
                    strokeWidth="1"
                    strokeDasharray="5 4"
                    opacity={slOutOfBounds ? '0.45' : '0.8'}
                  />
                  <rect
                    x={padLeft + 4}
                    y={slY + 2}
                    width={116}
                    height={15}
                    rx="2"
                    className="fill-white/90 dark:fill-[#11161D]/90"
                  />
                  <text
                    x={padLeft + 8}
                    y={slY + 13}
                    className="fill-rose-500 font-mono text-[10px] font-semibold"
                  >
                    SL {formatPrice(symbol, signal.stopLoss)}{slOutOfBounds ? (signal.stopLoss > maxPrice ? ' ↑' : ' ↓') : ''}
                  </text>
                </>
              )}

          {/* Candles */}
          {computed.slice.map((c, i) => {
            const x = xFor(i);
            const isUp = c.close >= c.open;
            const yHigh = yFor(c.high);
            const yLow = yFor(c.low);
            const yOpen = yFor(c.open);
            const yClose = yFor(c.close);
            const bodyTop = Math.min(yOpen, yClose);
            const bodyH = Math.max(1.5, Math.abs(yClose - yOpen));
            const color = isUp ? '#16A34A' : '#DC2626';

            return (
              <g key={c.time}>
                <line x1={x} y1={yHigh} x2={x} y2={yLow} stroke={color} strokeWidth="1.2" />
                <rect
                  x={x - candleW / 2}
                  y={bodyTop}
                  width={candleW}
                  height={bodyH}
                  fill={color}
                  rx="0.5"
                />
                {/* Invisible hit column for smooth hover */}
                <rect
                  x={x - stepX / 2}
                  y={padTop}
                  width={stepX}
                  height={plotH}
                  fill="transparent"
                  onMouseEnter={() => setHoverIdx(i)}
                />
              </g>
            );
          })}

          {/* EMA Overlays */}
          {showEma && computed.ema9.length > 1 && (
            <>
              <polyline
                fill="none"
                stroke="#F59E0B"
                strokeWidth="1.4"
                points={buildPolyline(computed.ema9)}
              />
              <polyline
                fill="none"
                stroke="#38BDF8"
                strokeWidth="1.3"
                points={buildPolyline(computed.ema21)}
              />
              <polyline
                fill="none"
                stroke="#A78BFA"
                strokeWidth="1.2"
                strokeOpacity="0.85"
                points={buildPolyline(computed.ema50)}
              />
            </>
          )}

          {/* Candlestick Pattern Annotations */}
          {visiblePatterns.map((p) => {
            const localIdx = p.candleIndex - computed.startOffset;
            const candle = computed.slice[localIdx];
            if (!candle) return null;
            const x = xFor(localIdx);
            const y =
              p.direction === 'bullish'
                ? Math.min(padTop + plotH - 8, yFor(candle.low) + 14)
                : Math.max(padTop + 12, yFor(candle.high) - 10);
            const fillColor =
              p.direction === 'bullish'
                ? '#22C55E'
                : p.direction === 'bearish'
                  ? '#EF4444'
                  : '#F59E0B';
            return (
              <g key={`${p.name}-${p.candleIndex}`}>
                <circle cx={x} cy={p.direction === 'bullish' ? yFor(candle.low) + 5 : yFor(candle.high) - 5} r="2.8" fill={fillColor} />
                <text
                  x={x}
                  y={y}
                  textAnchor="middle"
                  fill={fillColor}
                  className="font-mono text-[9px] font-semibold"
                >
                  {p.name}
                </text>
              </g>
            );
          })}

          {/* Crosshair on hover */}
          {hoverIdx !== null && inspectedCandle && (
            <g pointerEvents="none">
              <line
                x1={xFor(activeIndex)}
                y1={padTop}
                x2={xFor(activeIndex)}
                y2={padTop + plotH}
                stroke="#94A3B8"
                strokeWidth="1"
                strokeDasharray="3 3"
                opacity="0.6"
              />
              <line
                x1={padLeft}
                y1={yFor(inspectedCandle.close)}
                x2={width - padRight}
                y2={yFor(inspectedCandle.close)}
                stroke="#94A3B8"
                strokeWidth="1"
                strokeDasharray="3 3"
                opacity="0.6"
              />
            </g>
          )}
        </svg>

        {/* Legend Strip (clean unboxed metadata) */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 border-t border-slate-200 dark:border-slate-800/80">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-amber-500">EMA 9: {formatPrice(symbol, signal.indicators.ema9)}</span>
            <span className="text-sky-500">EMA 21: {formatPrice(symbol, signal.indicators.ema21)}</span>
            <span className="text-violet-400">EMA 50: {formatPrice(symbol, signal.indicators.ema50)}</span>
          </div>
          <div>
            RSI (14):{' '}
            <strong
              className={
                inspectedRsi >= 70
                  ? 'text-rose-500'
                  : inspectedRsi <= 30
                    ? 'text-emerald-500'
                    : 'text-slate-800 dark:text-slate-200'
              }
            >
              {inspectedRsi.toFixed(1)}
            </strong>
          </div>
        </div>

        {/* RSI Sub-Chart */}
        <svg
          viewBox={`0 0 ${width} ${rsiHeight}`}
          className="w-full h-auto block select-none border-t border-slate-200 dark:border-slate-800/80"
          aria-label="Grafik indikator RSI-14"
        >
          <line
            x1={padLeft}
            y1={yRsiFor(70)}
            x2={width - padRight}
            y2={yRsiFor(70)}
            stroke="#EF4444"
            strokeOpacity="0.35"
            strokeDasharray="4 4"
          />
          <line
            x1={padLeft}
            y1={yRsiFor(30)}
            x2={width - padRight}
            y2={yRsiFor(30)}
            stroke="#22C55E"
            strokeOpacity="0.35"
            strokeDasharray="4 4"
          />
          <text x={width - padRight + 8} y={yRsiFor(70) + 3} className="fill-rose-500 font-mono text-[10px]">
            70 OB
          </text>
          <text x={width - padRight + 8} y={yRsiFor(30) + 3} className="fill-emerald-500 font-mono text-[10px]">
            30 OS
          </text>
              {computed.rsi.length > 1 && (
                <polyline
                  fill="none"
                  stroke="#D4A017"
                  strokeWidth="1.6"
                  points={buildRsiPolyline(computed.rsi)}
                />
              )}
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
