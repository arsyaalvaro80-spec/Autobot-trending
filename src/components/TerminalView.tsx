import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BellPlus,
  Brain,
  Check,
  CheckCircle2,
  Pencil,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import type { ExchangeId, MarketSymbol } from '../engine/types';
import {
  formatDateTime,
  formatPrice,
  formatShortTime,
  formatUsd,
  type AppStateSnapshot,
} from '../types/app';
import { CandlestickChart } from './CandlestickChart';

interface TerminalViewProps {
  state: AppStateSnapshot;
  selectedSymbol: MarketSymbol;
  onSelectSymbol: (sym: MarketSymbol) => void;
  onExecuteOrder: (payload: {
    symbol: MarketSymbol;
    side: 'BUY' | 'SELL';
    exchange: ExchangeId;
    positionPct: number;
    overrideRiskGate: boolean;
  }) => Promise<void>;
  onClosePosition: (positionId: string) => Promise<void>;
  onUpdatePositionTargets: (positionId: string, stopLoss: number, takeProfit: number) => Promise<void>;
  onCreateAlert: (payload: {
    symbol: MarketSymbol;
    condition: 'ABOVE' | 'BELOW';
    targetPrice: number;
    recommendedAction: 'BUY' | 'SELL';
    note: string;
  }) => Promise<void>;
  onDeleteAlert: (alertId: string) => Promise<void>;
  onSimulateAnomaly: (symbol: MarketSymbol) => Promise<void>;
  onResetCircuitBreaker: () => Promise<void>;
  onRunAdaptiveLearning: (symbol: MarketSymbol) => Promise<void>;
}

const SYMBOLS: MarketSymbol[] = ['XAU/USD', 'BTC/USDT', 'ETH/USDT', 'SOL/USDT'];

export function TerminalView({
  state,
  selectedSymbol,
  onSelectSymbol,
  onExecuteOrder,
  onClosePosition,
  onUpdatePositionTargets,
  onCreateAlert,
  onDeleteAlert,
  onSimulateAnomaly,
  onResetCircuitBreaker,
  onRunAdaptiveLearning,
}: TerminalViewProps) {
  const [orderSizePct, setOrderSizePct] = useState(state.riskConfig.maxPositionPct);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Inline TP/SL target editor state
  const [editingPosId, setEditingPosId] = useState<string | null>(null);
  const [editSl, setEditSl] = useState('');
  const [editTp, setEditTp] = useState('');
  const [editError, setEditError] = useState<string | null>(null);

  // Custom Price Target Alert form state
  const candles = state.candlesBySymbol[selectedSymbol] ?? [];
  const latestPrice = candles[candles.length - 1]?.close ?? 0;
  const [alertCondition, setAlertCondition] = useState<'ABOVE' | 'BELOW'>('ABOVE');
  const [alertAction, setAlertAction] = useState<'BUY' | 'SELL'>('SELL');
  const [alertPrice, setAlertPrice] = useState(() =>
    latestPrice > 0 ? (latestPrice * 1.005).toFixed(2) : ''
  );
  const [alertNote, setAlertNote] = useState('');
  const [alertFeedback, setAlertFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  useEffect(() => {
    if (latestPrice > 0) {
      const factor = alertCondition === 'ABOVE' ? 1.005 : 0.995;
      setAlertPrice((latestPrice * factor).toFixed(2));
    }
  }, [selectedSymbol]);

  const signal = state.signalsBySymbol[selectedSymbol];
  const mtf = state.multiTimeframeBySymbol?.[selectedSymbol];
  const connectedExchange =
    state.exchanges.find((e) => e.supportedSymbols.includes(selectedSymbol))?.exchange ??
    (selectedSymbol === 'XAU/USD' ? 'oanda' : 'binance');

  const handleOrder = async (side: 'BUY' | 'SELL') => {
    setBusyAction(side);
    setActionFeedback(null);
    try {
      await onExecuteOrder({
        symbol: selectedSymbol,
        side,
        exchange: connectedExchange,
        positionPct: orderSizePct,
        overrideRiskGate: true,
      });
      setActionFeedback({
        type: 'success',
        text: `Pantauan sinyal ${side} ${selectedSymbol} dicatat (${connectedExchange.toUpperCase()}). Notifikasi Auto-TP & SL aktif.`,
      });
    } catch (err) {
      setActionFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Gagal mencatat sinyal pantauan.',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleAnomalyTest = async () => {
    setBusyAction('anomaly');
    setActionFeedback(null);
    try {
      await onSimulateAnomaly(selectedSymbol);
    } finally {
      setBusyAction(null);
    }
  };

  const handleOptimize = async () => {
    setBusyAction('optimize');
    setActionFeedback(null);
    try {
      await onRunAdaptiveLearning(selectedSymbol);
      setActionFeedback({
        type: 'success',
        text: `Kalibrasi adaptif #${state.learningCycles + 1} untuk ${selectedSymbol} selesai diterapkan.`,
      });
    } finally {
      setBusyAction(null);
    }
  };

  const startEditTargets = (posId: string, sl: number, tp: number) => {
    setEditingPosId(posId);
    setEditSl(String(sl));
    setEditTp(String(tp));
    setEditError(null);
  };

  const saveEditTargets = async (posId: string) => {
    const slNum = Number(editSl);
    const tpNum = Number(editTp);
    if (!Number.isFinite(slNum) || slNum <= 0 || !Number.isFinite(tpNum) || tpNum <= 0) {
      setEditError('Harga SL dan TP harus angka positif.');
      return;
    }
    setBusyAction(`edit-${posId}`);
    setEditError(null);
    try {
      await onUpdatePositionTargets(posId, slNum, tpNum);
      setEditingPosId(null);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Gagal menyimpan target.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleCreateAlertSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAlertFeedback(null);
    const numericTarget = Number(alertPrice);
    if (!Number.isFinite(numericTarget) || numericTarget <= 0) {
      setAlertFeedback({ type: 'error', text: 'Masukkan harga target yang valid.' });
      return;
    }
    setBusyAction('create-alert');
    try {
      await onCreateAlert({
        symbol: selectedSymbol,
        condition: alertCondition,
        targetPrice: numericTarget,
        recommendedAction: alertAction,
        note: alertNote.trim(),
      });
      setAlertNote('');
      setAlertFeedback({
        type: 'success',
        text: `Target notifikasi ${selectedSymbol} ($${formatPrice(selectedSymbol, numericTarget)}) aktif.`,
      });
    } catch (err) {
      setAlertFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Gagal memasang target harga.',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const regimeLabel: Record<string, string> = {
    trending_up: 'Tren Naik Stabil',
    trending_down: 'Tren Turun Stabil',
    ranging: 'Konsolidasi / Ranging',
    volatile: 'Volatilitas Tinggi',
  };

  return (
    <div className="space-y-6">
      {/* Circuit Breaker Critical Banner */}
      {state.circuitBreakerTripped && (
        <div
          role="alert"
          className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-lg bg-rose-500/10 border border-rose-500/40 text-rose-800 dark:text-rose-200"
        >
          <div className="flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <h2 className="font-display font-semibold text-sm text-rose-900 dark:text-rose-100">
                Radar Aksi Dijeda Otomatis — Proteksi Circuit Breaker Aktif
              </h2>
              <p className="text-xs text-rose-700 dark:text-rose-200/90 mt-0.5">
                {state.circuitBreakerReason}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void onResetCircuitBreaker()}
            className="px-4 py-2 text-xs font-semibold rounded-md bg-rose-600 hover:bg-rose-500 text-white transition-colors whitespace-nowrap shrink-0 self-start sm:self-center"
          >
            Reset Circuit Breaker
          </button>
        </div>
      )}

      {/* Feed Source & Multi-Timeframe Alignment Summary Strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 rounded-lg bg-white dark:bg-[#11161D] border border-slate-200 dark:border-slate-800/90 text-xs">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-slate-600 dark:text-slate-300">
          <span className="font-medium text-slate-900 dark:text-slate-100">
            Radar Analisa &amp; Notifikasi (Tanpa Login)
          </span>
          <span aria-hidden="true" className="text-slate-400">·</span>
          <span className="font-mono tabular-nums">
            Feed:{' '}
            <strong
              className={
                state.feedSource === 'live_public'
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-amber-600 dark:text-amber-400'
              }
            >
              {state.feedSource === 'live_public'
                ? 'Live Publik (Binance / PAXG Gold)'
                : 'Simulasi Real-Time'}
            </strong>
            {state.lastLiveSyncAt ? ` (${formatShortTime(state.lastLiveSyncAt)})` : ''}
          </span>
        </div>

        {mtf && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono tabular-nums">
            <span className="font-sans font-medium text-slate-500 dark:text-slate-400">
              Multi-Timeframe {selectedSymbol}:
            </span>
            {mtf.biases.map((b) => (
              <span
                key={b.timeframe}
                className={
                  b.bias === 'bullish'
                    ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                    : b.bias === 'bearish'
                      ? 'text-rose-600 dark:text-rose-400 font-medium'
                      : 'text-slate-500 dark:text-slate-400'
                }
              >
                {b.timeframe}{' '}
                {b.bias === 'bullish' ? '↑' : b.bias === 'bearish' ? '↓' : '·'}
              </span>
            ))}
            <span aria-hidden="true" className="text-slate-400">·</span>
            <span className="font-sans text-slate-700 dark:text-slate-200 font-medium">
              {mtf.summaryText}
            </span>
          </div>
        )}
      </div>

      {/* Instrument Selector Strip */}
      <div
        className="grid grid-cols-2 lg:grid-cols-4 gap-3"
        role="tablist"
        aria-label="Pilih instrumen pasar"
      >
        {SYMBOLS.map((sym) => {
          const symCandles = state.candlesBySymbol[sym] ?? [];
          const symSignal = state.signalsBySymbol[sym];
          const last = symCandles[symCandles.length - 1];
          const prev = symCandles[Math.max(0, symCandles.length - 12)];
          const deltaPct =
            last && prev && prev.close > 0
              ? ((last.close - prev.close) / prev.close) * 100
              : 0;
          const isSelected = sym === selectedSymbol;

          return (
            <button
              key={sym}
              type="button"
              role="tab"
              aria-selected={isSelected}
              onClick={() => onSelectSymbol(sym)}
              className={`text-left p-3.5 rounded-lg border transition-colors ${
                isSelected
                  ? 'bg-white dark:bg-[#141B24] border-amber-500/70'
                  : 'bg-white dark:bg-[#11161D] border-slate-200 dark:border-slate-800/90 hover:border-slate-300 dark:hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-display font-semibold text-sm text-slate-900 dark:text-slate-100">
                  {sym}
                </span>
                <span
                  className={`text-xs font-mono tabular-nums font-medium ${
                    deltaPct >= 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {deltaPct >= 0 ? '+' : ''}
                  {deltaPct.toFixed(2)}%
                </span>
              </div>
              <div className="mt-1.5 font-mono tabular-nums text-lg font-semibold text-slate-900 dark:text-white">
                ${last ? formatPrice(sym, last.close) : '0.00'}
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums whitespace-nowrap overflow-hidden">
                <span
                  className={
                    symSignal?.action === 'BUY'
                      ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                      : symSignal?.action === 'SELL'
                        ? 'text-rose-600 dark:text-rose-400 font-medium'
                        : 'text-slate-500 dark:text-slate-400'
                  }
                >
                  {symSignal?.action ?? 'HOLD'}
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  <span className="hidden sm:inline">Akurasi </span>
                  {symSignal?.confidence ?? 50}%
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  <span className="hidden sm:inline">Risiko </span>
                  <span className="sm:hidden">R</span>
                  {symSignal?.riskScore ?? 20}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Main 12-Column Trading Terminal Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left 8 columns: Chart + Patterns + Tracked Positions + Price Alerts */}
        <div className="xl:col-span-8 space-y-6">
          <CandlestickChart
            symbol={selectedSymbol}
            candles={candles}
            signal={signal}
            patterns={signal.patterns}
          />

          {/* Candlestick Pattern Detection & Volatility Scanner */}
          <section className="bg-white dark:bg-[#11161D] border border-slate-200 dark:border-slate-800/90 rounded-lg">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-200 dark:border-slate-800/90">
              <div>
                <h2 className="font-display font-semibold text-sm text-slate-900 dark:text-slate-100">
                  Deteksi Pola Candlestick &amp; Monitor Volatilitas ({selectedSymbol})
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Pemindaian otomatis pola pembalikan dan kelanjutan tren secara real-time.
                </p>
              </div>
              <div className="text-xs font-mono tabular-nums text-slate-600 dark:text-slate-300">
                Volatilitas:{' '}
                <strong
                  className={
                    signal.anomaly.severity === 'critical'
                      ? 'text-rose-500'
                      : signal.anomaly.severity === 'warning'
                        ? 'text-amber-500'
                        : 'text-emerald-500'
                  }
                >
                  {signal.anomaly.volatilityRatio}x ATR (
                  {signal.anomaly.severity === 'critical'
                    ? 'Ekstrem'
                    : signal.anomaly.severity === 'warning'
                      ? 'Waspada'
                      : 'Normal'}
                  )
                </strong>
              </div>
            </div>

            {signal.patterns.length === 0 ? (
              <div className="px-4 py-6 text-sm text-slate-500 dark:text-slate-400">
                Belum ada pola candlestick signifikan pada 8 candle terakhir {selectedSymbol}. Radar terus memantau formasi Engulfing, Hammer, Shooting Star, dan Morning/Evening Star.
              </div>
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-slate-800/80">
                {signal.patterns.map((p, idx) => (
                  <div
                    key={`${p.name}-${p.candleIndex}-${idx}`}
                    className="px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                  >
                    <div>
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-medium text-slate-900 dark:text-slate-100">
                          {p.labelId}
                        </span>
                        <span aria-hidden="true" className="text-slate-400">·</span>
                        <span
                          className={`text-xs font-mono font-medium ${
                            p.direction === 'bullish'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : p.direction === 'bearish'
                                ? 'text-rose-600 dark:text-rose-400'
                                : 'text-amber-600 dark:text-amber-400'
                          }`}
                        >
                          {p.direction === 'bullish'
                            ? 'Bullish'
                            : p.direction === 'bearish'
                              ? 'Bearish'
                              : 'Netral'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        {p.description}
                      </p>
                    </div>
                    <div className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400 sm:text-right shrink-0">
                      <div className="text-slate-900 dark:text-slate-200 font-medium">
                        Reliabilitas {p.reliability}%
                      </div>
                      <div>
                        ${formatPrice(selectedSymbol, p.price)} · {formatDateTime(p.time)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Active Tracked Positions with Editable Auto-Sell TP / SL */}
          <section className="bg-white dark:bg-[#11161D] border border-slate-200 dark:border-slate-800/90 rounded-lg overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-200 dark:border-slate-800/90">
              <h2 className="font-display font-semibold text-sm text-slate-900 dark:text-slate-100">
                Posisi Pantauan &amp; Target Notifikasi Auto-Sell ({state.positions.length})
              </h2>
              <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                Alert TP Otomatis: {state.riskConfig.autoTakeProfitEnabled ? 'Aktif' : 'Nonaktif'}
              </span>
            </div>

            {editError && (
              <div role="alert" className="px-4 py-2 text-xs text-rose-500 bg-rose-500/10">
                {editError}
              </div>
            )}

            {state.positions.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                Belum ada posisi pantauan aktif. Radar menunggu sinyal berakurasi minimal{' '}
                {state.riskConfig.minConfidencePct}% dengan risiko rendah.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 dark:border-slate-800/90 text-slate-500 dark:text-slate-400">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">Instrumen</th>
                      <th className="px-4 py-2.5 font-medium">Arah</th>
                      <th className="px-4 py-2.5 font-medium text-right">Entry</th>
                      <th className="px-4 py-2.5 font-medium text-right">Saat Ini</th>
                      <th className="px-4 py-2.5 font-medium text-right">Target SL / TP</th>
                      <th className="px-4 py-2.5 font-medium text-right">Estimasi P&amp;L</th>
                      <th className="px-4 py-2.5 font-medium text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800/80 font-mono tabular-nums">
                    {state.positions.map((pos) => {
                      const isEditing = editingPosId === pos.id;
                      return (
                        <tr
                          key={pos.id}
                          className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors"
                        >
                          <td className="px-4 py-3 font-sans">
                            <div className="font-semibold text-slate-900 dark:text-slate-100">
                              {pos.symbol}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                              {pos.exchange.toUpperCase()} · Qty {pos.quantity}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`font-semibold ${
                                pos.side === 'BUY'
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : 'text-rose-600 dark:text-rose-400'
                              }`}
                            >
                              {pos.side}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right text-slate-700 dark:text-slate-300">
                            ${formatPrice(pos.symbol, pos.entryPrice)}
                          </td>
                          <td className="px-4 py-3 text-right text-slate-900 dark:text-white font-medium">
                            ${formatPrice(pos.symbol, pos.currentPrice)}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {isEditing ? (
                              <div className="flex flex-col items-end gap-1.5">
                                <label className="flex items-center gap-1.5 text-[11px] text-rose-500">
                                  <span>SL</span>
                                  <input
                                    type="number"
                                    step="0.01"
                                    aria-label={`Ubah Stop-Loss ${pos.symbol}`}
                                    value={editSl}
                                    onChange={(e) => setEditSl(e.target.value)}
                                    className="w-24 px-2 py-0.5 rounded bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white text-right"
                                  />
                                </label>
                                <label className="flex items-center gap-1.5 text-[11px] text-emerald-500">
                                  <span>TP</span>
                                  <input
                                    type="number"
                                    step="0.01"
                                    aria-label={`Ubah Take-Profit ${pos.symbol}`}
                                    value={editTp}
                                    onChange={(e) => setEditTp(e.target.value)}
                                    className="w-24 px-2 py-0.5 rounded bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white text-right"
                                  />
                                </label>
                              </div>
                            ) : (
                              <>
                                <div className="text-rose-600 dark:text-rose-400">
                                  SL ${formatPrice(pos.symbol, pos.stopLoss)}
                                </div>
                                <div className="text-emerald-600 dark:text-emerald-400">
                                  TP ${formatPrice(pos.symbol, pos.takeProfit)}
                                </div>
                              </>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div
                              className={`font-semibold ${
                                pos.unrealizedPnl >= 0
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : 'text-rose-600 dark:text-rose-400'
                              }`}
                            >
                              {formatUsd(pos.unrealizedPnl, true)}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                              {pos.unrealizedPnlPct >= 0 ? '+' : ''}
                              {pos.unrealizedPnlPct.toFixed(2)}%
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right font-sans">
                            <div className="flex items-center justify-end gap-1.5">
                              {isEditing ? (
                                <>
                                  <button
                                    type="button"
                                    disabled={busyAction !== null}
                                    onClick={() => void saveEditTargets(pos.id)}
                                    aria-label={`Simpan target TP/SL ${pos.symbol}`}
                                    className="p-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
                                  >
                                    <Check className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setEditingPosId(null)}
                                    aria-label="Batal ubah target"
                                    className="p-1.5 rounded-md border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      startEditTargets(pos.id, pos.stopLoss, pos.takeProfit)
                                    }
                                    aria-label={`Edit target TP/SL ${pos.symbol}`}
                                    className="p-1.5 rounded-md border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                                  >
                                    <Pencil className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void onClosePosition(pos.id)}
                                    className="px-2.5 py-1.5 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
                                    aria-label={`Tutup pantauan ${pos.side} ${pos.symbol}`}
                                  >
                                    Tutup
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Custom Price Target Alerts Panel */}
          <section className="bg-white dark:bg-[#11161D] border border-slate-200 dark:border-slate-800/90 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800/90 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-display font-semibold text-sm text-slate-900 dark:text-slate-100">
                  Target Harga Kustom — Notifikasi Aksi Instan ({state.priceAlerts.length})
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Pasang level harga spesifik untuk {selectedSymbol}; sistem mengirim notifikasi beli/jual otomatis saat tersentuh.
                </p>
              </div>
            </div>

            <form
              onSubmit={handleCreateAlertSubmit}
              className="p-4 border-b border-slate-200 dark:border-slate-800/80 grid grid-cols-1 sm:grid-cols-12 gap-2.5 text-xs items-end"
            >
              <div className="sm:col-span-2">
                <label htmlFor="alert-cond" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Kondisi
                </label>
                <select
                  id="alert-cond"
                  value={alertCondition}
                  onChange={(e) => setAlertCondition(e.target.value as 'ABOVE' | 'BELOW')}
                  className="w-full px-2.5 py-2 rounded-md bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                >
                  <option value="ABOVE">Naik &ge;</option>
                  <option value="BELOW">Turun &le;</option>
                </select>
              </div>

              <div className="sm:col-span-3">
                <label htmlFor="alert-price" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Harga Target ({selectedSymbol})
                </label>
                <input
                  id="alert-price"
                  type="number"
                  step="0.01"
                  value={alertPrice}
                  onChange={(e) => setAlertPrice(e.target.value)}
                  className="w-full px-2.5 py-2 rounded-md font-mono tabular-nums bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                />
              </div>

              <div className="sm:col-span-2">
                <label htmlFor="alert-action" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Saran Aksi
                </label>
                <select
                  id="alert-action"
                  value={alertAction}
                  onChange={(e) => setAlertAction(e.target.value as 'BUY' | 'SELL')}
                  className="w-full px-2.5 py-2 rounded-md bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                >
                  <option value="SELL">JUAL (SELL)</option>
                  <option value="BUY">BELI (BUY)</option>
                </select>
              </div>

              <div className="sm:col-span-3">
                <label htmlFor="alert-note" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Catatan (Opsional)
                </label>
                <input
                  id="alert-note"
                  type="text"
                  value={alertNote}
                  onChange={(e) => setAlertNote(e.target.value)}
                  placeholder="Contoh: Ambil profit area resistance"
                  className="w-full px-2.5 py-2 rounded-md bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
                />
              </div>

              <div className="sm:col-span-2">
                <button
                  type="submit"
                  disabled={busyAction !== null}
                  className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-md bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-semibold transition-colors whitespace-nowrap"
                >
                  <BellPlus className="w-3.5 h-3.5" aria-hidden="true" />
                  Pasang Alert
                </button>
              </div>
            </form>

            {alertFeedback && (
              <div
                className={`px-4 py-2 text-xs ${
                  alertFeedback.type === 'success'
                    ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/5'
                    : 'text-rose-500 bg-rose-500/5'
                }`}
              >
                {alertFeedback.text}
              </div>
            )}

            <div className="divide-y divide-slate-200 dark:divide-slate-800/80">
              {state.priceAlerts.length === 0 ? (
                <div className="px-4 py-5 text-xs text-slate-500 dark:text-slate-400">
                  Belum ada target harga kustom. Pasang alert di atas untuk menerima notifikasi instan saat harga tercapai.
                </div>
              ) : (
                state.priceAlerts.map((alert) => (
                  <div
                    key={alert.id}
                    className="px-4 py-3 flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 font-mono tabular-nums">
                        <span className="font-sans font-semibold text-slate-900 dark:text-slate-100">
                          {alert.symbol}
                        </span>
                        <span aria-hidden="true" className="text-slate-400">·</span>
                        <span className="text-slate-700 dark:text-slate-200">
                          {alert.condition === 'ABOVE' ? '≥' : '≤'} $
                          {formatPrice(alert.symbol, alert.targetPrice)}
                        </span>
                        <span aria-hidden="true" className="text-slate-400">·</span>
                        <span
                          className={
                            alert.recommendedAction === 'BUY'
                              ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                              : 'text-rose-600 dark:text-rose-400 font-semibold'
                          }
                        >
                          Aksi {alert.recommendedAction}
                        </span>
                        <span aria-hidden="true" className="text-slate-400">·</span>
                        <span
                          className={
                            alert.triggered
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-amber-600 dark:text-amber-400'
                          }
                        >
                          {alert.triggered ? 'Tercapai' : 'Memantau'}
                        </span>
                      </div>
                      <p className="text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                        {alert.note}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void onDeleteAlert(alert.id)}
                      aria-label={`Hapus target harga ${alert.symbol} ${alert.targetPrice}`}
                      className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-rose-500 hover:border-rose-500/40 transition-colors shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        {/* Right 4 columns: Signal Gate 90%, Tracking Controls, Technical Indicators & Adaptive Weights */}
        <div className="xl:col-span-4 space-y-6">
          {/* 90% Confidence & Low-Risk Gate Decision Panel */}
          <section className="bg-white dark:bg-[#11161D] border border-slate-200 dark:border-slate-800/90 rounded-lg p-4 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display font-semibold text-sm text-slate-900 dark:text-slate-100">
                  Sinyal Aksi &amp; Gerbang Risiko Ketat
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Notifikasi aksi beli/jual dikirim otomatis jika akurasi &ge;{state.riskConfig.minConfidencePct}% dan risiko &le;{state.riskConfig.maxRiskScore}/100.
                </p>
              </div>
              <span
                className={`font-display font-bold text-base tabular-nums ${
                  signal.action === 'BUY'
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : signal.action === 'SELL'
                      ? 'text-rose-600 dark:text-rose-400'
                      : 'text-amber-600 dark:text-amber-400'
                }`}
              >
                {signal.action}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-3 pt-3 border-t border-slate-200 dark:border-slate-800/80 font-mono tabular-nums">
              <div>
                <div className="text-[11px] font-sans text-slate-500 dark:text-slate-400">
                  Akurasi Sinyal
                </div>
                <div className="text-lg font-semibold text-slate-900 dark:text-white mt-0.5">
                  {signal.confidence}%
                </div>
              </div>
              <div>
                <div className="text-[11px] font-sans text-slate-500 dark:text-slate-400">
                  Skor Risiko
                </div>
                <div
                  className={`text-lg font-semibold mt-0.5 ${
                    signal.riskScore <= state.riskConfig.maxRiskScore
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : signal.riskScore <= 45
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {signal.riskScore}/100
                </div>
              </div>
              <div>
                <div className="text-[11px] font-sans text-slate-500 dark:text-slate-400">
                  Risk : Reward
                </div>
                <div className="text-lg font-semibold text-slate-900 dark:text-white mt-0.5">
                  1:{signal.riskRewardRatio}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs py-2.5 px-3 rounded-md bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800">
              {signal.meetsStrictGate ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" aria-hidden="true" />
                  <span className="text-emerald-700 dark:text-emerald-300 font-medium">
                    Lolos Gerbang Ketat (&ge;{state.riskConfig.minConfidencePct}% · Risiko Rendah) — Siap Aksi
                  </span>
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4 text-amber-500 shrink-0" aria-hidden="true" />
                  <span className="text-slate-700 dark:text-slate-300">
                    Menunggu Konfluensi Optimal · Rezim: {regimeLabel[signal.regime]}
                  </span>
                </>
              )}
            </div>

            {/* Signal Reasoning List */}
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Dasar Analisis Real-Time
              </div>
              <ul className="space-y-1 text-xs text-slate-600 dark:text-slate-400 list-disc pl-4">
                {signal.reasons.slice(0, 4).map((reason, idx) => (
                  <li key={idx}>{reason}</li>
                ))}
              </ul>
            </div>

            {/* Signal Position Tracking Controls */}
            <div className="pt-3 border-t border-slate-200 dark:border-slate-800/80 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <label
                  htmlFor="terminal-pos-size"
                  className="text-slate-600 dark:text-slate-300 font-medium"
                >
                  Porsi Pantauan Risiko ({orderSizePct}%)
                </label>
                <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                  Acuan {connectedExchange.toUpperCase()}
                </span>
              </div>
              <input
                id="terminal-pos-size"
                type="range"
                min={1}
                max={15}
                step={1}
                value={orderSizePct}
                onChange={(e) => setOrderSizePct(Number(e.target.value))}
                className="w-full accent-amber-500"
              />

              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  disabled={busyAction !== null || state.circuitBreakerTripped}
                  onClick={() => void handleOrder('BUY')}
                  className="flex items-center justify-center gap-1.5 py-2.5 px-3 text-xs font-semibold rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white transition-colors whitespace-nowrap"
                >
                  <ArrowUpRight className="w-4 h-4" aria-hidden="true" />
                  Catat Sinyal Beli
                </button>
                <button
                  type="button"
                  disabled={busyAction !== null || state.circuitBreakerTripped}
                  onClick={() => void handleOrder('SELL')}
                  className="flex items-center justify-center gap-1.5 py-2.5 px-3 text-xs font-semibold rounded-md bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white transition-colors whitespace-nowrap"
                >
                  <ArrowDownRight className="w-4 h-4" aria-hidden="true" />
                  Catat Sinyal Jual
                </button>
              </div>

              {actionFeedback && (
                <div
                  className={`flex items-start justify-between gap-2 text-xs p-2.5 rounded-md border ${
                    actionFeedback.type === 'success'
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                      : 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300'
                  }`}
                >
                  <span>{actionFeedback.text}</span>
                  <button
                    type="button"
                    onClick={() => setActionFeedback(null)}
                    aria-label="Tutup pesan"
                    className="shrink-0 opacity-70 hover:opacity-100"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Adaptive Learning & Volatility Circuit Breaker Controls */}
              <div className="grid grid-cols-2 gap-2 pt-2">
                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() => void handleOptimize()}
                  className="flex items-center justify-center gap-1.5 py-2 px-2.5 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
                >
                  <Brain className="w-3.5 h-3.5 text-amber-500" aria-hidden="true" />
                  Optimasi Adaptif
                </button>
                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() => void handleAnomalyTest()}
                  className="flex items-center justify-center gap-1.5 py-2 px-2.5 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
                >
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-500" aria-hidden="true" />
                  Uji Anomali Pasar
                </button>
              </div>
            </div>
          </section>

          {/* Complete Technical Indicators Snapshot */}
          <section className="bg-white dark:bg-[#11161D] border border-slate-200 dark:border-slate-800/90 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-display font-semibold text-sm text-slate-900 dark:text-slate-100">
                Matriks Indikator Teknikal
              </h2>
              <span className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                Siklus Belajar #{state.learningCycles}
              </span>
            </div>

            <dl className="divide-y divide-slate-200 dark:divide-slate-800/80 text-xs font-mono tabular-nums">
              <div className="py-2 flex items-center justify-between">
                <dt className="font-sans text-slate-500 dark:text-slate-400">RSI (14)</dt>
                <dd className="text-slate-900 dark:text-slate-100 font-medium">
                  {signal.indicators.rsi14.toFixed(2)}{' '}
                  <span className="text-slate-400">
                    ({signal.indicators.rsi14 >= 70 ? 'Jenuh Beli' : signal.indicators.rsi14 <= 30 ? 'Jenuh Jual' : 'Netral'})
                  </span>
                </dd>
              </div>
              <div className="py-2 flex items-center justify-between">
                <dt className="font-sans text-slate-500 dark:text-slate-400">MACD (12, 26, 9)</dt>
                <dd
                  className={
                    signal.indicators.macd.histogram >= 0
                      ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                      : 'text-rose-600 dark:text-rose-400 font-medium'
                  }
                >
                  {signal.indicators.macd.line.toFixed(2)} / Hist {signal.indicators.macd.histogram.toFixed(2)}
                </dd>
              </div>
              <div className="py-2 flex items-center justify-between">
                <dt className="font-sans text-slate-500 dark:text-slate-400">Bollinger Bandwidth</dt>
                <dd className="text-slate-900 dark:text-slate-100 font-medium">
                  {signal.indicators.bollinger.bandwidthPct.toFixed(2)}%
                </dd>
              </div>
              <div className="py-2 flex items-center justify-between">
                <dt className="font-sans text-slate-500 dark:text-slate-400">ATR (14) Volatilitas</dt>
                <dd className="text-slate-900 dark:text-slate-100 font-medium">
                  ${signal.indicators.atr14.toFixed(2)} ({signal.indicators.atrPct.toFixed(2)}%)
                </dd>
              </div>
              <div className="py-2 flex items-center justify-between">
                <dt className="font-sans text-slate-500 dark:text-slate-400">Stochastic %K / %D</dt>
                <dd className="text-slate-900 dark:text-slate-100 font-medium">
                  {signal.indicators.stochastic.k.toFixed(1)} / {signal.indicators.stochastic.d.toFixed(1)}
                </dd>
              </div>
              <div className="py-2 flex items-center justify-between">
                <dt className="font-sans text-slate-500 dark:text-slate-400">Bobot Adaptif (EMA / RSI / Pola)</dt>
                <dd className="text-amber-600 dark:text-amber-400 font-medium">
                  {(state.strategyWeights.emaTrend * 100).toFixed(0)}% /{' '}
                  {(state.strategyWeights.rsiMomentum * 100).toFixed(0)}% /{' '}
                  {(state.strategyWeights.candlestickPattern * 100).toFixed(0)}%
                </dd>
              </div>
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}
