import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  BarChart3,
  Bell,
  CandlestickChart as ChartIcon,
  FileText,
  FlaskConical,
  KeyRound,
  Menu,
  Moon,
  Pause,
  Play,
  Sparkles,
  Sun,
  X,
} from 'lucide-react';
import type { BotNotification, ExchangeId, MarketSymbol, RiskConfig } from './engine/types';
import { formatUsd, type AppStateSnapshot, type NavSection } from './types/app';
import { AnalyticsView } from './components/AnalyticsView';
import { AuditNotificationsView } from './components/AuditNotificationsView';
import { BacktestView } from './components/BacktestView';
import { ExchangeVaultView } from './components/ExchangeVaultView';
import { GeminiStudioView } from './components/GeminiStudioView';
import { OfflineIndicator, PWAInstallButton } from './components/PWAControls';
import { TerminalView } from './components/TerminalView';

const NAV_ITEMS: Array<{ id: NavSection; label: string; icon: typeof ChartIcon }> = [
  { id: 'terminal', label: 'Radar Pasar', icon: ChartIcon },
  { id: 'analytics', label: 'Portofolio & Analitik', icon: BarChart3 },
  { id: 'backtest', label: 'Backtesting', icon: FlaskConical },
  { id: 'exchanges', label: 'Exchange & Risiko', icon: KeyRound },
  { id: 'audit', label: 'Notifikasi & Audit', icon: FileText },
  { id: 'gemini', label: 'Studio AI Gemini', icon: Sparkles },
];

function playAlertChime() {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1174.66, ctx.currentTime + 0.14);
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.28);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.28);
  } catch {
    // Ignore autoplay restriction errors before user gesture
  }
}

export default function App() {
  const [section, setSection] = useState<NavSection>('terminal');
  const [selectedSymbol, setSelectedSymbol] = useState<MarketSymbol>('XAU/USD');
  const [state, setState] = useState<AppStateSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isDark, setIsDark] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [liveBanner, setLiveBanner] = useState<BotNotification | null>(null);
  const [pushPermission, setPushPermission] = useState<
    NotificationPermission | 'unsupported'
  >(() =>
    typeof window !== 'undefined' && 'Notification' in window
      ? Notification.permission
      : 'unsupported'
  );
  const lastSeenNotifIdRef = useRef<string | null>(null);
  const soundEnabledRef = useRef(soundEnabled);
  soundEnabledRef.current = soundEnabled;

  const dispatchFreshNotification = useCallback((newest: BotNotification | undefined) => {
    if (!newest) return;
    if (lastSeenNotifIdRef.current && newest.id !== lastSeenNotifIdRef.current && !newest.read) {
      if (soundEnabledRef.current) {
        playAlertChime();
      }
      if (
        newest.type === 'SIGNAL_90' ||
        newest.type === 'PRICE_TARGET' ||
        newest.type === 'ANOMALY_HALT' ||
        newest.type === 'DAILY_LOSS_HALT'
      ) {
        setLiveBanner(newest);
      }
      if (
        typeof window !== 'undefined' &&
        'Notification' in window &&
        Notification.permission === 'granted'
      ) {
        new Notification(newest.title, { body: newest.message });
      }
    }
    lastSeenNotifIdRef.current = newest.id;
  }, []);

  const syncTheme = useCallback((dark: boolean) => {
    setIsDark(dark);
    if (dark) {
      document.documentElement.classList.add('dark');
      document.body.classList.add('bg-[#0B0F14]', 'text-slate-100');
      document.body.classList.remove('bg-[#F8FAFC]', 'text-slate-900');
    } else {
      document.documentElement.classList.remove('dark');
      document.body.classList.remove('bg-[#0B0F14]', 'text-slate-100');
      document.body.classList.add('bg-[#F8FAFC]', 'text-slate-900');
    }
  }, []);

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch('/api/state');
      if (!res.ok) throw new Error('Gagal memuat status radar analisa.');
      const next = (await res.json()) as AppStateSnapshot;
      setState(next);
      setLoadError(null);
      dispatchFreshNotification(next.notifications[0]);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Koneksi server terputus.');
    }
  }, [dispatchFreshNotification]);

  useEffect(() => {
    void fetchState();
    const timer = window.setInterval(() => {
      void fetchState();
    }, 3500);
    return () => window.clearInterval(timer);
  }, [fetchState]);

  const mutateJson = async (url: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown) => {
    const res = await fetch(url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Permintaan gagal diproses.');
    }
    const next = data as AppStateSnapshot;
    setState(next);
    dispatchFreshNotification(next.notifications[0]);
  };

  const handleToggleBot = async () => {
    if (!state) return;
    try {
      await mutateJson('/api/bot/toggle', 'POST', { running: !state.running });
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Gagal mengubah status radar.');
    }
  };

  const handleExecuteOrder = async (payload: {
    symbol: MarketSymbol;
    side: 'BUY' | 'SELL';
    exchange: ExchangeId;
    positionPct: number;
    overrideRiskGate: boolean;
  }) => {
    await mutateJson('/api/bot/execute', 'POST', payload);
  };

  const handleClosePosition = async (positionId: string) => {
    await mutateJson('/api/bot/close-position', 'POST', { positionId });
  };

  const handleUpdatePositionTargets = async (
    positionId: string,
    stopLoss: number,
    takeProfit: number
  ) => {
    await mutateJson(`/api/positions/${encodeURIComponent(positionId)}/targets`, 'PATCH', {
      stopLoss,
      takeProfit,
    });
  };

  const handleCreateAlert = async (payload: {
    symbol: MarketSymbol;
    condition: 'ABOVE' | 'BELOW';
    targetPrice: number;
    recommendedAction: 'BUY' | 'SELL';
    note: string;
  }) => {
    await mutateJson('/api/alerts', 'POST', payload);
  };

  const handleDeleteAlert = async (alertId: string) => {
    await mutateJson(`/api/alerts/${encodeURIComponent(alertId)}`, 'DELETE');
  };

  const handleSimulateAnomaly = async (symbol: MarketSymbol) => {
    await mutateJson('/api/bot/simulate-anomaly', 'POST', { symbol });
  };

  const handleResetCircuitBreaker = async () => {
    await mutateJson('/api/bot/reset-circuit-breaker', 'POST');
  };

  const handleRunAdaptiveLearning = async (symbol: MarketSymbol) => {
    await mutateJson('/api/bot/optimize', 'POST', { symbol });
  };

  const handleAddExchange = async (payload: {
    exchange: ExchangeId;
    label: string;
    apiKey: string;
    apiSecret: string;
    mode: 'paper' | 'live_encrypted';
  }) => {
    await mutateJson('/api/exchanges', 'POST', payload);
  };

  const handleDeleteExchange = async (id: string) => {
    await mutateJson(`/api/exchanges/${encodeURIComponent(id)}`, 'DELETE');
  };

  const handleSaveRiskConfig = async (config: RiskConfig) => {
    await mutateJson('/api/bot/config', 'POST', config);
  };

  const handleMarkAllRead = async () => {
    await mutateJson('/api/notifications/read-all', 'POST');
    setLiveBanner(null);
  };

  const handleTestNotification = async (symbol: MarketSymbol) => {
    await mutateJson('/api/notifications/test', 'POST', { symbol });
  };

  const handleRequestPushPermission = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    const perm = await Notification.requestPermission();
    setPushPermission(perm);
  };

  const activeNav = NAV_ITEMS.find((item) => item.id === section) ?? NAV_ITEMS[0];
  const unreadNotifs = state?.notifications.filter((n) => !n.read).length ?? 0;

  return (
    <div className="min-h-screen flex bg-[#F8FAFC] dark:bg-[#0B0F14] text-slate-900 dark:text-slate-100 overflow-x-hidden">
      {/* Desktop Sidebar (248px) */}
      <aside className="hidden lg:flex lg:flex-col w-[248px] shrink-0 border-r border-slate-200 dark:border-slate-800/90 bg-white dark:bg-[#0E1319]">
        <div className="h-14 px-5 flex items-center border-b border-slate-200 dark:border-slate-800/90">
          <span className="font-display font-bold text-base tracking-tight text-slate-900 dark:text-white whitespace-nowrap">
            Aurex Quant
          </span>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1" aria-label="Navigasi utama">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                className={`w-full flex items-center justify-between gap-2.5 px-3 py-2.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-amber-500/12 text-amber-700 dark:text-amber-300'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                <span className="flex items-center gap-2.5 truncate">
                  <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">{item.label}</span>
                </span>
                {item.id === 'audit' && unreadNotifs > 0 && (
                  <span className="font-mono tabular-nums text-xs text-amber-600 dark:text-amber-400">
                    {unreadNotifs}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Compact Equity & PWA Install Footer */}
        <div className="p-4 border-t border-slate-200 dark:border-slate-800/90 space-y-3 text-xs">
          {state && (
            <div className="space-y-1">
              <div className="text-slate-500 dark:text-slate-400">Simulasi Ekuitas Pantauan</div>
              <div className="font-mono tabular-nums text-base font-bold text-slate-900 dark:text-white">
                {formatUsd(state.equityUsd)}
              </div>
              <div className="flex items-center gap-1.5 font-mono tabular-nums text-[11px] text-slate-500 dark:text-slate-400">
                <Activity className="w-3.5 h-3.5 text-amber-500" aria-hidden="true" />
                <span>
                  {state.circuitBreakerTripped
                    ? 'Circuit Breaker Aktif'
                    : state.running
                      ? 'Radar Analisa Aktif'
                      : 'Radar Dijeda'}
                </span>
              </div>
            </div>
          )}
          <PWAInstallButton />
        </div>
      </aside>

      {/* Mobile Slide-Over Navigation */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/60"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative z-10 w-64 max-w-[82vw] bg-white dark:bg-[#0E1319] border-r border-slate-200 dark:border-slate-800 flex flex-col">
            <div className="h-14 px-4 flex items-center justify-between border-b border-slate-200 dark:border-slate-800">
              <span className="font-display font-bold text-base text-slate-900 dark:text-white">
                Aurex Quant
              </span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Tutup menu navigasi"
                className="p-2 text-slate-500 hover:text-slate-900 dark:hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 p-3 space-y-1" aria-label="Navigasi seluler">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = section === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setSection(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2.5 text-sm font-medium rounded-md ${
                      active
                        ? 'bg-amber-500/12 text-amber-700 dark:text-amber-300'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    <span className="flex items-center gap-2.5">
                      <Icon className="w-4 h-4" aria-hidden="true" />
                      {item.label}
                    </span>
                    {item.id === 'audit' && unreadNotifs > 0 && (
                      <span className="font-mono text-xs text-amber-500">{unreadNotifs}</span>
                    )}
                  </button>
                );
              })}
            </nav>
            <div className="p-4 border-t border-slate-200 dark:border-slate-800">
              <PWAInstallButton />
            </div>
          </aside>
        </div>
      )}

      {/* Main Content Shell */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Clean Top Bar (3-zone workspace header <= 56px) */}
        <header className="sticky top-0 z-30 h-14 px-4 lg:px-6 flex items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800/90 bg-white/95 dark:bg-[#0B0F14]/95 backdrop-blur">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Buka menu navigasi"
              className="lg:hidden p-2 -ml-2 rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="hidden lg:inline text-slate-400 whitespace-nowrap">Aurex Quant</span>
              <span aria-hidden="true" className="hidden lg:inline text-slate-400">/</span>
              <h1 className="font-display font-semibold text-slate-900 dark:text-white truncate">
                {activeNav.label}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setSection('audit')}
              aria-label={`Buka pusat notifikasi (${unreadNotifs} belum dibaca)`}
              className="relative p-2 rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <Bell className="w-4 h-4" />
              {unreadNotifs > 0 && (
                <span className="absolute -top-0.5 -right-0.5 text-[10px] font-mono font-bold text-amber-500">
                  {unreadNotifs}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => syncTheme(!isDark)}
              aria-label={isDark ? 'Ganti ke tema terang' : 'Ganti ke tema gelap'}
              className="p-2 rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            {state && (
              <button
                type="button"
                onClick={() => void handleToggleBot()}
                className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  state.running
                    ? 'bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 dark:hover:bg-slate-700 text-white border border-slate-700'
                    : 'bg-amber-600 hover:bg-amber-500 text-white'
                }`}
              >
                {state.running ? (
                  <>
                    <Pause className="w-3.5 h-3.5" aria-hidden="true" />
                    Jeda Radar
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5" aria-hidden="true" />
                    Aktifkan Radar
                  </>
                )}
              </button>
            )}
          </div>
        </header>

        {/* Main Viewport */}
        <main className="flex-1 p-4 lg:p-6 max-w-[1440px] w-full mx-auto">
          {/* Dismissible Real-Time Action Signal Banner */}
          {liveBanner && (
            <div
              role="status"
              data-testid="live-action-banner"
              className="mb-4 flex items-start justify-between gap-3 p-3.5 rounded-lg bg-amber-500/10 border border-amber-500/40 text-xs"
            >
              <div className="space-y-0.5">
                <div className="font-display font-semibold text-amber-800 dark:text-amber-200">
                  {liveBanner.title}
                </div>
                <p className="text-slate-700 dark:text-slate-200">{liveBanner.message}</p>
              </div>
              <button
                type="button"
                onClick={() => setLiveBanner(null)}
                aria-label="Tutup banner notifikasi"
                className="p-1 text-slate-500 hover:text-slate-900 dark:hover:text-white shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {loadError && (
            <div
              role="alert"
              className="mb-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-xs text-rose-600 dark:text-rose-300"
            >
              {loadError}
            </div>
          )}

          {!state ? (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 animate-pulse">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-24 rounded-lg bg-slate-200 dark:bg-slate-800/60"
                />
              ))}
            </div>
          ) : (
            <>
              {section === 'terminal' && (
                <TerminalView
                  state={state}
                  selectedSymbol={selectedSymbol}
                  onSelectSymbol={setSelectedSymbol}
                  onExecuteOrder={handleExecuteOrder}
                  onClosePosition={handleClosePosition}
                  onUpdatePositionTargets={handleUpdatePositionTargets}
                  onCreateAlert={handleCreateAlert}
                  onDeleteAlert={handleDeleteAlert}
                  onSimulateAnomaly={handleSimulateAnomaly}
                  onResetCircuitBreaker={handleResetCircuitBreaker}
                  onRunAdaptiveLearning={handleRunAdaptiveLearning}
                />
              )}

              {section === 'analytics' && <AnalyticsView state={state} />}

              {section === 'backtest' && <BacktestView />}

              {section === 'exchanges' && (
                <ExchangeVaultView
                  state={state}
                  onAddExchange={handleAddExchange}
                  onDeleteExchange={handleDeleteExchange}
                  onSaveRiskConfig={handleSaveRiskConfig}
                />
              )}

              {section === 'audit' && (
                <AuditNotificationsView
                  state={state}
                  selectedSymbol={selectedSymbol}
                  pushPermission={pushPermission}
                  soundEnabled={soundEnabled}
                  onToggleSound={() => setSoundEnabled((v) => !v)}
                  onRequestPushPermission={handleRequestPushPermission}
                  onTestNotification={handleTestNotification}
                  onMarkAllRead={handleMarkAllRead}
                />
              )}

              {section === 'gemini' && (
                <GeminiStudioView state={state} selectedSymbol={selectedSymbol} />
              )}
            </>
          )}
        </main>
      </div>

      <OfflineIndicator />
    </div>
  );
}
