import { useMemo, useState } from 'react';
import { Download, Search } from 'lucide-react';
import type { MarketSymbol } from '../engine/types';
import {
  formatDateTime,
  formatPrice,
  formatUsd,
  type AppStateSnapshot,
} from '../types/app';

interface AnalyticsViewProps {
  state: AppStateSnapshot;
}

export function AnalyticsView({ state }: AnalyticsViewProps) {
  const [search, setSearch] = useState('');
  const [symbolFilter, setSymbolFilter] = useState<'ALL' | MarketSymbol>('ALL');
  const [sideFilter, setSideFilter] = useState<'ALL' | 'BUY' | 'SELL'>('ALL');

  const filteredTrades = useMemo(() => {
    const q = search.trim().toLowerCase();
    return state.trades.filter((t) => {
      if (symbolFilter !== 'ALL' && t.symbol !== symbolFilter) return false;
      if (sideFilter !== 'ALL' && t.side !== sideFilter) return false;
      if (!q) return true;
      return (
        t.symbol.toLowerCase().includes(q) ||
        t.exchange.toLowerCase().includes(q) ||
        t.strategyNote.toLowerCase().includes(q) ||
        t.closeReason.toLowerCase().includes(q)
      );
    });
  }, [state.trades, search, symbolFilter, sideFilter]);

  const handleDownloadCsv = () => {
    const headers = [
      'ID',
      'Symbol',
      'Exchange',
      'Side',
      'Entry',
      'Exit',
      'Qty',
      'PnL_USD',
      'PnL_Pct',
      'Reason',
      'Confidence',
      'RiskScore',
      'ClosedAt',
    ];
    const rows = filteredTrades.map((t) => [
      t.id,
      t.symbol,
      t.exchange,
      t.side,
      t.entryPrice,
      t.exitPrice,
      t.quantity,
      t.pnlUsd,
      t.pnlPct,
      t.closeReason,
      t.confidenceAtEntry,
      t.riskScoreAtEntry,
      new Date(t.closedAt).toISOString(),
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `aurex-quant-riwayat-transaksi.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Equity curve geometry
  const eqW = 680;
  const eqH = 210;
  const eqPad = 24;
  const eqPoints = useMemo(() => {
    const pts = state.equityHistory;
    if (pts.length < 2) return { polyline: '', area: '', min: 0, max: 0 };
    const vals = pts.map((p) => p.equity);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const span = Math.max(max - min, 1);
    const coords = pts.map((p, i) => {
      const x = eqPad + (i / (pts.length - 1)) * (eqW - eqPad * 2);
      const y = eqPad + ((max - p.equity) / span) * (eqH - eqPad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const area = `${eqPad},${eqH - eqPad} ${coords.join(' ')} ${eqW - eqPad},${eqH - eqPad}`;
    return { polyline: coords.join(' '), area, min, max };
  }, [state.equityHistory]);

  const maxAbsDaily = Math.max(
    1,
    ...state.dailyProfits.map((d) => Math.abs(d.profitUsd))
  );

  return (
    <div className="space-y-6">
      {/* 4-Column KPI Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="p-4 rounded-lg bg-white dark:bg-[#11161D] border border-slate-200 dark:border-slate-800/90">
          <div className="text-xs text-slate-500 dark:text-slate-400">Total Ekuitas Portofolio</div>
          <div className="mt-1.5 font-mono tabular-nums text-2xl font-bold text-slate-900 dark:text-white">
            {formatUsd(state.equityUsd)}
          </div>
          <div className="mt-1 text-xs font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
            {state.totalReturnPct >= 0 ? '+' : ''}
            {state.totalReturnPct}% dari modal awal {formatUsd(state.startingCapitalUsd)}
          </div>
        </div>

        <div className="p-4 rounded-lg bg-white dark:bg-[#11161D] border border-slate-200 dark:border-slate-800/90">
          <div className="text-xs text-slate-500 dark:text-slate-400">Profit Realisasi Hari Ini</div>
          <div
            className={`mt-1.5 font-mono tabular-nums text-2xl font-bold ${
              state.realizedPnlTodayUsd >= 0
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-rose-600 dark:text-rose-400'
            }`}
          >
            {formatUsd(state.realizedPnlTodayUsd, true)}
          </div>
          <div className="mt-1 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
            Mengambang: {formatUsd(state.unrealizedPnlUsd, true)}
          </div>
        </div>

        <div className="p-4 rounded-lg bg-white dark:bg-[#11161D] border border-slate-200 dark:border-slate-800/90">
          <div className="text-xs text-slate-500 dark:text-slate-400">Win Rate Historis</div>
          <div className="mt-1.5 font-mono tabular-nums text-2xl font-bold text-slate-900 dark:text-white">
            {state.winRatePct}%
          </div>
          <div className="mt-1 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
            Dari {state.totalTrades} transaksi selesai · Filter &ge;{state.riskConfig.minConfidencePct}%
          </div>
        </div>

        <div className="p-4 rounded-lg bg-white dark:bg-[#11161D] border border-slate-200 dark:border-slate-800/90">
          <div className="text-xs text-slate-500 dark:text-slate-400">Posisi Aktif &amp; Eksposur</div>
          <div className="mt-1.5 font-mono tabular-nums text-2xl font-bold text-slate-900 dark:text-white">
            {state.positions.length} Posisi
          </div>
          <div className="mt-1 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
            Maks Alokasi {state.riskConfig.maxPositionPct}% · Batas Loss Harian {state.riskConfig.maxDailyLossPct}%
          </div>
        </div>
      </div>

      {/* Charts Row: Equity Curve + Daily Profit Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section className="lg:col-span-7 bg-white dark:bg-[#11161D] border border-slate-200 dark:border-slate-800/90 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="font-display font-semibold text-sm text-slate-900 dark:text-slate-100">
                Kurva Pertumbuhan Ekuitas Real-Time
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Rentang {formatUsd(eqPoints.min)} – {formatUsd(eqPoints.max)}
              </p>
            </div>
            <span className="text-xs font-mono tabular-nums text-amber-600 dark:text-amber-400">
              Multi-Exchange Consolidated
            </span>
          </div>
          <svg
            viewBox={`0 0 ${eqW} ${eqH}`}
            className="w-full h-auto block"
            role="img"
            aria-label="Grafik pertumbuhan ekuitas portofolio"
          >
            <defs>
              <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#D4A017" stopOpacity="0.28" />
                <stop offset="100%" stopColor="#D4A017" stopOpacity="0.01" />
              </linearGradient>
            </defs>
            <line
              x1={eqPad}
              y1={eqH - eqPad}
              x2={eqW - eqPad}
              y2={eqH - eqPad}
              stroke="currentColor"
              className="text-slate-200 dark:text-slate-800"
            />
            {eqPoints.area && <polygon points={eqPoints.area} fill="url(#eqGrad)" />}
            {eqPoints.polyline && (
              <polyline
                fill="none"
                stroke="#D4A017"
                strokeWidth="2.2"
                points={eqPoints.polyline}
              />
            )}
          </svg>
        </section>

        <section className="lg:col-span-5 bg-white dark:bg-[#11161D] border border-slate-200 dark:border-slate-800/90 rounded-lg p-4 flex flex-col justify-between">
          <div>
            <h2 className="font-display font-semibold text-sm text-slate-900 dark:text-slate-100">
              Ringkasan Profit Harian (7 Hari)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Performa bersih harian lintas XAU/USD dan pasangan kripto.
            </p>
          </div>

          <div className="mt-5 grid grid-cols-7 gap-2 items-end h-44">
            {state.dailyProfits.map((bar) => {
              const pct = Math.max(12, Math.round((Math.abs(bar.profitUsd) / maxAbsDaily) * 100));
              const isPos = bar.profitUsd >= 0;
              return (
                <div key={bar.dayLabel} className="flex flex-col items-center gap-1.5 h-full justify-end">
                  <span
                    className={`text-[10px] font-mono tabular-nums ${
                      isPos
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {isPos ? '+' : ''}${Math.round(bar.profitUsd)}
                  </span>
                  <div className="w-full flex items-end justify-center h-28">
                    <div
                      className={`w-full max-w-[32px] rounded-t-sm transition-all ${
                        isPos ? 'bg-emerald-500/80' : 'bg-rose-500/80'
                      }`}
                      style={{ height: `${pct}%` }}
                      title={`${bar.dayLabel}: ${formatUsd(bar.profitUsd, true)} (${bar.tradesCount} trade, WR ${bar.winRatePct}%)`}
                    />
                  </div>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    {bar.dayLabel}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* Transparent Trade History Table */}
      <section className="bg-white dark:bg-[#11161D] border border-slate-200 dark:border-slate-800/90 rounded-lg overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 px-4 py-3.5 border-b border-slate-200 dark:border-slate-800/90">
          <div>
            <h2 className="font-display font-semibold text-sm text-slate-900 dark:text-slate-100">
              Riwayat Transaksi Lengkap &amp; Transparan ({filteredTrades.length})
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Mencatat harga entry, exit, alasan penutupan otomatis, skor akurasi, dan skor risiko.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" aria-hidden="true" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari simbol atau catatan..."
                aria-label="Cari riwayat transaksi"
                className="pl-8 pr-3 py-1.5 text-xs rounded-md bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-amber-500"
              />
            </div>

            <select
              aria-label="Filter simbol transaksi"
              value={symbolFilter}
              onChange={(e) => setSymbolFilter(e.target.value as 'ALL' | MarketSymbol)}
              className="px-2.5 py-1.5 text-xs rounded-md bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100"
            >
              <option value="ALL">Semua Instrumen</option>
              <option value="XAU/USD">XAU/USD</option>
              <option value="BTC/USDT">BTC/USDT</option>
              <option value="ETH/USDT">ETH/USDT</option>
              <option value="SOL/USDT">SOL/USDT</option>
            </select>

            <div className="flex items-center p-0.5 rounded-md bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              {(['ALL', 'BUY', 'SELL'] as const).map((side) => (
                <button
                  key={side}
                  type="button"
                  onClick={() => setSideFilter(side)}
                  className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                    sideFilter === side
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {side === 'ALL' ? 'Semua' : side}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={handleDownloadCsv}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              Unduh CSV
            </button>
          </div>
        </div>

        {filteredTrades.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
            Tidak ada transaksi yang cocok dengan filter pencarian Anda.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 dark:border-slate-800/90 text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Waktu Tutup</th>
                  <th className="px-4 py-2.5 font-medium">Instrumen</th>
                  <th className="px-4 py-2.5 font-medium">Arah</th>
                  <th className="px-4 py-2.5 font-medium text-right">Entry → Exit</th>
                  <th className="px-4 py-2.5 font-medium text-right">P&amp;L Bersih</th>
                  <th className="px-4 py-2.5 font-medium text-right">Akurasi / Risiko</th>
                  <th className="px-4 py-2.5 font-medium">Alasan &amp; Catatan Strategi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800/80 font-mono tabular-nums">
                {filteredTrades.map((t) => (
                  <tr
                    key={t.id}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors"
                  >
                    <td className="px-4 py-3 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      {formatDateTime(t.closedAt)}
                    </td>
                    <td className="px-4 py-3 font-sans">
                      <div className="font-semibold text-slate-900 dark:text-slate-100">
                        {t.symbol}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {t.exchange.toUpperCase()} · Qty {t.quantity}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`font-semibold ${
                          t.side === 'BUY'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {t.side}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap text-slate-700 dark:text-slate-300">
                      ${formatPrice(t.symbol, t.entryPrice)} → ${formatPrice(t.symbol, t.exitPrice)}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div
                        className={`font-semibold ${
                          t.pnlUsd >= 0
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {formatUsd(t.pnlUsd, true)}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {t.pnlPct >= 0 ? '+' : ''}
                        {t.pnlPct.toFixed(2)}%
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap text-slate-600 dark:text-slate-300">
                      {t.confidenceAtEntry}% / {t.riskScoreAtEntry}
                    </td>
                    <td className="px-4 py-3 font-sans text-slate-600 dark:text-slate-300 max-w-xs">
                      <span className="font-medium text-slate-900 dark:text-slate-100">
                        {t.closeReason.replace('_', ' ')}
                      </span>{' '}
                      <span aria-hidden="true">·</span> {t.strategyNote}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
