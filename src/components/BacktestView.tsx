import { useEffect, useMemo, useState } from 'react';
import { Play, RotateCcw } from 'lucide-react';
import type { BacktestParams, BacktestResult, MarketSymbol } from '../engine/types';
import { formatDateTime, formatPrice, formatUsd } from '../types/app';

const DEFAULT_BT: BacktestParams = {
  symbol: 'XAU/USD',
  initialCapital: 25000,
  candlesCount: 240,
  minConfidencePct: 90,
  maxRiskScore: 25,
  stopLossPct: 0.65,
  takeProfitPct: 1.95,
  positionSizePct: 5,
  rsiOversold: 32,
  rsiOverbought: 68,
};

export function BacktestView() {
  const [params, setParams] = useState<BacktestParams>(DEFAULT_BT);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runSimulation = async (targetParams: BacktestParams) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/backtest/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(targetParams),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Gagal menjalankan backtest.');
      }
      setResult(data as BacktestResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menjalankan simulasi backtest.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void runSimulation(DEFAULT_BT);
  }, []);

  const chartGeometry = useMemo(() => {
    if (!result || result.equityCurve.length < 2) {
      return { eqPath: '', ddPath: '', minEq: 0, maxEq: 0 };
    }
    const w = 780;
    const h = 220;
    const pad = 26;
    const vals = result.equityCurve.map((p) => p.equity);
    const minEq = Math.min(...vals);
    const maxEq = Math.max(...vals);
    const span = Math.max(maxEq - minEq, 1);

    const eqPath = result.equityCurve
      .map((p, i) => {
        const x = pad + (i / (result.equityCurve.length - 1)) * (w - pad * 2);
        const y = pad + ((maxEq - p.equity) / span) * (h - pad * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');

    const maxDd = Math.max(1, result.maxDrawdownPct);
    const ddPath = result.equityCurve
      .map((p, i) => {
        const x = pad + (i / (result.equityCurve.length - 1)) * (w - pad * 2);
        const y = pad + (p.drawdownPct / maxDd) * (h - pad * 2) * 0.45;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');

    return { eqPath, ddPath, minEq, maxEq };
  }, [result]);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
      {/* Parameter Form (Left 4 cols) */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void runSimulation(params);
        }}
        className="xl:col-span-4 bg-white dark:bg-[#11161D] border border-slate-200 dark:border-slate-800/90 rounded-lg p-5 space-y-4"
      >
        <div>
          <h2 className="font-display font-semibold text-base text-slate-900 dark:text-slate-100">
            Parameter Backtesting Strategi
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Uji akurasi strategi XAU/USD dan Kripto pada data historis sebelum dieksekusi live.
          </p>
        </div>

        <div className="space-y-3 text-xs">
          <div>
            <label htmlFor="bt-symbol" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
              Instrumen Pasar
            </label>
            <select
              id="bt-symbol"
              value={params.symbol}
              onChange={(e) => setParams({ ...params, symbol: e.target.value as MarketSymbol })}
              className="w-full px-3 py-2 rounded-md bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100"
            >
              <option value="XAU/USD">XAU/USD (Emas Spot)</option>
              <option value="BTC/USDT">BTC/USDT (Bitcoin)</option>
              <option value="ETH/USDT">ETH/USDT (Ethereum)</option>
              <option value="SOL/USDT">SOL/USDT (Solana)</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="bt-capital" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                Modal Awal ($)
              </label>
              <input
                id="bt-capital"
                type="number"
                min={1000}
                max={1000000}
                step={500}
                value={params.initialCapital}
                onChange={(e) => setParams({ ...params, initialCapital: Number(e.target.value) })}
                className="w-full px-3 py-2 rounded-md font-mono tabular-nums bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label htmlFor="bt-candles" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                Jumlah Candle
              </label>
              <input
                id="bt-candles"
                type="number"
                min={120}
                max={500}
                step={20}
                value={params.candlesCount}
                onChange={(e) => setParams({ ...params, candlesCount: Number(e.target.value) })}
                className="w-full px-3 py-2 rounded-md font-mono tabular-nums bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="bt-conf" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                Min Akurasi (%)
              </label>
              <input
                id="bt-conf"
                type="number"
                min={75}
                max={98}
                value={params.minConfidencePct}
                onChange={(e) => setParams({ ...params, minConfidencePct: Number(e.target.value) })}
                className="w-full px-3 py-2 rounded-md font-mono tabular-nums bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label htmlFor="bt-risk" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                Maks Skor Risiko
              </label>
              <input
                id="bt-risk"
                type="number"
                min={10}
                max={50}
                value={params.maxRiskScore}
                onChange={(e) => setParams({ ...params, maxRiskScore: Number(e.target.value) })}
                className="w-full px-3 py-2 rounded-md font-mono tabular-nums bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="bt-sl" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                Stop-Loss (%)
              </label>
              <input
                id="bt-sl"
                type="number"
                min={0.25}
                max={5}
                step={0.05}
                value={params.stopLossPct}
                onChange={(e) => setParams({ ...params, stopLossPct: Number(e.target.value) })}
                className="w-full px-3 py-2 rounded-md font-mono tabular-nums bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label htmlFor="bt-tp" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                Take-Profit (%)
              </label>
              <input
                id="bt-tp"
                type="number"
                min={0.6}
                max={15}
                step={0.1}
                value={params.takeProfitPct}
                onChange={(e) => setParams({ ...params, takeProfitPct: Number(e.target.value) })}
                className="w-full px-3 py-2 rounded-md font-mono tabular-nums bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="bt-rsi-os" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                RSI Oversold
              </label>
              <input
                id="bt-rsi-os"
                type="number"
                min={15}
                max={45}
                value={params.rsiOversold}
                onChange={(e) => setParams({ ...params, rsiOversold: Number(e.target.value) })}
                className="w-full px-3 py-2 rounded-md font-mono tabular-nums bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label htmlFor="bt-rsi-ob" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                RSI Overbought
              </label>
              <input
                id="bt-rsi-ob"
                type="number"
                min={55}
                max={85}
                value={params.rsiOverbought}
                onChange={(e) => setParams({ ...params, rsiOverbought: Number(e.target.value) })}
                className="w-full px-3 py-2 rounded-md font-mono tabular-nums bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 pt-2">
          <button
            type="submit"
            disabled={loading}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 text-xs font-semibold rounded-md bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white transition-colors whitespace-nowrap"
          >
            <Play className="w-3.5 h-3.5" aria-hidden="true" />
            {loading ? 'Menghitung...' : 'Jalankan Backtest'}
          </button>
          <button
            type="button"
            onClick={() => {
              setParams(DEFAULT_BT);
              void runSimulation(DEFAULT_BT);
            }}
            aria-label="Reset parameter backtest"
            className="p-2.5 rounded-md border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div role="alert" className="text-xs text-rose-500">
            {error}
          </div>
        )}
      </form>

      {/* Results Panel (Right 8 cols) */}
      <div className="xl:col-span-8 space-y-6">
        {result ? (
          <>
            {/* Performance KPIs */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 font-mono tabular-nums">
              <div className="p-4 rounded-lg bg-white dark:bg-[#11161D] border border-slate-200 dark:border-slate-800/90">
                <div className="font-sans text-xs text-slate-500 dark:text-slate-400">
                  Total Return ({result.symbol})
                </div>
                <div
                  className={`mt-1 text-xl font-bold ${
                    result.totalReturnPct >= 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {result.totalReturnPct >= 0 ? '+' : ''}
                  {result.totalReturnPct}%
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  {formatUsd(result.netProfitUsd, true)}
                </div>
              </div>

              <div className="p-4 rounded-lg bg-white dark:bg-[#11161D] border border-slate-200 dark:border-slate-800/90">
                <div className="font-sans text-xs text-slate-500 dark:text-slate-400">Win Rate</div>
                <div className="mt-1 text-xl font-bold text-slate-900 dark:text-white">
                  {result.winRatePct}%
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  {result.winningTrades} menang / {result.losingTrades} rugi
                </div>
              </div>

              <div className="p-4 rounded-lg bg-white dark:bg-[#11161D] border border-slate-200 dark:border-slate-800/90">
                <div className="font-sans text-xs text-slate-500 dark:text-slate-400">Max Drawdown</div>
                <div className="mt-1 text-xl font-bold text-rose-600 dark:text-rose-400">
                  -{result.maxDrawdownPct}%
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  Profit Factor {result.profitFactor}
                </div>
              </div>

              <div className="p-4 rounded-lg bg-white dark:bg-[#11161D] border border-slate-200 dark:border-slate-800/90">
                <div className="font-sans text-xs text-slate-500 dark:text-slate-400">Sharpe Ratio</div>
                <div className="mt-1 text-xl font-bold text-slate-900 dark:text-white">
                  {result.sharpeRatio}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  Avg R:R 1:{result.avgRiskReward}
                </div>
              </div>
            </div>

            {/* Equity Curve SVG */}
            <section className="bg-white dark:bg-[#11161D] border border-slate-200 dark:border-slate-800/90 rounded-lg p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div>
                  <h3 className="font-display font-semibold text-sm text-slate-900 dark:text-slate-100">
                    Simulasi Kurva Ekuitas &amp; Drawdown ({result.symbol})
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Modal Awal {formatUsd(result.initialCapital)} → Ekuitas Akhir{' '}
                    {formatUsd(result.finalEquity)}
                  </p>
                </div>
                <div className="flex items-center gap-3 text-xs font-mono">
                  <span className="text-emerald-500">Ekuitas</span>
                  <span aria-hidden="true" className="text-slate-400">·</span>
                  <span className="text-rose-500">Drawdown</span>
                </div>
              </div>
              <svg
                viewBox="0 0 780 220"
                className="w-full h-auto block"
                role="img"
                aria-label={`Kurva ekuitas backtesting ${result.symbol}`}
              >
                <line
                  x1="26"
                  y1="194"
                  x2="754"
                  y2="194"
                  stroke="currentColor"
                  className="text-slate-200 dark:text-slate-800"
                />
                {chartGeometry.ddPath && (
                  <polyline
                    fill="none"
                    stroke="#EF4444"
                    strokeOpacity="0.45"
                    strokeWidth="1.2"
                    strokeDasharray="3 3"
                    points={chartGeometry.ddPath}
                  />
                )}
                {chartGeometry.eqPath && (
                  <polyline
                    fill="none"
                    stroke="#16A34A"
                    strokeWidth="2.2"
                    points={chartGeometry.eqPath}
                  />
                )}
              </svg>
            </section>

            {/* Simulated Trade Breakdown */}
            <section className="bg-white dark:bg-[#11161D] border border-slate-200 dark:border-slate-800/90 rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800/90 flex items-center justify-between">
                <h3 className="font-display font-semibold text-sm text-slate-900 dark:text-slate-100">
                  Log Transaksi Simulasi ({result.trades.length})
                </h3>
                <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                  Deterministik · Tanpa Slippage Tersembunyi
                </span>
              </div>

              {result.trades.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                  Filter risiko sangat ketat sehingga belum ada entry pada rentang candle ini. Coba turunkan sedikit Min Akurasi atau naikkan Maks Skor Risiko.
                </div>
              ) : (
                <div className="overflow-x-auto max-h-80">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 dark:border-slate-800/90 text-slate-500 dark:text-slate-400 sticky top-0 bg-white dark:bg-[#11161D]">
                      <tr>
                        <th className="px-4 py-2.5 font-medium">Waktu</th>
                        <th className="px-4 py-2.5 font-medium">Arah</th>
                        <th className="px-4 py-2.5 font-medium text-right">Entry → Exit</th>
                        <th className="px-4 py-2.5 font-medium text-right">P&amp;L</th>
                        <th className="px-4 py-2.5 font-medium">Pemicu</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800/80 font-mono tabular-nums">
                      {result.trades.slice(0, 30).map((t) => (
                        <tr key={t.id}>
                          <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                            {formatDateTime(t.closedAt)}
                          </td>
                          <td
                            className={`px-4 py-2.5 font-semibold ${
                              t.side === 'BUY'
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-rose-600 dark:text-rose-400'
                            }`}
                          >
                            {t.side}
                          </td>
                          <td className="px-4 py-2.5 text-right whitespace-nowrap text-slate-700 dark:text-slate-300">
                            ${formatPrice(t.symbol, t.entryPrice)} → ${formatPrice(t.symbol, t.exitPrice)}
                          </td>
                          <td
                            className={`px-4 py-2.5 text-right font-semibold whitespace-nowrap ${
                              t.pnlUsd >= 0
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-rose-600 dark:text-rose-400'
                            }`}
                          >
                            {formatUsd(t.pnlUsd, true)} ({t.pnlPct >= 0 ? '+' : ''}
                            {t.pnlPct}%)
                          </td>
                          <td className="px-4 py-2.5 font-sans text-slate-600 dark:text-slate-300">
                            {t.closeReason.replace('_', ' ')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        ) : (
          <div className="p-10 rounded-lg bg-white dark:bg-[#11161D] border border-slate-200 dark:border-slate-800/90 text-center text-sm text-slate-500">
            Menjalankan simulasi backtest historis...
          </div>
        )}
      </div>
    </div>
  );
}
