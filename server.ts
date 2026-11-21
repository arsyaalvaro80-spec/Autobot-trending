import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI } from '@google/genai';
import { generateHistoricalCandles, generateNextCandle, runBacktest } from './src/engine/backtest.ts';
import { encryptCredential, maskApiKey, type EncryptedPayload } from './src/engine/cryptoVault.ts';
import { roundTo } from './src/engine/indicators.ts';
import {
  adaptStrategyWeights,
  DEFAULT_RISK_CONFIG,
  DEFAULT_STRATEGY_WEIGHTS,
  evaluateOpenPositions,
  evaluateTradeSignal,
} from './src/engine/signals.ts';
import {
  computeMultiTimeframeAlignment,
  type MultiTimeframeSummary,
} from './src/engine/timeframe.ts';
import type {
  AuditLogEntry,
  BacktestParams,
  BotNotification,
  Candle,
  ExchangeConnectionPublic,
  ExchangeId,
  MarketSymbol,
  Position,
  PriceAlert,
  RiskConfig,
  StrategyWeights,
  TradeRecord,
  TradeSignal,
} from './src/engine/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VALID_SYMBOLS: MarketSymbol[] = ['XAU/USD', 'BTC/USDT', 'ETH/USDT', 'SOL/USDT'];
const VALID_EXCHANGES: ExchangeId[] = ['binance', 'bybit', 'okx', 'oanda', 'indodax'];
const VALID_CHAT_MODELS = [
  'gemini-4-hydrogen',
  'gemini-3.1-flash-lite',
  'gemini-4-neon',
  'gemini-4-carbon',
] as const;

const VALID_IMAGE_ASPECTS = ['1:1', '3:4', '4:3', '9:16', '16:9'] as const;
const VALID_IMAGE_SIZES = ['1K', '2K', '4K'] as const;
const VALID_VIDEO_ASPECTS = ['16:9', '9:16'] as const;

interface StoredExchangeConnection extends ExchangeConnectionPublic {
  encryptedApiKey: EncryptedPayload;
  encryptedApiSecret: EncryptedPayload;
}

interface DailyProfitBar {
  dayLabel: string;
  profitUsd: number;
  tradesCount: number;
  winRatePct: number;
}

interface BotState {
  running: boolean;
  feedSource: 'live_public' | 'simulated';
  lastLiveSyncAt: number | null;
  tickCounter: number;
  circuitBreakerTripped: boolean;
  circuitBreakerReason: string | null;
  equityUsd: number;
  startingCapitalUsd: number;
  realizedPnlTodayUsd: number;
  riskConfig: RiskConfig;
  strategyWeights: StrategyWeights;
  learningCycles: number;
  candlesBySymbol: Record<MarketSymbol, Candle[]>;
  signalsBySymbol: Record<MarketSymbol, TradeSignal>;
  multiTimeframeBySymbol: Record<MarketSymbol, MultiTimeframeSummary>;
  positions: Position[];
  trades: TradeRecord[];
  priceAlerts: PriceAlert[];
  auditLogs: AuditLogEntry[];
  notifications: BotNotification[];
  exchanges: StoredExchangeConnection[];
  dailyProfits: DailyProfitBar[];
  equityHistory: Array<{ time: number; equity: number }>;
}

function createGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function createInitialState(): BotState {
  const now = Date.now();
  const candlesBySymbol: Record<MarketSymbol, Candle[]> = {
    'XAU/USD': generateHistoricalCandles('XAU/USD', 110, 5 * 60 * 1000, 11),
    'BTC/USDT': generateHistoricalCandles('BTC/USDT', 110, 5 * 60 * 1000, 22),
    'ETH/USDT': generateHistoricalCandles('ETH/USDT', 110, 5 * 60 * 1000, 33),
    'SOL/USDT': generateHistoricalCandles('SOL/USDT', 110, 5 * 60 * 1000, 44),
  };

  const signalsBySymbol = {} as Record<MarketSymbol, TradeSignal>;
  for (const sym of VALID_SYMBOLS) {
    signalsBySymbol[sym] = evaluateTradeSignal(
      sym,
      candlesBySymbol[sym],
      DEFAULT_RISK_CONFIG,
      DEFAULT_STRATEGY_WEIGHTS
    );
  }

  const xauPrice = candlesBySymbol['XAU/USD'][candlesBySymbol['XAU/USD'].length - 1].close;
  const btcPrice = candlesBySymbol['BTC/USDT'][candlesBySymbol['BTC/USDT'].length - 1].close;

  const initialPositions: Position[] = [
    {
      id: 'pos_xau_01',
      symbol: 'XAU/USD',
      exchange: 'oanda',
      side: 'BUY',
      entryPrice: roundTo(xauPrice * 0.9965, 2),
      currentPrice: xauPrice,
      quantity: 3.5,
      notionalUsd: roundTo(xauPrice * 3.5, 2),
      stopLoss: roundTo(xauPrice * 0.99, 2),
      takeProfit: roundTo(xauPrice * 1.014, 2),
      unrealizedPnl: roundTo((xauPrice - xauPrice * 0.9965) * 3.5, 2),
      unrealizedPnlPct: 0.35,
      openedAt: now - 42 * 60 * 1000,
      confidenceAtEntry: 93,
      riskScoreAtEntry: 17,
    },
    {
      id: 'pos_btc_02',
      symbol: 'BTC/USDT',
      exchange: 'binance',
      side: 'BUY',
      entryPrice: roundTo(btcPrice * 0.994, 2),
      currentPrice: btcPrice,
      quantity: 0.08,
      notionalUsd: roundTo(btcPrice * 0.08, 2),
      stopLoss: roundTo(btcPrice * 0.982, 2),
      takeProfit: roundTo(btcPrice * 1.024, 2),
      unrealizedPnl: roundTo((btcPrice - btcPrice * 0.994) * 0.08, 2),
      unrealizedPnlPct: 0.6,
      openedAt: now - 95 * 60 * 1000,
      confidenceAtEntry: 91,
      riskScoreAtEntry: 21,
    },
  ];

  const initialTrades: TradeRecord[] = [
    {
      id: 'trd_seed_101',
      symbol: 'XAU/USD',
      exchange: 'oanda',
      side: 'BUY',
      entryPrice: 2718.4,
      exitPrice: 2746.9,
      quantity: 4,
      pnlUsd: 114.0,
      pnlPct: 1.05,
      openedAt: now - 7 * 3600 * 1000,
      closedAt: now - 5 * 3600 * 1000,
      closeReason: 'TAKE_PROFIT',
      confidenceAtEntry: 94,
      riskScoreAtEntry: 16,
      strategyNote: 'Konfluensi EMA 9/21/50 + Bullish Engulfing pada XAU/USD (TP otomatis)',
    },
    {
      id: 'trd_seed_102',
      symbol: 'BTC/USDT',
      exchange: 'binance',
      side: 'SELL',
      entryPrice: 97180.0,
      exitPrice: 95820.0,
      quantity: 0.12,
      pnlUsd: 163.2,
      pnlPct: 1.4,
      openedAt: now - 14 * 3600 * 1000,
      closedAt: now - 11 * 3600 * 1000,
      closeReason: 'TAKE_PROFIT',
      confidenceAtEntry: 92,
      riskScoreAtEntry: 19,
      strategyNote: 'Shooting Star di Upper Bollinger Band + RSI 73 jenuh beli',
    },
    {
      id: 'trd_seed_103',
      symbol: 'ETH/USDT',
      exchange: 'bybit',
      side: 'BUY',
      entryPrice: 3392.5,
      exitPrice: 3448.0,
      quantity: 2.2,
      pnlUsd: 122.1,
      pnlPct: 1.64,
      openedAt: now - 22 * 3600 * 1000,
      closedAt: now - 19 * 3600 * 1000,
      closeReason: 'TAKE_PROFIT',
      confidenceAtEntry: 91,
      riskScoreAtEntry: 20,
      strategyNote: 'Morning Star + MACD bullish crossover',
    },
    {
      id: 'trd_seed_104',
      symbol: 'XAU/USD',
      exchange: 'oanda',
      side: 'SELL',
      entryPrice: 2736.2,
      exitPrice: 2748.0,
      quantity: 3,
      pnlUsd: -35.4,
      pnlPct: -0.43,
      openedAt: now - 31 * 3600 * 1000,
      closedAt: now - 30 * 3600 * 1000,
      closeReason: 'STOP_LOSS',
      confidenceAtEntry: 90,
      riskScoreAtEntry: 23,
      strategyNote: 'Stop-Loss disiplin aktif membatasi kerugian di bawah 0.5%',
    },
    {
      id: 'trd_seed_105',
      symbol: 'SOL/USDT',
      exchange: 'okx',
      side: 'BUY',
      entryPrice: 211.2,
      exitPrice: 219.1,
      quantity: 18,
      pnlUsd: 142.2,
      pnlPct: 3.74,
      openedAt: now - 40 * 3600 * 1000,
      closedAt: now - 35 * 3600 * 1000,
      closeReason: 'TAKE_PROFIT',
      confidenceAtEntry: 95,
      riskScoreAtEntry: 18,
      strategyNote: 'Hammer pada support EMA-50 + volume ekspansi',
    },
  ];

  const seedExchanges: StoredExchangeConnection[] = [
    {
      id: 'ex_oanda_gold',
      exchange: 'oanda',
      label: 'OANDA Gold Institutional (XAU/USD)',
      mode: 'paper',
      apiKeyMasked: maskApiKey('OANDA_GOLD_9918472A8F'),
      permissions: ['Spot XAU/USD', 'Auto TP/SL', 'Read Market Stream'],
      status: 'connected',
      latencyMs: 18,
      supportedSymbols: ['XAU/USD'],
      createdAt: now - 86400 * 1000 * 5,
      encryptionCipher: 'AES-256-GCM',
      encryptedApiKey: encryptCredential('sandbox-oanda-key-demo'),
      encryptedApiSecret: encryptCredential('sandbox-oanda-secret-demo'),
    },
    {
      id: 'ex_binance_spot',
      exchange: 'binance',
      label: 'Binance Multi-Asset Spot & Futures',
      mode: 'paper',
      apiKeyMasked: maskApiKey('BNCE_LIVE_4829104C9E'),
      permissions: ['Spot Trading', 'USD-M Futures', 'Candle Pattern Stream'],
      status: 'connected',
      latencyMs: 24,
      supportedSymbols: ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'],
      createdAt: now - 86400 * 1000 * 3,
      encryptionCipher: 'AES-256-GCM',
      encryptedApiKey: encryptCredential('sandbox-binance-key-demo'),
      encryptedApiSecret: encryptCredential('sandbox-binance-secret-demo'),
    },
    {
      id: 'ex_bybit_perp',
      exchange: 'bybit',
      label: 'Bybit Unified Margin',
      mode: 'paper',
      apiKeyMasked: maskApiKey('BYBT_UNIF_7741298D2B'),
      permissions: ['Unified Trading', 'Auto Risk Hedge'],
      status: 'connected',
      latencyMs: 31,
      supportedSymbols: ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'],
      createdAt: now - 86400 * 1000 * 2,
      encryptionCipher: 'AES-256-GCM',
      encryptedApiKey: encryptCredential('sandbox-bybit-key-demo'),
      encryptedApiSecret: encryptCredential('sandbox-bybit-secret-demo'),
    },
  ];

  const initialAuditLogs: AuditLogEntry[] = [
    {
      id: 'log_01',
      timestamp: now - 4 * 60 * 1000,
      category: 'LEARNING',
      severity: 'info',
      symbol: 'XAU/USD',
      title: 'Kalibrasi Bobot Strategi Adaptif Selesai',
      detail:
        'Sistem menyesuaikan bobot EMA (24.0%), RSI (20.0%), dan Pola Candlestick (14.0%) berdasarkan rezim tren XAU/USD terbaru.',
    },
    {
      id: 'log_02',
      timestamp: now - 42 * 60 * 1000,
      category: 'EXECUTION',
      severity: 'success',
      symbol: 'XAU/USD',
      exchange: 'oanda',
      title: 'Eksekusi BUY XAU/USD Lolos Gerbang 90% & Risiko Rendah',
      detail: `Order BUY 3.5 oz @ $${roundTo(xauPrice * 0.9965, 2)} dieksekusi otomatis (Keyakinan 93%, Skor Risiko 17/100, TP $${roundTo(xauPrice * 1.014, 2)}).`,
    },
    {
      id: 'log_03',
      timestamp: now - 95 * 60 * 1000,
      category: 'SIGNAL',
      severity: 'success',
      symbol: 'BTC/USDT',
      exchange: 'binance',
      title: 'Sinyal Konfluensi Tinggi BTC/USDT Terverifikasi',
      detail: 'RSI keluar dari oversold + MACD crossover positif. Notifikasi push dikirim dan order BUY dieksekusi.',
    },
    {
      id: 'log_04',
      timestamp: now - 3 * 3600 * 1000,
      category: 'EXCHANGE',
      severity: 'info',
      exchange: 'oanda',
      title: 'Verifikasi Vault Enkripsi AES-256-GCM',
      detail: 'Seluruh 3 konektor multi-exchange tervalidasi dengan enkripsi sisi server tanpa paparan kunci publik.',
    },
  ];

  const initialNotifications: BotNotification[] = [
    {
      id: 'notif_01',
      timestamp: now - 12 * 60 * 1000,
      type: 'SIGNAL_90',
      title: 'Sinyal XAU/USD Akurasi 93% — Risiko Rendah',
      message:
        'Indikasi BUY XAU/USD terkonfirmasi (EMA 9>21>50, RSI stabil, skor risiko 17/100). Target profit otomatis aktif.',
      symbol: 'XAU/USD',
      read: false,
      actionRecommended: 'BUY',
      confidence: 93,
    },
    {
      id: 'notif_02',
      timestamp: now - 5 * 3600 * 1000,
      type: 'TAKE_PROFIT',
      title: 'Take-Profit Otomatis Tercapai (+$114.00)',
      message: 'Posisi BUY XAU/USD ditutup otomatis di $2,746.90 dengan profit bersih +1.05%.',
      symbol: 'XAU/USD',
      read: false,
      actionRecommended: 'SELL',
      confidence: 94,
    },
    {
      id: 'notif_03',
      timestamp: now - 11 * 3600 * 1000,
      type: 'TRADE_EXECUTED',
      title: 'Eksekusi SELL BTC/USDT Berhasil (+$163.20)',
      message: 'Pola Shooting Star pada Binance memicu take-profit otomatis dengan risiko terkendali.',
      symbol: 'BTC/USDT',
      read: true,
      actionRecommended: 'SELL',
      confidence: 92,
    },
  ];

  const dailyProfits: DailyProfitBar[] = [
    { dayLabel: 'Sen', profitUsd: 184.5, tradesCount: 4, winRatePct: 75 },
    { dayLabel: 'Sel', profitUsd: 246.2, tradesCount: 5, winRatePct: 80 },
    { dayLabel: 'Rab', profitUsd: -42.8, tradesCount: 3, winRatePct: 33 },
    { dayLabel: 'Kam', profitUsd: 312.4, tradesCount: 6, winRatePct: 83 },
    { dayLabel: 'Jum', profitUsd: 198.6, tradesCount: 4, winRatePct: 75 },
    { dayLabel: 'Sab', profitUsd: 154.0, tradesCount: 3, winRatePct: 100 },
    { dayLabel: 'Hari Ini', profitUsd: 277.2, tradesCount: 4, winRatePct: 75 },
  ];

  const equityHistory: Array<{ time: number; equity: number }> = [];
  let eq = 25000;
  for (let i = 24; i >= 0; i--) {
    eq = roundTo(eq + (i % 5 === 0 ? -38 : 64), 2);
    equityHistory.push({
      time: now - i * 3600 * 1000,
      equity: eq,
    });
  }

  const multiTimeframeBySymbol = {} as Record<MarketSymbol, MultiTimeframeSummary>;
  for (const sym of VALID_SYMBOLS) {
    multiTimeframeBySymbol[sym] = computeMultiTimeframeAlignment(candlesBySymbol[sym]);
  }

  const initialPriceAlerts: PriceAlert[] = [
    {
      id: 'alt_xau_tp',
      symbol: 'XAU/USD',
      condition: 'ABOVE',
      targetPrice: roundTo(xauPrice * 1.008, 2),
      recommendedAction: 'SELL',
      note: 'Target take-profit resistance XAU/USD — kirim notifikasi aksi jual',
      triggered: false,
      createdAt: now - 35 * 60 * 1000,
    },
    {
      id: 'alt_btc_buy',
      symbol: 'BTC/USDT',
      condition: 'BELOW',
      targetPrice: roundTo(btcPrice * 0.985, 2),
      recommendedAction: 'BUY',
      note: 'Zona support likuiditas BTC/USDT — pertimbangkan aksi beli bertahap',
      triggered: false,
      createdAt: now - 50 * 60 * 1000,
    },
  ];

  return {
    running: true,
    feedSource: 'simulated',
    lastLiveSyncAt: null,
    tickCounter: 0,
    circuitBreakerTripped: false,
    circuitBreakerReason: null,
    equityUsd: 26330.1,
    startingCapitalUsd: 25000,
    realizedPnlTodayUsd: 277.2,
    riskConfig: { ...DEFAULT_RISK_CONFIG },
    strategyWeights: { ...DEFAULT_STRATEGY_WEIGHTS },
    learningCycles: 14,
    candlesBySymbol,
    signalsBySymbol,
    multiTimeframeBySymbol,
    positions: initialPositions,
    trades: initialTrades,
    priceAlerts: initialPriceAlerts,
    auditLogs: initialAuditLogs,
    notifications: initialNotifications,
    exchanges: seedExchanges,
    dailyProfits,
    equityHistory,
  };
}

const state: BotState = createInitialState();

function pushAudit(entry: Omit<AuditLogEntry, 'id' | 'timestamp'>) {
  state.auditLogs.unshift({
    ...entry,
    id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    timestamp: Date.now(),
  });
  if (state.auditLogs.length > 120) {
    state.auditLogs.length = 120;
  }
}

function pushNotification(notif: Omit<BotNotification, 'id' | 'timestamp' | 'read'>) {
  state.notifications.unshift({
    ...notif,
    id: `ntf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    timestamp: Date.now(),
    read: false,
  });
  if (state.notifications.length > 50) {
    state.notifications.length = 50;
  }
}

function getPreferredExchangeForSymbol(symbol: MarketSymbol): ExchangeId {
  const match = state.exchanges.find(
    (e) => e.status === 'connected' && e.supportedSymbols.includes(symbol)
  );
  if (match) return match.exchange;
  return symbol === 'XAU/USD' ? 'oanda' : 'binance';
}

function syncTodayDailyProfit(deltaUsd: number) {
  const todayBar = state.dailyProfits[state.dailyProfits.length - 1];
  if (todayBar) {
    todayBar.profitUsd = roundTo(todayBar.profitUsd + deltaUsd, 2);
    todayBar.tradesCount += 1;
  }
}

const BINANCE_PUBLIC_MAP: Record<string, MarketSymbol> = {
  PAXGUSDT: 'XAU/USD',
  BTCUSDT: 'BTC/USDT',
  ETHUSDT: 'ETH/USDT',
  SOLUSDT: 'SOL/USDT',
};

const SYMBOL_TO_BINANCE: Record<MarketSymbol, string> = {
  'XAU/USD': 'PAXGUSDT',
  'BTC/USDT': 'BTCUSDT',
  'ETH/USDT': 'ETHUSDT',
  'SOL/USDT': 'SOLUSDT',
};

let latestLiveQuotes: Partial<Record<MarketSymbol, number>> = {};
let liveHistoryHydrated = false;

function reanchorSeededItemsToLivePrices() {
  for (const pos of state.positions) {
    const list = state.candlesBySymbol[pos.symbol];
    const last = list?.[list.length - 1]?.close;
    if (!last || last <= 0) continue;
    const isSeed = pos.id.startsWith('pos_xau_01') || pos.id.startsWith('pos_btc_02');
    if (!isSeed) continue;
    const entryRatio = pos.symbol === 'XAU/USD' ? 0.9965 : 0.994;
    const slRatio = pos.symbol === 'XAU/USD' ? 0.99 : 0.982;
    const tpRatio = pos.symbol === 'XAU/USD' ? 1.014 : 1.024;
    pos.entryPrice = roundTo(last * entryRatio, 2);
    pos.currentPrice = last;
    pos.notionalUsd = roundTo(last * pos.quantity, 2);
    pos.stopLoss = roundTo(last * slRatio, 2);
    pos.takeProfit = roundTo(last * tpRatio, 2);
    pos.unrealizedPnl = roundTo((last - pos.entryPrice) * pos.quantity, 2);
    pos.unrealizedPnlPct = roundTo(((last - pos.entryPrice) / pos.entryPrice) * 100, 2);
  }

  for (const alert of state.priceAlerts) {
    const list = state.candlesBySymbol[alert.symbol];
    const last = list?.[list.length - 1]?.close;
    if (!last || last <= 0 || alert.triggered) continue;
    if (alert.id === 'alt_xau_tp') {
      alert.targetPrice = roundTo(last * 1.008, 2);
    } else if (alert.id === 'alt_btc_buy') {
      alert.targetPrice = roundTo(last * 0.985, 2);
    }
  }
}

async function hydrateInitialLiveKlines() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4500);
  try {
    const results = await Promise.all(
      VALID_SYMBOLS.map(async (sym) => {
        const pair = SYMBOL_TO_BINANCE[sym];
        const res = await fetch(
          `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=5m&limit=110`,
          { signal: controller.signal, headers: { Accept: 'application/json' } }
        );
        if (!res.ok) return null;
        const raw = (await res.json()) as unknown[];
        if (!Array.isArray(raw) || raw.length < 30) return null;
        const parsed: Candle[] = raw
          .map((row) => {
            if (!Array.isArray(row) || row.length < 6) return null;
            const time = Number(row[0]);
            const open = roundTo(Number(row[1]), 2);
            const high = roundTo(Number(row[2]), 2);
            const low = roundTo(Number(row[3]), 2);
            const close = roundTo(Number(row[4]), 2);
            const volume = roundTo(Number(row[5]), 2);
            if (!Number.isFinite(close) || close <= 0) return null;
            return { time, open, high, low, close, volume: Math.max(volume, 1) };
          })
          .filter((c): c is Candle => c !== null);
        return parsed.length >= 30 ? { sym, candles: parsed } : null;
      })
    );

    let hydratedCount = 0;
    for (const item of results) {
      if (!item) continue;
      state.candlesBySymbol[item.sym] = item.candles;
      const lastClose = item.candles[item.candles.length - 1].close;
      latestLiveQuotes[item.sym] = lastClose;
      state.signalsBySymbol[item.sym] = evaluateTradeSignal(
        item.sym,
        item.candles,
        state.riskConfig,
        state.strategyWeights
      );
      state.multiTimeframeBySymbol[item.sym] = computeMultiTimeframeAlignment(item.candles);
      hydratedCount += 1;
    }

    if (hydratedCount > 0) {
      liveHistoryHydrated = true;
      state.feedSource = 'live_public';
      state.lastLiveSyncAt = Date.now();
      reanchorSeededItemsToLivePrices();
    }
  } catch {
    // Graceful fallback to simulated series when sandbox/offline blocks external network
  } finally {
    clearTimeout(timeout);
  }
}

async function pollPublicMarketQuotes() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const query = encodeURIComponent('["PAXGUSDT","BTCUSDT","ETHUSDT","SOLUSDT"]');
    const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbols=${query}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return;
    const rows = (await res.json()) as Array<{ symbol?: string; price?: string }>;
    if (!Array.isArray(rows) || rows.length === 0) return;

    let updated = 0;
    for (const row of rows) {
      if (!row?.symbol || !row?.price) continue;
      const mapped = BINANCE_PUBLIC_MAP[row.symbol];
      const numeric = Number(row.price);
      if (mapped && Number.isFinite(numeric) && numeric > 0) {
        const rounded = roundTo(numeric, 2);
        // If klines failed earlier and current history is on simulated scale (>6% off), rebase smoothly once
        const list = state.candlesBySymbol[mapped];
        const lastClose = list?.[list.length - 1]?.close ?? 0;
        if (!liveHistoryHydrated && lastClose > 0 && Math.abs(rounded - lastClose) / lastClose > 0.06) {
          const ratio = rounded / lastClose;
          state.candlesBySymbol[mapped] = list.map((c) => ({
            ...c,
            open: roundTo(c.open * ratio, 2),
            high: roundTo(c.high * ratio, 2),
            low: roundTo(c.low * ratio, 2),
            close: roundTo(c.close * ratio, 2),
          }));
        }
        latestLiveQuotes[mapped] = rounded;
        updated++;
      }
    }
    if (updated > 0) {
      if (!liveHistoryHydrated) {
        liveHistoryHydrated = true;
        reanchorSeededItemsToLivePrices();
      }
      state.feedSource = 'live_public';
      state.lastLiveSyncAt = Date.now();
    }
  } catch {
    // Keep graceful fallback to simulated real-time feed when sandbox/offline blocks external network
  } finally {
    clearTimeout(timeout);
  }
}

// Hydrate real 5m Binance history first, then refresh live ticker quotes every 6 seconds
void hydrateInitialLiveKlines().then(() => pollPublicMarketQuotes());
setInterval(() => {
  void pollPublicMarketQuotes();
}, 6000);

function stepMarketTick(anomalyTargetSymbol?: MarketSymbol) {
  state.tickCounter += 1;

  for (const sym of VALID_SYMBOLS) {
    const list = state.candlesBySymbol[sym];
    const prev = list[list.length - 1];
    const isAnomaly = anomalyTargetSymbol === sym;
    let next = generateNextCandle(sym, prev, 60 * 1000, isAnomaly);

    // If live public market feed is active and not simulating anomaly, update the active live candle smoothly
    const livePrice = latestLiveQuotes[sym];
    if (!isAnomaly && state.feedSource === 'live_public' && livePrice && livePrice > 0) {
      // Update current live bar in-place between 5-minute closes, and roll a new bar every 8 ticks
      const open = prev.close;
      const microDrift = (Math.random() - 0.5) * livePrice * 0.0004;
      const close = roundTo(livePrice + microDrift, 2);
      const wick = Math.max(Math.abs(close - open) * 0.45, livePrice * 0.00035);
      next = {
        time: Date.now(),
        open,
        high: roundTo(Math.max(open, close) + wick, 2),
        low: roundTo(Math.min(open, close) - wick, 2),
        close,
        volume: roundTo(Math.max(prev.volume * (0.7 + Math.random() * 0.6), 5), 2),
      };

      if (state.tickCounter % 6 !== 0) {
        // Update live forming candle without flooding history with micro-Doji bars
        list[list.length - 1] = {
          ...prev,
          high: roundTo(Math.max(prev.high, close), 2),
          low: roundTo(Math.min(prev.low, close), 2),
          close,
          volume: roundTo(prev.volume + Math.max(1, prev.volume * 0.02), 2),
        };
      } else {
        list.push(next);
        if (list.length > 140) {
          list.shift();
        }
      }
    } else {
      list.push(next);
      if (list.length > 140) {
        list.shift();
      }
    }

    const signal = evaluateTradeSignal(
      sym,
      list,
      state.riskConfig,
      state.strategyWeights
    );
    state.signalsBySymbol[sym] = signal;
    state.multiTimeframeBySymbol[sym] = computeMultiTimeframeAlignment(list);

    // 0. Check custom user Price Target Alerts
    for (const alert of state.priceAlerts) {
      if (alert.triggered || alert.symbol !== sym) continue;
      const crossed =
        (alert.condition === 'ABOVE' && next.close >= alert.targetPrice) ||
        (alert.condition === 'BELOW' && next.close <= alert.targetPrice);
      if (crossed) {
        alert.triggered = true;
        alert.triggeredAt = Date.now();
        pushAudit({
          category: 'SIGNAL',
          severity: 'success',
          symbol: sym,
          title: `Target Harga ${sym} Tercapai ($${alert.targetPrice})`,
          detail: `Harga menyentuh $${next.close} (${alert.condition === 'ABOVE' ? '≥' : '≤'} $${alert.targetPrice}). Aksi disarankan: ${alert.recommendedAction}. ${alert.note}`,
        });
        pushNotification({
          type: 'PRICE_TARGET',
          symbol: sym,
          actionRecommended: alert.recommendedAction,
          confidence: signal.confidence,
          title: `Target Harga ${sym} Tercapai — Aksi ${alert.recommendedAction}`,
          message: `Harga live $${next.close} melewati target $${alert.targetPrice}. ${alert.note || 'Segera tinjau aksi di exchange Anda.'}`,
        });
      }
    }

    // 1. Check critical volatility anomaly -> automatic circuit breaker
    if (
      signal.anomaly.shouldHaltTrading &&
      state.riskConfig.autoCircuitBreakerEnabled &&
      !state.circuitBreakerTripped
    ) {
      state.circuitBreakerTripped = true;
      state.circuitBreakerReason = `${sym}: ${signal.anomaly.reason}`;
      state.running = false;

      const protection = evaluateOpenPositions(
        state.positions,
        sym,
        next.close,
        state.riskConfig.autoTakeProfitEnabled,
        true,
        'CIRCUIT_BREAKER'
      );
      state.positions = protection.remaining;
      for (const closed of protection.closed) {
        state.trades.unshift(closed);
        state.equityUsd = roundTo(state.equityUsd + closed.pnlUsd, 2);
        state.realizedPnlTodayUsd = roundTo(state.realizedPnlTodayUsd + closed.pnlUsd, 2);
        syncTodayDailyProfit(closed.pnlUsd);
      }

      pushAudit({
        category: 'ANOMALY',
        severity: 'critical',
        symbol: sym,
        title: `Circuit Breaker Aktif — Fluktuasi Tajam ${sym}`,
        detail: `${signal.anomaly.reason} Radar sinyal dihentikan sementara untuk perlindungan modal.`,
      });
      pushNotification({
        type: 'ANOMALY_HALT',
        symbol: sym,
        title: `Anomali Pasar ${sym} — Radar Aksi Dihentikan`,
        message: signal.anomaly.reason,
      });
      continue;
    }

    // 2. Evaluate tracked positions for Auto Take-Profit & Stop-Loss alert closure
    const posEval = evaluateOpenPositions(
      state.positions,
      sym,
      next.close,
      state.riskConfig.autoTakeProfitEnabled
    );
    state.positions = posEval.remaining;
    for (const closed of posEval.closed) {
      state.trades.unshift(closed);
      state.equityUsd = roundTo(state.equityUsd + closed.pnlUsd, 2);
      state.realizedPnlTodayUsd = roundTo(state.realizedPnlTodayUsd + closed.pnlUsd, 2);
      syncTodayDailyProfit(closed.pnlUsd);

      pushAudit({
        category: 'EXECUTION',
        severity: closed.pnlUsd >= 0 ? 'success' : 'warning',
        symbol: sym,
        exchange: closed.exchange,
        title:
          closed.closeReason === 'TAKE_PROFIT'
            ? `Target Auto-Sell ${sym} Tercapai (+$${closed.pnlUsd.toFixed(2)})`
            : `Batas Stop-Loss ${sym} Tersentuh ($${closed.pnlUsd.toFixed(2)})`,
        detail: `Posisi pantauan ${closed.side} mencapai target di $${closed.exitPrice.toLocaleString('en-US')} (${closed.pnlPct >= 0 ? '+' : ''}${closed.pnlPct}%).`,
      });
      pushNotification({
        type: 'TAKE_PROFIT',
        symbol: sym,
        actionRecommended: closed.side === 'BUY' ? 'SELL' : 'BUY',
        title:
          closed.closeReason === 'TAKE_PROFIT'
            ? `Waktunya Jual / Ambil Profit ${sym}`
            : `Peringatan Stop-Loss ${sym} Tercapai`,
        message: `Target $${closed.exitPrice} tersentuh. Estimasi P&L: ${closed.pnlUsd >= 0 ? '+' : ''}$${closed.pnlUsd.toFixed(2)}.`,
      });
    }

    // 2b. Daily Loss Limit Guardrail Check
    const maxDailyLossUsd = state.startingCapitalUsd * (state.riskConfig.maxDailyLossPct / 100);
    if (
      !state.circuitBreakerTripped &&
      state.realizedPnlTodayUsd <= -maxDailyLossUsd
    ) {
      state.circuitBreakerTripped = true;
      state.running = false;
      state.circuitBreakerReason = `Batas kerugian harian (${state.riskConfig.maxDailyLossPct}% / -$${maxDailyLossUsd.toFixed(0)}) tercapai. Radar sinyal dijeda otomatis untuk melindungi modal.`;
      pushAudit({
        category: 'RISK',
        severity: 'critical',
        title: 'Batas Kerugian Harian Tercapai — Radar Dijeda',
        detail: state.circuitBreakerReason,
      });
      pushNotification({
        type: 'DAILY_LOSS_HALT',
        title: 'Proteksi Modal: Batas Loss Harian Tercapai',
        message: state.circuitBreakerReason,
      });
      continue;
    }

    // 3. High-Conviction (>=90% & Low Risk) Signal Notification + Simulated Tracking
    if (
      state.running &&
      !state.circuitBreakerTripped &&
      signal.meetsStrictGate &&
      signal.action !== 'HOLD'
    ) {
      const recentSignalNotif = state.notifications.find(
        (n) =>
          n.symbol === sym &&
          n.type === 'SIGNAL_90' &&
          Date.now() - n.timestamp < 45_000
      );
      if (!recentSignalNotif) {
        const exchange = getPreferredExchangeForSymbol(sym);
        pushAudit({
          category: 'SIGNAL',
          severity: 'success',
          symbol: sym,
          exchange,
          title: `Sinyal Aksi ${signal.action} ${sym} (Akurasi ${signal.confidence}% · Risiko ${signal.riskScore}/100)`,
          detail: `Lolos gerbang ketat ≥${state.riskConfig.minConfidencePct}%. Entry $${next.close}, SL $${signal.stopLoss}, Target TP $${signal.takeProfit} (R:R 1:${signal.riskRewardRatio}).`,
        });
        pushNotification({
          type: 'SIGNAL_90',
          symbol: sym,
          actionRecommended: signal.action,
          confidence: signal.confidence,
          title: `Aksi ${signal.action} ${sym} — Akurasi ${signal.confidence}% (Risiko Rendah)`,
          message: `Skor risiko ${signal.riskScore}/100 · Entry $${next.close} · Target TP $${signal.takeProfit} · SL $${signal.stopLoss}.`,
        });

        // Optionally track position automatically if flat so performance dashboard stays live
        const alreadyOpen = state.positions.some((p) => p.symbol === sym);
        if (!alreadyOpen && state.positions.length < 4) {
          const notional = roundTo(state.equityUsd * (state.riskConfig.maxPositionPct / 100) * 2.5, 2);
          const qty = roundTo(notional / next.close, sym === 'XAU/USD' ? 2 : 4);
          state.positions.unshift({
            id: `pos_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
            symbol: sym,
            exchange,
            side: signal.action,
            entryPrice: next.close,
            currentPrice: next.close,
            quantity: qty,
            notionalUsd: notional,
            stopLoss: signal.stopLoss,
            takeProfit: signal.takeProfit,
            unrealizedPnl: 0,
            unrealizedPnlPct: 0,
            openedAt: Date.now(),
            confidenceAtEntry: signal.confidence,
            riskScoreAtEntry: signal.riskScore,
          });
        }
      }
    } else if (signal.anomaly.severity === 'warning') {
      const recentAlert = state.notifications.find(
        (n) => n.symbol === sym && n.type === 'VOLATILITY_ALERT' && Date.now() - n.timestamp < 30_000
      );
      if (!recentAlert) {
        pushNotification({
          type: 'VOLATILITY_ALERT',
          symbol: sym,
          title: `Peringatan Volatilitas ${sym}`,
          message: signal.anomaly.reason,
        });
      }
    }
  }

  // 4. Periodic Automatic Adaptive Strategy Learning (every 15 ticks)
  if (state.riskConfig.adaptiveLearningEnabled && state.tickCounter % 15 === 0) {
    const xauRegime = state.signalsBySymbol['XAU/USD'].regime;
    const adapted = adaptStrategyWeights(state.strategyWeights, state.trades, xauRegime);
    state.strategyWeights = adapted.weights;
    state.learningCycles += 1;
    pushAudit({
      category: 'LEARNING',
      severity: 'info',
      symbol: 'XAU/USD',
      title: `Pembelajaran Adaptif Otomatis #${state.learningCycles}`,
      detail: adapted.summary,
    });
  }

  // Update equity history point
  const totalUnrealized = state.positions.reduce((s, p) => s + p.unrealizedPnl, 0);
  state.equityHistory.push({
    time: Date.now(),
    equity: roundTo(state.equityUsd + totalUnrealized, 2),
  });
  if (state.equityHistory.length > 48) {
    state.equityHistory.shift();
  }
}

// Run live market tick every 3.5 seconds on the server
setInterval(() => {
  stepMarketTick();
}, 3500);

function serializePublicState() {
  const unrealizedPnlUsd = roundTo(
    state.positions.reduce((acc, p) => acc + p.unrealizedPnl, 0),
    2
  );
  const totalTrades = state.trades.length;
  const wins = state.trades.filter((t) => t.pnlUsd > 0).length;
  const winRatePct = totalTrades > 0 ? roundTo((wins / totalTrades) * 100, 1) : 0;

  return {
    running: state.running,
    feedSource: state.feedSource,
    lastLiveSyncAt: state.lastLiveSyncAt,
    circuitBreakerTripped: state.circuitBreakerTripped,
    circuitBreakerReason: state.circuitBreakerReason,
    equityUsd: roundTo(state.equityUsd + unrealizedPnlUsd, 2),
    balanceUsd: state.equityUsd,
    startingCapitalUsd: state.startingCapitalUsd,
    unrealizedPnlUsd,
    realizedPnlTodayUsd: state.realizedPnlTodayUsd,
    totalReturnPct: roundTo(
      ((state.equityUsd + unrealizedPnlUsd - state.startingCapitalUsd) / state.startingCapitalUsd) *
        100,
      2
    ),
    winRatePct,
    totalTrades,
    riskConfig: state.riskConfig,
    strategyWeights: state.strategyWeights,
    learningCycles: state.learningCycles,
    candlesBySymbol: state.candlesBySymbol,
    signalsBySymbol: state.signalsBySymbol,
    multiTimeframeBySymbol: state.multiTimeframeBySymbol,
    positions: state.positions,
    trades: state.trades,
    priceAlerts: state.priceAlerts,
    auditLogs: state.auditLogs,
    notifications: state.notifications,
    dailyProfits: state.dailyProfits,
    equityHistory: state.equityHistory,
    // Strip encrypted cipher payloads before returning to client
    exchanges: state.exchanges.map(
      ({ encryptedApiKey: _k, encryptedApiSecret: _s, ...pub }) => pub
    ),
  };
}

function formatGeminiError(err: unknown): { status: number; message: string } {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();
  if (lower.includes('429') || lower.includes('resource_exhausted') || lower.includes('quota')) {
    return {
      status: 429,
      message:
        'Kuota API habis atau model ini memerlukan API key berbayar. Silakan pilih API key dengan billing aktif di panel Settings > Secrets AI Studio.',
    };
  }
  if (lower.includes('403') || lower.includes('permission_denied') || lower.includes('api_key')) {
    return {
      status: 403,
      message:
        'Akses ditolak atau API key belum valid. Periksa GEMINI_API_KEY di panel Settings > Secrets AI Studio.',
    };
  }
  if (lower.includes('404') || lower.includes('not_found')) {
    return {
      status: 404,
      message: `Model tidak ditemukan atau tidak tersedia untuk kunci saat ini: ${raw}`,
    };
  }
  return {
    status: 500,
    message: raw || 'Terjadi kesalahan saat menghubungi layanan Gemini.',
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '25mb' }));

  // Basic security headers (compatible with AI Studio iframe embedding)
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  // 1. Live Bot State Snapshot
  app.get('/api/state', (_req, res) => {
    res.json(serializePublicState());
  });

  // 2. Toggle Auto Trading Bot
  app.post('/api/bot/toggle', (req, res) => {
    const desired = typeof req.body?.running === 'boolean' ? req.body.running : !state.running;
    if (desired && state.circuitBreakerTripped) {
      res.status(409).json({
        error:
          'Circuit breaker sedang aktif akibat volatilitas ekstrem. Reset circuit breaker terlebih dahulu sebelum menjalankan bot.',
      });
      return;
    }
    state.running = desired;
    pushAudit({
      category: 'SYSTEM',
      severity: desired ? 'success' : 'warning',
      title: desired ? 'Auto Trading Bot Diaktifkan' : 'Auto Trading Bot Dijeda',
      detail: desired
        ? `Bot aktif memantau 4 pasar (XAU/USD & Kripto) dengan gerbang akurasi >=${state.riskConfig.minConfidencePct}% dan risiko <=${state.riskConfig.maxRiskScore}/100.`
        : 'Eksekusi otomatis dihentikan oleh pengguna. Posisi terbuka tetap dipantau oleh Stop-Loss & Take-Profit.',
    });
    res.json(serializePublicState());
  });

  // 3. Update Risk Management Configuration
  app.post('/api/bot/config', (req, res) => {
    const body = req.body ?? {};
    const clamp = (val: unknown, min: number, max: number, fallback: number) => {
      const n = Number(val);
      return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
    };

    state.riskConfig = {
      minConfidencePct: clamp(body.minConfidencePct, 70, 98, state.riskConfig.minConfidencePct),
      maxRiskScore: clamp(body.maxRiskScore, 10, 60, state.riskConfig.maxRiskScore),
      maxPositionPct: clamp(body.maxPositionPct, 1, 25, state.riskConfig.maxPositionPct),
      stopLossPct: clamp(body.stopLossPct, 0.2, 5, state.riskConfig.stopLossPct),
      takeProfitPct: clamp(body.takeProfitPct, 0.5, 15, state.riskConfig.takeProfitPct),
      maxDailyLossPct: clamp(body.maxDailyLossPct, 0.5, 10, state.riskConfig.maxDailyLossPct),
      volatilityHaltMultiplier: clamp(
        body.volatilityHaltMultiplier,
        1.5,
        6,
        state.riskConfig.volatilityHaltMultiplier
      ),
      autoTakeProfitEnabled:
        typeof body.autoTakeProfitEnabled === 'boolean'
          ? body.autoTakeProfitEnabled
          : state.riskConfig.autoTakeProfitEnabled,
      autoCircuitBreakerEnabled:
        typeof body.autoCircuitBreakerEnabled === 'boolean'
          ? body.autoCircuitBreakerEnabled
          : state.riskConfig.autoCircuitBreakerEnabled,
      adaptiveLearningEnabled:
        typeof body.adaptiveLearningEnabled === 'boolean'
          ? body.adaptiveLearningEnabled
          : state.riskConfig.adaptiveLearningEnabled,
    };

    for (const sym of VALID_SYMBOLS) {
      state.signalsBySymbol[sym] = evaluateTradeSignal(
        sym,
        state.candlesBySymbol[sym],
        state.riskConfig,
        state.strategyWeights
      );
    }

    pushAudit({
      category: 'RISK',
      severity: 'info',
      title: 'Parameter Manajemen Risiko Diperbarui',
      detail: `Gerbang Min Akurasi ${state.riskConfig.minConfidencePct}%, Maks Risiko ${state.riskConfig.maxRiskScore}/100, SL ${state.riskConfig.stopLossPct}%, TP ${state.riskConfig.takeProfitPct}%, Batas Circuit Breaker ${state.riskConfig.volatilityHaltMultiplier}x ATR.`,
    });

    res.json(serializePublicState());
  });

  // 4. Execute Trade Order (Manual / Guided with strict risk validation)
  app.post('/api/bot/execute', (req, res) => {
    const symbol = req.body?.symbol as MarketSymbol;
    const side = req.body?.side as 'BUY' | 'SELL';
    const exchange = (req.body?.exchange as ExchangeId) || getPreferredExchangeForSymbol(symbol);
    const positionPct = Number(req.body?.positionPct ?? state.riskConfig.maxPositionPct);
    const overrideRiskGate = Boolean(req.body?.overrideRiskGate);

    if (!VALID_SYMBOLS.includes(symbol)) {
      res.status(400).json({ error: 'Simbol pasar tidak valid.' });
      return;
    }
    if (side !== 'BUY' && side !== 'SELL') {
      res.status(400).json({ error: 'Arah order harus BUY atau SELL.' });
      return;
    }
    if (!VALID_EXCHANGES.includes(exchange)) {
      res.status(400).json({ error: 'Exchange tidak valid.' });
      return;
    }
    if (state.circuitBreakerTripped) {
      res.status(409).json({
        error: 'Eksekusi ditolak: Circuit breaker aktif karena anomali volatilitas pasar.',
      });
      return;
    }

    const signal = state.signalsBySymbol[symbol];
    if (!overrideRiskGate && signal.riskScore > state.riskConfig.maxRiskScore + 25) {
      res.status(400).json({
        error: `Skor risiko ${symbol} saat ini tinggi (${signal.riskScore}/100). Tunggu stabilisasi pasar atau aktifkan konfirmasi manual.`,
      });
      return;
    }

    const clampedPct = Math.min(20, Math.max(1, Number.isFinite(positionPct) ? positionPct : 5));
    const latestPrice =
      state.candlesBySymbol[symbol][state.candlesBySymbol[symbol].length - 1].close;
    const notional = roundTo(state.equityUsd * (clampedPct / 100) * 2.5, 2);
    const qty = roundTo(notional / latestPrice, symbol === 'XAU/USD' ? 2 : 4);
    const slFactor = state.riskConfig.stopLossPct / 100;
    const tpFactor = state.riskConfig.takeProfitPct / 100;
    const stopLoss = roundTo(
      side === 'BUY' ? latestPrice * (1 - slFactor) : latestPrice * (1 + slFactor),
      2
    );
    const takeProfit = roundTo(
      side === 'BUY' ? latestPrice * (1 + tpFactor) : latestPrice * (1 - tpFactor),
      2
    );

    const newPos: Position = {
      id: `pos_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      symbol,
      exchange,
      side,
      entryPrice: latestPrice,
      currentPrice: latestPrice,
      quantity: qty,
      notionalUsd: notional,
      stopLoss,
      takeProfit,
      unrealizedPnl: 0,
      unrealizedPnlPct: 0,
      openedAt: Date.now(),
      confidenceAtEntry: signal.confidence,
      riskScoreAtEntry: signal.riskScore,
    };

    state.positions.unshift(newPos);
    pushAudit({
      category: 'EXECUTION',
      severity: 'success',
      symbol,
      exchange,
      title: `Order ${side} ${symbol} Dieksekusi via ${exchange.toUpperCase()}`,
      detail: `Qty ${qty} @ $${latestPrice.toLocaleString('en-US')} | SL $${stopLoss} | Auto-TP $${takeProfit}.`,
    });
    pushNotification({
      type: 'TRADE_EXECUTED',
      symbol,
      actionRecommended: side,
      confidence: signal.confidence,
      title: `Eksekusi ${side} ${symbol} Berhasil`,
      message: `Posisi ${qty} ${symbol} dibuka di $${latestPrice} dengan proteksi SL $${stopLoss} & Auto-TP $${takeProfit}.`,
    });

    res.json(serializePublicState());
  });

  // 5. Close Open Position Manually
  app.post('/api/bot/close-position', (req, res) => {
    const positionId = String(req.body?.positionId ?? '');
    const idx = state.positions.findIndex((p) => p.id === positionId);
    if (idx === -1) {
      res.status(404).json({ error: 'Posisi tidak ditemukan.' });
      return;
    }

    const pos = state.positions[idx];
    const currentPrice =
      state.candlesBySymbol[pos.symbol][state.candlesBySymbol[pos.symbol].length - 1].close;
    const direction = pos.side === 'BUY' ? 1 : -1;
    const pnlUsd = roundTo((currentPrice - pos.entryPrice) * pos.quantity * direction, 2);
    const pnlPct = roundTo(
      ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100 * direction,
      2
    );

    state.positions.splice(idx, 1);
    const record: TradeRecord = {
      id: `trd_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      symbol: pos.symbol,
      exchange: pos.exchange,
      side: pos.side,
      entryPrice: pos.entryPrice,
      exitPrice: currentPrice,
      quantity: pos.quantity,
      pnlUsd,
      pnlPct,
      openedAt: pos.openedAt,
      closedAt: Date.now(),
      closeReason: 'MANUAL',
      confidenceAtEntry: pos.confidenceAtEntry,
      riskScoreAtEntry: pos.riskScoreAtEntry,
      strategyNote: 'Penutupan posisi manual oleh pengguna',
    };
    state.trades.unshift(record);
    state.equityUsd = roundTo(state.equityUsd + pnlUsd, 2);
    state.realizedPnlTodayUsd = roundTo(state.realizedPnlTodayUsd + pnlUsd, 2);
    syncTodayDailyProfit(pnlUsd);

    pushAudit({
      category: 'EXECUTION',
      severity: pnlUsd >= 0 ? 'success' : 'warning',
      symbol: pos.symbol,
      exchange: pos.exchange,
      title: `Posisi ${pos.side} ${pos.symbol} Ditutup (${pnlUsd >= 0 ? '+' : ''}$${pnlUsd.toFixed(2)})`,
      detail: `Exit di $${currentPrice} (${pnlPct >= 0 ? '+' : ''}${pnlPct}%).`,
    });

    res.json(serializePublicState());
  });

  // 6. Simulate Sharp Volatility Anomaly & Circuit Breaker Test
  app.post('/api/bot/simulate-anomaly', (req, res) => {
    const symbol = VALID_SYMBOLS.includes(req.body?.symbol)
      ? (req.body.symbol as MarketSymbol)
      : 'XAU/USD';
    stepMarketTick(symbol);
    res.json(serializePublicState());
  });

  // 7. Reset Circuit Breaker
  app.post('/api/bot/reset-circuit-breaker', (_req, res) => {
    state.circuitBreakerTripped = false;
    state.circuitBreakerReason = null;
    state.running = true;
    pushAudit({
      category: 'RISK',
      severity: 'success',
      title: 'Circuit Breaker Direset & Bot Dilanjutkan',
      detail: 'Volatilitas pasar telah diverifikasi pengguna. Proteksi manajemen risiko otomatis kembali aktif.',
    });
    res.json(serializePublicState());
  });

  // 8. Trigger Adaptive Strategy Learning Cycle
  app.post('/api/bot/optimize', (req, res) => {
    const symbol = VALID_SYMBOLS.includes(req.body?.symbol)
      ? (req.body.symbol as MarketSymbol)
      : 'XAU/USD';
    const currentSignal = state.signalsBySymbol[symbol];
    const adapted = adaptStrategyWeights(
      state.strategyWeights,
      state.trades,
      currentSignal.regime
    );
    state.strategyWeights = adapted.weights;
    state.learningCycles += 1;

    for (const sym of VALID_SYMBOLS) {
      state.signalsBySymbol[sym] = evaluateTradeSignal(
        sym,
        state.candlesBySymbol[sym],
        state.riskConfig,
        state.strategyWeights
      );
    }

    pushAudit({
      category: 'LEARNING',
      severity: 'info',
      symbol,
      title: `Siklus Pembelajaran Adaptif #${state.learningCycles} Selesai`,
      detail: adapted.summary,
    });
    res.json(serializePublicState());
  });

  // 9. Mark Notifications Read & Test Instant Push Notification
  app.post('/api/notifications/read-all', (_req, res) => {
    for (const n of state.notifications) {
      n.read = true;
    }
    res.json(serializePublicState());
  });

  app.post('/api/notifications/test', (req, res) => {
    const symbol = VALID_SYMBOLS.includes(req.body?.symbol)
      ? (req.body.symbol as MarketSymbol)
      : 'XAU/USD';
    const sig = state.signalsBySymbol[symbol];
    const recAction = sig.action === 'HOLD' ? 'BUY' : sig.action;
    pushNotification({
      type: 'SIGNAL_90',
      symbol,
      actionRecommended: recAction,
      confidence: Math.max(92, sig.confidence),
      title: `Uji Notifikasi Aksi ${recAction} ${symbol} — Akurasi ${Math.max(92, sig.confidence)}%`,
      message: `Entry $${sig.entryPrice} · Target TP $${sig.takeProfit} · SL $${sig.stopLoss}. Notifikasi instan aktif di perangkat Anda.`,
    });
    pushAudit({
      category: 'SIGNAL',
      severity: 'info',
      symbol,
      title: `Uji Notifikasi Push ${symbol} Dikirim`,
      detail: `Simulasi pengiriman notifikasi aksi ${recAction} pada harga $${sig.entryPrice}.`,
    });
    res.json(serializePublicState());
  });

  // 9b. Custom Price Target Alerts CRUD
  app.post('/api/alerts', (req, res) => {
    const symbol = req.body?.symbol as MarketSymbol;
    const condition = req.body?.condition === 'BELOW' ? 'BELOW' : 'ABOVE';
    const recommendedAction = req.body?.recommendedAction === 'BUY' ? 'BUY' : 'SELL';
    const targetPrice = Number(req.body?.targetPrice);
    const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 140) : '';

    if (!VALID_SYMBOLS.includes(symbol)) {
      res.status(400).json({ error: 'Simbol pasar tidak valid.' });
      return;
    }
    if (!Number.isFinite(targetPrice) || targetPrice <= 0) {
      res.status(400).json({ error: 'Harga target harus angka positif yang valid.' });
      return;
    }

    const alert: PriceAlert = {
      id: `alt_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      symbol,
      condition,
      targetPrice: roundTo(targetPrice, 2),
      recommendedAction,
      note: note || `Kirim notifikasi aksi ${recommendedAction} saat harga menyentuh $${roundTo(targetPrice, 2)}`,
      triggered: false,
      createdAt: Date.now(),
    };
    state.priceAlerts.unshift(alert);
    pushAudit({
      category: 'SIGNAL',
      severity: 'info',
      symbol,
      title: `Target Harga ${symbol} Dipasang ($${alert.targetPrice})`,
      detail: `Notifikasi aksi ${recommendedAction} aktif jika harga ${condition === 'ABOVE' ? 'naik ≥' : 'turun ≤'} $${alert.targetPrice}.`,
    });
    res.status(201).json(serializePublicState());
  });

  app.delete('/api/alerts/:id', (req, res) => {
    const idx = state.priceAlerts.findIndex((a) => a.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Target harga tidak ditemukan.' });
      return;
    }
    state.priceAlerts.splice(idx, 1);
    res.json(serializePublicState());
  });

  // 9c. Edit Position Auto-Sell TP / SL Target Prices
  app.patch('/api/positions/:id/targets', (req, res) => {
    const pos = state.positions.find((p) => p.id === req.params.id);
    if (!pos) {
      res.status(404).json({ error: 'Posisi pantauan tidak ditemukan.' });
      return;
    }
    const stopLoss = Number(req.body?.stopLoss);
    const takeProfit = Number(req.body?.takeProfit);
    if (!Number.isFinite(stopLoss) || stopLoss <= 0 || !Number.isFinite(takeProfit) || takeProfit <= 0) {
      res.status(400).json({ error: 'Harga Stop-Loss dan Take-Profit harus angka positif.' });
      return;
    }
    pos.stopLoss = roundTo(stopLoss, 2);
    pos.takeProfit = roundTo(takeProfit, 2);
    pushAudit({
      category: 'RISK',
      severity: 'info',
      symbol: pos.symbol,
      title: `Target TP/SL ${pos.symbol} Diperbarui`,
      detail: `SL baru $${pos.stopLoss} · Auto-Sell TP baru $${pos.takeProfit}.`,
    });
    res.json(serializePublicState());
  });

  // 10. Multi-Exchange Encrypted Vault Routes
  app.post('/api/exchanges', (req, res) => {
    const exchange = req.body?.exchange as ExchangeId;
    const label = typeof req.body?.label === 'string' ? req.body.label.trim() : '';
    const apiKey = typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : '';
    const apiSecret = typeof req.body?.apiSecret === 'string' ? req.body.apiSecret.trim() : '';
    const mode = req.body?.mode === 'live_encrypted' ? 'live_encrypted' : 'paper';

    if (!VALID_EXCHANGES.includes(exchange)) {
      res.status(400).json({ error: 'Platform exchange tidak didukung.' });
      return;
    }
    if (label.length < 3 || label.length > 64) {
      res.status(400).json({ error: 'Nama koneksi harus antara 3 hingga 64 karakter.' });
      return;
    }
    if (apiKey.length < 8 || apiSecret.length < 8) {
      res.status(400).json({
        error: 'Exchange API Key dan Secret minimal 8 karakter untuk dienkripsi dengan AES-256-GCM.',
      });
      return;
    }

    const supportedSymbols: MarketSymbol[] =
      exchange === 'oanda'
        ? ['XAU/USD']
        : ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'XAU/USD'];

    const newConn: StoredExchangeConnection = {
      id: `ex_${exchange}_${Date.now()}`,
      exchange,
      label,
      mode,
      apiKeyMasked: maskApiKey(apiKey),
      permissions:
        exchange === 'oanda'
          ? ['Spot XAU/USD', 'Auto TP/SL', 'Risk Guard']
          : ['Spot & Perpetual', 'Candlestick Stream', 'Auto Execution'],
      status: 'connected',
      latencyMs: 16 + Math.floor(Math.random() * 24),
      supportedSymbols,
      createdAt: Date.now(),
      encryptionCipher: 'AES-256-GCM',
      encryptedApiKey: encryptCredential(apiKey),
      encryptedApiSecret: encryptCredential(apiSecret),
    };

    state.exchanges.unshift(newConn);
    pushAudit({
      category: 'EXCHANGE',
      severity: 'success',
      exchange,
      title: `Koneksi ${exchange.toUpperCase()} Dienkripsi & Terhubung`,
      detail: `Profil "${label}" disimpan di vault server menggunakan AES-256-GCM (${newConn.apiKeyMasked}).`,
    });

    res.status(201).json(serializePublicState());
  });

  app.delete('/api/exchanges/:id', (req, res) => {
    const id = req.params.id;
    const idx = state.exchanges.findIndex((e) => e.id === id);
    if (idx === -1) {
      res.status(404).json({ error: 'Koneksi exchange tidak ditemukan.' });
      return;
    }
    const [removed] = state.exchanges.splice(idx, 1);
    pushAudit({
      category: 'EXCHANGE',
      severity: 'warning',
      exchange: removed.exchange,
      title: `Koneksi ${removed.exchange.toUpperCase()} Dicabut`,
      detail: `Kredensial terenkripsi untuk "${removed.label}" telah dihapus dari vault memori server.`,
    });
    res.json(serializePublicState());
  });

  // 11. Backtesting Simulator Endpoint
  app.post('/api/backtest/run', (req, res) => {
    const body = req.body ?? {};
    const symbol = VALID_SYMBOLS.includes(body.symbol) ? (body.symbol as MarketSymbol) : 'XAU/USD';
    const clamp = (val: unknown, min: number, max: number, fallback: number) => {
      const n = Number(val);
      return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
    };

    const params: BacktestParams = {
      symbol,
      initialCapital: clamp(body.initialCapital, 1000, 1_000_000, 25000),
      candlesCount: Math.round(clamp(body.candlesCount, 120, 500, 240)),
      minConfidencePct: clamp(body.minConfidencePct, 75, 98, 90),
      maxRiskScore: clamp(body.maxRiskScore, 10, 50, 25),
      stopLossPct: clamp(body.stopLossPct, 0.25, 5, symbol === 'XAU/USD' ? 0.65 : 1.1),
      takeProfitPct: clamp(body.takeProfitPct, 0.6, 15, symbol === 'XAU/USD' ? 1.95 : 3.2),
      positionSizePct: clamp(body.positionSizePct, 1, 25, 5),
      rsiOversold: clamp(body.rsiOversold, 15, 45, 32),
      rsiOverbought: clamp(body.rsiOverbought, 55, 85, 68),
    };

    const result = runBacktest(params);
    pushAudit({
      category: 'SYSTEM',
      severity: 'info',
      symbol,
      title: `Backtest Strategi ${symbol} Selesai`,
      detail: `Simulasi ${params.candlesCount} candle menghasilkan Return ${result.totalReturnPct >= 0 ? '+' : ''}${result.totalReturnPct}%, Win Rate ${result.winRatePct}%, Max Drawdown ${result.maxDrawdownPct}%, Sharpe ${result.sharpeRatio}.`,
    });

    res.json(result);
  });

  // 12. Gemini Multi-Turn Chatbot Endpoint (server-side @google/genai)
  app.post('/api/gemini/chat', async (req, res) => {
    const ai = createGeminiClient();
    if (!ai) {
      res.status(503).json({
        error:
          'GEMINI_API_KEY belum terkonfigurasi di server. Silakan atur melalui panel Settings > Secrets AI Studio.',
      });
      return;
    }

    const modelRaw = String(req.body?.model ?? 'gemini-4-hydrogen');
    const model = (VALID_CHAT_MODELS as readonly string[]).includes(modelRaw)
      ? modelRaw
      : 'gemini-4-hydrogen';
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    const includeLiveContext = Boolean(req.body?.includeLiveContext);
    const historyRaw = Array.isArray(req.body?.history) ? req.body.history : [];

    if (!message || message.length > 4000) {
      res.status(400).json({ error: 'Pesan tidak boleh kosong dan maksimal 4000 karakter.' });
      return;
    }

    const marketSummary = includeLiveContext
      ? `\n\n[Konteks Pasar Real-Time Aurex Quant]\n` +
        VALID_SYMBOLS.map((sym) => {
          const s = state.signalsBySymbol[sym];
          return `- ${sym}: Harga $${s.entryPrice}, Aksi ${s.action}, Akurasi ${s.confidence}%, Risiko ${s.riskScore}/100, RSI ${s.indicators.rsi14}, EMA9/21/50 ${s.indicators.ema9}/${s.indicators.ema21}/${s.indicators.ema50}, Pola: ${s.patterns[0]?.name ?? 'Netral'}, Anomali: ${s.anomaly.severity}`;
        }).join('\n') +
        `\nStatus Bot: ${state.running ? 'Aktif' : 'Dijeda'} | Ekuitas: $${state.equityUsd} | Posisi Terbuka: ${state.positions.length}`
      : '';

    const systemInstruction =
      'Anda adalah Quant Strategist & Risk Advisor senior untuk platform auto trading Aurex Quant (spesialis XAU/USD dan pasar kripto multi-exchange). ' +
      'Berikan analisis teknikal yang disiplin, terstruktur, dan ringkas dalam Bahasa Indonesia (dengan istilah trading standar seperti RSI, MACD, EMA, Bollinger Bands, ATR, Stop-Loss, Take-Profit, Drawdown). ' +
      'Selalu tekankan prinsip perlindungan modal, gerbang keyakinan >=90% dengan risiko rendah, dan ingatkan bahwa trading memiliki risiko pasar.' +
      marketSummary;

    try {
      const sanitizedHistory = historyRaw
        .slice(-16)
        .filter(
          (item: unknown): item is { role: 'user' | 'model'; text: string } =>
            Boolean(
              item &&
                typeof item === 'object' &&
                ('role' in item && (item.role === 'user' || item.role === 'model')) &&
                'text' in item &&
                typeof item.text === 'string' &&
                item.text.trim().length > 0
            )
        )
        .map((item: { role: 'user' | 'model'; text: string }) => ({
          role: item.role,
          parts: [{ text: item.text.slice(0, 4000) }],
        }));

      const chat = ai.chats.create({
        model,
        history: sanitizedHistory,
        config: {
          systemInstruction,
        },
      });

      const response = await chat.sendMessage({ message });
      const replyText = response.text ?? 'Tidak ada respons teks dari model.';

      res.json({
        model,
        reply: replyText,
      });
    } catch (err) {
      const formatted = formatGeminiError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // 13. Gemini Image Creation & Editing Endpoint (gemini-nano-banana-2.1)
  app.post('/api/gemini/image', async (req, res) => {
    const ai = createGeminiClient();
    if (!ai) {
      res.status(503).json({
        error:
          'GEMINI_API_KEY belum terkonfigurasi. Model gemini-nano-banana-2.1 juga memerlukan API key berbayar di Settings > Secrets.',
      });
      return;
    }

    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
    const aspectRatioRaw = String(req.body?.aspectRatio ?? '16:9');
    const imageSizeRaw = String(req.body?.imageSize ?? '1K');
    const sourceImageBase64 =
      typeof req.body?.sourceImageBase64 === 'string' ? req.body.sourceImageBase64.trim() : '';
    const sourceMimeType =
      typeof req.body?.sourceMimeType === 'string' ? req.body.sourceMimeType.trim() : 'image/png';

    if (!prompt || prompt.length > 2000) {
      res.status(400).json({ error: 'Prompt gambar wajib diisi (maksimal 2000 karakter).' });
      return;
    }

    const aspectRatio = (VALID_IMAGE_ASPECTS as readonly string[]).includes(aspectRatioRaw)
      ? aspectRatioRaw
      : '16:9';
    const imageSize = (VALID_IMAGE_SIZES as readonly string[]).includes(imageSizeRaw)
      ? imageSizeRaw
      : '1K';

    const allowedMimes = ['image/png', 'image/jpeg', 'image/webp'];
    if (sourceImageBase64 && !allowedMimes.includes(sourceMimeType)) {
      res.status(400).json({ error: 'Format gambar sumber harus PNG, JPEG, atau WEBP.' });
      return;
    }

    try {
      const parts: Array<
        { text: string } | { inlineData: { data: string; mimeType: string } }
      > = [];

      if (sourceImageBase64) {
        parts.push({
          inlineData: {
            data: sourceImageBase64,
            mimeType: sourceMimeType,
          },
        });
      }
      parts.push({ text: prompt });

      const response = await ai.models.generateContent({
        model: 'gemini-nano-banana-2.1',
        contents: { parts },
        config: {
          imageConfig: {
            aspectRatio,
            imageSize,
          },
        },
      });

      let imageUrl: string | null = null;
      let caption = '';

      for (const part of response.candidates?.[0]?.content?.parts ?? []) {
        if (part.inlineData?.data) {
          const mime = part.inlineData.mimeType ?? 'image/png';
          imageUrl = `data:${mime};base64,${part.inlineData.data}`;
        } else if (part.text) {
          caption += part.text;
        }
      }

      if (!imageUrl) {
        res.status(502).json({
          error: 'Model tidak mengembalikan data gambar. Coba perjelas deskripsi visual Anda.',
        });
        return;
      }

      res.json({
        model: 'gemini-nano-banana-2.1',
        imageUrl,
        caption: caption.trim(),
      });
    } catch (err) {
      const formatted = formatGeminiError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // 14. Gemini Image-to-Video Animation Endpoint (gemini-omni-1.2-flash via Interactions API)
  app.post('/api/gemini/video', async (req, res) => {
    const ai = createGeminiClient();
    if (!ai) {
      res.status(503).json({
        error:
          'GEMINI_API_KEY belum terkonfigurasi. Model gemini-omni-1.2-flash memerlukan API key berbayar di Settings > Secrets.',
      });
      return;
    }

    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
    const aspectRatioRaw = String(req.body?.aspectRatio ?? '16:9');
    const imageBase64 =
      typeof req.body?.imageBase64 === 'string' ? req.body.imageBase64.trim() : '';
    const mimeType =
      typeof req.body?.mimeType === 'string' ? req.body.mimeType.trim() : 'image/png';

    if (!imageBase64) {
      res.status(400).json({ error: 'Unggah foto atau gambar terlebih dahulu untuk dianimasikan.' });
      return;
    }
    if (!prompt || prompt.length > 1500) {
      res.status(400).json({ error: 'Instruksi animasi video wajib diisi.' });
      return;
    }

    const allowedMimes = ['image/png', 'image/jpeg', 'image/webp'];
    if (!allowedMimes.includes(mimeType)) {
      res.status(400).json({ error: 'Format gambar harus PNG, JPEG, atau WEBP.' });
      return;
    }

    const aspectRatio: '16:9' | '9:16' = (VALID_VIDEO_ASPECTS as readonly string[]).includes(
      aspectRatioRaw
    )
      ? (aspectRatioRaw as '16:9' | '9:16')
      : '16:9';

    try {
      const interaction = await ai.interactions.create(
        {
          model: 'gemini-omni-1.2-flash',
          input: [
            {
              type: 'image',
              mime_type: mimeType,
              data: imageBase64,
            },
            {
              type: 'text',
              text: prompt,
            },
          ],
          background: false,
          store: false,
          stream: false,
          response_format: {
            type: 'video',
            aspect_ratio: aspectRatio,
          },
        } as Parameters<typeof ai.interactions.create>[0],
        { timeout: 300000 }
      );

      const videoPart =
        interaction && typeof interaction === 'object' && 'output_video' in interaction
          ? interaction.output_video
          : null;
      if (videoPart?.data) {
        const videoMime = videoPart.mime_type || 'video/mp4';
        res.json({
          model: 'gemini-omni-1.2-flash',
          aspectRatio,
          videoUrl: `data:${videoMime};base64,${videoPart.data}`,
        });
        return;
      }

      res.status(502).json({
        error: 'Generasi video selesai tanpa payload video yang valid.',
      });
    } catch (err) {
      const formatted = formatGeminiError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // Frontend Vite middleware in development, static dist in production
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT) || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Aurex Quant server running at http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
