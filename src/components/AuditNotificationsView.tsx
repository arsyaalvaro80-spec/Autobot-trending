import { useMemo, useState } from 'react';
import { Bell, CheckCheck, Search, Send, Volume2, VolumeX } from 'lucide-react';
import type { AuditLogEntry, MarketSymbol } from '../engine/types';
import { formatDateTime, type AppStateSnapshot } from '../types/app';

interface AuditNotificationsViewProps {
  state: AppStateSnapshot;
  selectedSymbol: MarketSymbol;
  pushPermission: NotificationPermission | 'unsupported';
  soundEnabled: boolean;
  onToggleSound: () => void;
  onRequestPushPermission: () => Promise<void>;
  onTestNotification: (symbol: MarketSymbol) => Promise<void>;
  onMarkAllRead: () => Promise<void>;
}

const CATEGORIES: Array<'ALL' | AuditLogEntry['category']> = [
  'ALL',
  'SIGNAL',
  'EXECUTION',
  'RISK',
  'ANOMALY',
  'LEARNING',
  'EXCHANGE',
];

export function AuditNotificationsView({
  state,
  selectedSymbol,
  pushPermission,
  soundEnabled,
  onToggleSound,
  onRequestPushPermission,
  onTestNotification,
  onMarkAllRead,
}: AuditNotificationsViewProps) {
  const [category, setCategory] = useState<'ALL' | AuditLogEntry['category']>('ALL');
  const [search, setSearch] = useState('');
  const [sendingTest, setSendingTest] = useState(false);

  const filteredLogs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return state.auditLogs.filter((entry) => {
      if (category !== 'ALL' && entry.category !== category) return false;
      if (!q) return true;
      return (
        entry.title.toLowerCase().includes(q) ||
        entry.detail.toLowerCase().includes(q) ||
        (entry.symbol?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [state.auditLogs, category, search]);

  const unreadCount = state.notifications.filter((n) => !n.read).length;

  const handleTest = async () => {
    setSendingTest(true);
    try {
      await onTestNotification(selectedSymbol);
    } finally {
      setSendingTest(false);
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
      {/* Push Notification Center */}
      <section className="xl:col-span-5 bg-white dark:bg-[#11161D] border border-slate-200 dark:border-slate-800/90 rounded-lg overflow-hidden">
        <div className="px-4 py-3.5 border-b border-slate-200 dark:border-slate-800/90 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="font-display font-semibold text-sm text-slate-900 dark:text-slate-100">
                Pusat Notifikasi Aksi ({unreadCount} belum dibaca)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Notifikasi real-time sinyal &ge;90%, target harga tercapai, dan anomali pasar.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void onMarkAllRead()}
              className="flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400 hover:underline whitespace-nowrap shrink-0"
            >
              <CheckCheck className="w-3.5 h-3.5" aria-hidden="true" />
              Tandai Dibaca
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200 dark:border-slate-800/80 text-xs">
            <span className="text-slate-600 dark:text-slate-300">
              Push Browser:{' '}
              <strong className="text-slate-900 dark:text-white">
                {pushPermission === 'granted'
                  ? 'Aktif'
                  : pushPermission === 'denied'
                    ? 'Diblokir Browser'
                    : pushPermission === 'unsupported'
                      ? 'Tidak Didukung'
                      : 'Belum Diaktifkan'}
              </strong>
            </span>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={onToggleSound}
                aria-pressed={soundEnabled}
                className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
              >
                {soundEnabled ? (
                  <Volume2 className="w-3.5 h-3.5 text-amber-500" aria-hidden="true" />
                ) : (
                  <VolumeX className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                )}
                {soundEnabled ? 'Suara Aktif' : 'Suara Bisukan'}
              </button>

              <button
                type="button"
                disabled={sendingTest}
                onClick={() => void handleTest()}
                className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 dark:hover:bg-slate-700 text-white border border-slate-700 transition-colors whitespace-nowrap disabled:opacity-50"
              >
                <Send className="w-3 h-3" aria-hidden="true" />
                {sendingTest ? 'Mengirim...' : 'Kirim Uji Notifikasi'}
              </button>

              {pushPermission === 'default' && (
                <button
                  type="button"
                  onClick={() => void onRequestPushPermission()}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md bg-amber-600 hover:bg-amber-500 text-white transition-colors whitespace-nowrap"
                >
                  <Bell className="w-3.5 h-3.5" aria-hidden="true" />
                  Aktifkan Push
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="divide-y divide-slate-200 dark:divide-slate-800/80 max-h-[540px] overflow-y-auto">
          {state.notifications.map((notif) => (
            <div
              key={notif.id}
              className={`p-4 space-y-1 ${
                notif.read ? 'opacity-75' : 'bg-amber-500/[0.04]'
              }`}
            >
              <div className="flex items-center justify-between gap-2 text-xs">
                <span
                  className={`font-semibold ${
                    notif.type === 'ANOMALY_HALT' || notif.type === 'DAILY_LOSS_HALT'
                      ? 'text-rose-600 dark:text-rose-400'
                      : notif.type === 'VOLATILITY_ALERT' || notif.type === 'PRICE_TARGET'
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-emerald-600 dark:text-emerald-400'
                  }`}
                >
                  {notif.title}
                </span>
                <span className="font-mono tabular-nums text-[11px] text-slate-500 dark:text-slate-400 shrink-0">
                  {formatDateTime(notif.timestamp)}
                </span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                {notif.message}
              </p>
              <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                {notif.symbol ?? 'SISTEM'} · {notif.type.replace(/_/g, ' ')}
                {notif.actionRecommended ? ` · Aksi ${notif.actionRecommended}` : ''}
                {notif.confidence ? ` · Akurasi ${notif.confidence}%` : ''}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Transparent Activity Audit Log */}
      <section className="xl:col-span-7 bg-white dark:bg-[#11161D] border border-slate-200 dark:border-slate-800/90 rounded-lg overflow-hidden">
        <div className="px-4 py-3.5 border-b border-slate-200 dark:border-slate-800/90 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-display font-semibold text-sm text-slate-900 dark:text-slate-100">
                Log Aktivitas &amp; Audit Transparansi ({filteredLogs.length})
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Rekam jejak kronologis setiap eksekusi, validasi risiko, adaptasi strategi, dan proteksi dana.
              </p>
            </div>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" aria-hidden="true" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari log audit..."
                aria-label="Cari log aktivitas audit"
                className="pl-8 pr-3 py-1.5 text-xs rounded-md bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filter kategori log">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setCategory(cat)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  category === cat
                    ? 'bg-slate-900 dark:bg-amber-600 text-white'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {cat === 'ALL' ? 'Semua' : cat}
              </button>
            ))}
          </div>
        </div>

        <div className="divide-y divide-slate-200 dark:divide-slate-800/80 max-h-[540px] overflow-y-auto">
          {filteredLogs.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
              Tidak ada entri log audit yang sesuai dengan filter.
            </div>
          ) : (
            filteredLogs.map((entry) => (
              <div key={entry.id} className="px-4 py-3 space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span
                      className={`font-mono font-semibold ${
                        entry.severity === 'critical'
                          ? 'text-rose-600 dark:text-rose-400'
                          : entry.severity === 'warning'
                            ? 'text-amber-600 dark:text-amber-400'
                            : entry.severity === 'success'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-sky-600 dark:text-sky-400'
                      }`}
                    >
                      {entry.category}
                    </span>
                    <span aria-hidden="true" className="text-slate-400">·</span>
                    <span className="font-medium text-slate-900 dark:text-slate-100">
                      {entry.title}
                    </span>
                  </div>
                  <span className="font-mono tabular-nums text-[11px] text-slate-500 dark:text-slate-400">
                    {formatDateTime(entry.timestamp)}
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  {entry.detail}
                </p>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
