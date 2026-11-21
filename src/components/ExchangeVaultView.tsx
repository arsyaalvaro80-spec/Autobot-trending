import { useState } from 'react';
import { Lock, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import type { ExchangeId, RiskConfig } from '../engine/types';
import { formatDateTime, type AppStateSnapshot } from '../types/app';

interface ExchangeVaultViewProps {
  state: AppStateSnapshot;
  onAddExchange: (payload: {
    exchange: ExchangeId;
    label: string;
    apiKey: string;
    apiSecret: string;
    mode: 'paper' | 'live_encrypted';
  }) => Promise<void>;
  onDeleteExchange: (id: string) => Promise<void>;
  onSaveRiskConfig: (config: RiskConfig) => Promise<void>;
}

export function ExchangeVaultView({
  state,
  onAddExchange,
  onDeleteExchange,
  onSaveRiskConfig,
}: ExchangeVaultViewProps) {
  const [exchange, setExchange] = useState<ExchangeId>('okx');
  const [label, setLabel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [mode, setMode] = useState<'paper' | 'live_encrypted'>('paper');
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [riskDraft, setRiskDraft] = useState<RiskConfig>(state.riskConfig);
  const [riskSavedMsg, setRiskSavedMsg] = useState<string | null>(null);

  const handleExchangeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    if (label.trim().length < 3) {
      setFormError('Nama profil koneksi minimal 3 karakter.');
      return;
    }
    if (apiKey.trim().length < 8 || apiSecret.trim().length < 8) {
      setFormError('Exchange API Key dan API Secret minimal 8 karakter untuk enkripsi AES-256-GCM.');
      return;
    }

    setSubmitting(true);
    try {
      await onAddExchange({
        exchange,
        label: label.trim(),
        apiKey: apiKey.trim(),
        apiSecret: apiSecret.trim(),
        mode,
      });
      setLabel('');
      setApiKey('');
      setApiSecret('');
      setFormSuccess('Kredensial berhasil dienkripsi dengan AES-256-GCM di server dan dihubungkan.');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Gagal menyimpan koneksi exchange.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRiskSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setRiskSavedMsg(null);
    await onSaveRiskConfig(riskDraft);
    setRiskSavedMsg('Parameter manajemen risiko & proteksi modal berhasil disimpan.');
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Connected Multi-Exchange Vault List */}
        <section className="xl:col-span-7 bg-white dark:bg-[#11161D] border border-slate-200 dark:border-slate-800/90 rounded-lg overflow-hidden">
          <div className="px-4 py-3.5 border-b border-slate-200 dark:border-slate-800/90 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-display font-semibold text-sm text-slate-900 dark:text-slate-100">
                Konektor Multi-Exchange Terenkripsi ({state.exchanges.length})
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Opsional tanpa login akun — gunakan kunci read-only untuk sinkronisasi harga atau vault AES-256-GCM sisi server.
              </p>
            </div>
            <div className="flex items-center gap-1.5 text-xs font-mono text-emerald-600 dark:text-emerald-400">
              <Lock className="w-3.5 h-3.5" aria-hidden="true" />
              <span>AES-256-GCM Vault</span>
            </div>
          </div>

          <div className="divide-y divide-slate-200 dark:divide-slate-800/80">
            {state.exchanges.map((conn) => (
              <div
                key={conn.id}
                className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-display font-semibold text-slate-900 dark:text-slate-100">
                      {conn.label}
                    </span>
                    <span aria-hidden="true" className="text-slate-400">·</span>
                    <span className="text-xs font-mono uppercase text-amber-600 dark:text-amber-400">
                      {conn.exchange}
                    </span>
                  </div>
                  <div className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-2">
                    <span>Key: {conn.apiKeyMasked}</span>
                    <span aria-hidden="true">·</span>
                    <span>Mode: {conn.mode === 'paper' ? 'Radar Feed / Simulasi' : 'Live Terenkripsi'}</span>
                    <span aria-hidden="true">·</span>
                    <span>Latensi {conn.latencyMs} ms</span>
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Pasar: {conn.supportedSymbols.join(', ')} · Terhubung {formatDateTime(conn.createdAt)}
                  </div>
                </div>

                <div className="flex items-center gap-3 self-end sm:self-center shrink-0">
                  <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                    Terhubung
                  </span>
                  <button
                    type="button"
                    onClick={() => void onDeleteExchange(conn.id)}
                    aria-label={`Cabut koneksi ${conn.label}`}
                    className="p-2 rounded-md border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-rose-500 hover:border-rose-500/40 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Add New Encrypted Exchange Connection Form */}
        <form
          onSubmit={handleExchangeSubmit}
          noValidate
          className="xl:col-span-5 bg-white dark:bg-[#11161D] border border-slate-200 dark:border-slate-800/90 rounded-lg p-5 space-y-4"
        >
          <div>
            <h2 className="font-display font-semibold text-sm text-slate-900 dark:text-slate-100">
              Tambah Konektor Exchange Baru
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Opsional: hubungkan kunci API multi-exchange Kripto &amp; XAU/USD (Binance, Bybit, OKX, OANDA, Indodax).
            </p>
          </div>

          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="ex-platform" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Platform Exchange
                </label>
                <select
                  id="ex-platform"
                  value={exchange}
                  onChange={(e) => setExchange(e.target.value as ExchangeId)}
                  className="w-full px-3 py-2 rounded-md bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                >
                  <option value="binance">Binance</option>
                  <option value="bybit">Bybit</option>
                  <option value="okx">OKX</option>
                  <option value="oanda">OANDA (XAU/USD)</option>
                  <option value="indodax">Indodax</option>
                </select>
              </div>
              <div>
                <label htmlFor="ex-mode" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Mode Konektor
                </label>
                <select
                  id="ex-mode"
                  value={mode}
                  onChange={(e) => setMode(e.target.value as 'paper' | 'live_encrypted')}
                  className="w-full px-3 py-2 rounded-md bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                >
                  <option value="paper">Radar Analisa (Read-Only)</option>
                  <option value="live_encrypted">Live Terenkripsi</option>
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="ex-label" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                Label Koneksi
              </label>
              <input
                id="ex-label"
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Contoh: OKX Feed Kripto Utama"
                className="w-full px-3 py-2 rounded-md bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
              />
            </div>

            <div>
              <label htmlFor="ex-key" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                Exchange Public API Key
              </label>
              <input
                id="ex-key"
                type="text"
                autoComplete="off"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Masukkan key exchange (dienkripsi di server)"
                className="w-full px-3 py-2 rounded-md font-mono bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
              />
            </div>

            <div>
              <label htmlFor="ex-secret" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                Exchange Secret Key
              </label>
              <input
                id="ex-secret"
                type="password"
                autoComplete="new-password"
                value={apiSecret}
                onChange={(e) => setApiSecret(e.target.value)}
                placeholder="••••••••••••••••"
                className="w-full px-3 py-2 rounded-md font-mono bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
              />
            </div>
          </div>

          {formError && (
            <div role="alert" className="text-xs text-rose-500">
              {formError}
            </div>
          )}
          {formSuccess && (
            <div className="text-xs text-emerald-600 dark:text-emerald-400">{formSuccess}</div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 text-xs font-semibold rounded-md bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white transition-colors"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            {submitting ? 'Mengenkripsi...' : 'Enkripsi & Hubungkan Exchange'}
          </button>
        </form>
      </div>

      {/* Automated Risk Management Guardrails */}
      <form
        onSubmit={handleRiskSave}
        className="bg-white dark:bg-[#11161D] border border-slate-200 dark:border-slate-800/90 rounded-lg p-5 space-y-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200 dark:border-slate-800/90">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-5 h-5 text-amber-500" aria-hidden="true" />
            <div>
              <h2 className="font-display font-semibold text-sm text-slate-900 dark:text-slate-100">
                Manajemen Risiko Otomatis &amp; Filter Notifikasi Aksi
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Mengatur gerbang akurasi minimal 90%, target TP/SL, batas kerugian harian, dan circuit breaker volatilitas.
              </p>
            </div>
          </div>
          <button
            type="submit"
            className="px-4 py-2 text-xs font-semibold rounded-md bg-slate-900 dark:bg-amber-600 hover:bg-slate-800 dark:hover:bg-amber-500 text-white transition-colors whitespace-nowrap"
          >
            Simpan Parameter Risiko
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
          <div>
            <label htmlFor="rk-conf" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
              Min Akurasi Sinyal (%)
            </label>
            <input
              id="rk-conf"
              type="number"
              min={70}
              max={98}
              value={riskDraft.minConfidencePct}
              onChange={(e) =>
                setRiskDraft({ ...riskDraft, minConfidencePct: Number(e.target.value) })
              }
              className="w-full px-3 py-2 rounded-md font-mono tabular-nums bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100"
            />
          </div>

          <div>
            <label htmlFor="rk-maxrisk" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
              Batas Maks Skor Risiko (/100)
            </label>
            <input
              id="rk-maxrisk"
              type="number"
              min={10}
              max={60}
              value={riskDraft.maxRiskScore}
              onChange={(e) =>
                setRiskDraft({ ...riskDraft, maxRiskScore: Number(e.target.value) })
              }
              className="w-full px-3 py-2 rounded-md font-mono tabular-nums bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100"
            />
          </div>

          <div>
            <label htmlFor="rk-sl" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
              Stop-Loss Default (%)
            </label>
            <input
              id="rk-sl"
              type="number"
              min={0.2}
              max={5}
              step={0.05}
              value={riskDraft.stopLossPct}
              onChange={(e) =>
                setRiskDraft({ ...riskDraft, stopLossPct: Number(e.target.value) })
              }
              className="w-full px-3 py-2 rounded-md font-mono tabular-nums bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100"
            />
          </div>

          <div>
            <label htmlFor="rk-tp" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
              Auto Take-Profit Target (%)
            </label>
            <input
              id="rk-tp"
              type="number"
              min={0.5}
              max={15}
              step={0.1}
              value={riskDraft.takeProfitPct}
              onChange={(e) =>
                setRiskDraft({ ...riskDraft, takeProfitPct: Number(e.target.value) })
              }
              className="w-full px-3 py-2 rounded-md font-mono tabular-nums bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100"
            />
          </div>

          <div>
            <label htmlFor="rk-dailyloss" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
              Batas Kerugian Harian (%)
            </label>
            <input
              id="rk-dailyloss"
              type="number"
              min={0.5}
              max={10}
              step={0.25}
              value={riskDraft.maxDailyLossPct}
              onChange={(e) =>
                setRiskDraft({ ...riskDraft, maxDailyLossPct: Number(e.target.value) })
              }
              className="w-full px-3 py-2 rounded-md font-mono tabular-nums bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100"
            />
          </div>

          <div>
            <label htmlFor="rk-pospct" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
              Maks Alokasi per Posisi (%)
            </label>
            <input
              id="rk-pospct"
              type="number"
              min={1}
              max={25}
              step={1}
              value={riskDraft.maxPositionPct}
              onChange={(e) =>
                setRiskDraft({ ...riskDraft, maxPositionPct: Number(e.target.value) })
              }
              className="w-full px-3 py-2 rounded-md font-mono tabular-nums bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100"
            />
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="rk-volhalt" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
              Pengali Volatilitas Circuit Breaker (x ATR)
            </label>
            <input
              id="rk-volhalt"
              type="number"
              min={1.5}
              max={6}
              step={0.1}
              value={riskDraft.volatilityHaltMultiplier}
              onChange={(e) =>
                setRiskDraft({ ...riskDraft, volatilityHaltMultiplier: Number(e.target.value) })
              }
              className="w-full px-3 py-2 rounded-md font-mono tabular-nums bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 text-xs">
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={riskDraft.autoTakeProfitEnabled}
              onChange={(e) =>
                setRiskDraft({ ...riskDraft, autoTakeProfitEnabled: e.target.checked })
              }
              className="mt-0.5 accent-amber-500"
            />
            <span>
              <strong className="block text-slate-900 dark:text-slate-100">
                Notifikasi &amp; Auto-Sell Target TP
              </strong>
              <span className="text-slate-500 dark:text-slate-400">
                Memicu peringatan jual otomatis segera setelah harga menyentuh Take-Profit.
              </span>
            </span>
          </label>

          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={riskDraft.autoCircuitBreakerEnabled}
              onChange={(e) =>
                setRiskDraft({ ...riskDraft, autoCircuitBreakerEnabled: e.target.checked })
              }
              className="mt-0.5 accent-amber-500"
            />
            <span>
              <strong className="block text-slate-900 dark:text-slate-100">
                Circuit Breaker Fluktuasi Tajam
              </strong>
              <span className="text-slate-500 dark:text-slate-400">
                Menjeda radar sinyal otomatis saat volatilitas melewati {riskDraft.volatilityHaltMultiplier}x ATR.
              </span>
            </span>
          </label>

          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={riskDraft.adaptiveLearningEnabled}
              onChange={(e) =>
                setRiskDraft({ ...riskDraft, adaptiveLearningEnabled: e.target.checked })
              }
              className="mt-0.5 accent-amber-500"
            />
            <span>
              <strong className="block text-slate-900 dark:text-slate-100">
                Pembelajaran Pola Pasar Adaptif
              </strong>
              <span className="text-slate-500 dark:text-slate-400">
                Mengoptimalkan bobot indikator teknikal secara otomatis setiap 15 siklus pasar.
              </span>
            </span>
          </label>
        </div>

        {riskSavedMsg && (
          <div className="text-xs text-emerald-600 dark:text-emerald-400">{riskSavedMsg}</div>
        )}
      </form>
    </div>
  );
}
