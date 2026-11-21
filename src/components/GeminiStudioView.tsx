import { useRef, useState } from 'react';
import {
  Download,
  Film,
  Image as ImageIcon,
  MessageSquare,
  Send,
  Trash2,
  Upload,
} from 'lucide-react';
import type { MarketSymbol } from '../engine/types';
import type { AppStateSnapshot } from '../types/app';

interface GeminiStudioViewProps {
  state: AppStateSnapshot;
  selectedSymbol: MarketSymbol;
}

type StudioTab = 'chat' | 'image' | 'video';

interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  modelUsed?: string;
  timestamp: number;
}

const CHAT_MODELS = [
  {
    id: 'gemini-4-hydrogen',
    label: 'Gemini 4 Hydrogen — Tugas Umum & Strategi',
  },
  {
    id: 'gemini-3.1-flash-lite',
    label: 'Gemini 3.1 Flash Lite — Respons Cepat',
  },
  {
    id: 'gemini-4-neon',
    label: 'Gemini 4 Neon — Tugas Interaktif Kompleks',
  },
  {
    id: 'gemini-4-carbon',
    label: 'Gemini 4 Carbon — Penalaran Kuantitatif Mendalam',
  },
] as const;

async function fileToBase64(file: File): Promise<{ base64: string; mimeType: string; dataUrl: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? '');
      const commaIdx = dataUrl.indexOf(',');
      if (commaIdx === -1) {
        reject(new Error('Gagal membaca berkas gambar.'));
        return;
      }
      resolve({
        base64: dataUrl.slice(commaIdx + 1),
        mimeType: file.type || 'image/png',
        dataUrl,
      });
    };
    reader.onerror = () => reject(new Error('Gagal membaca berkas gambar.'));
    reader.readAsDataURL(file);
  });
}

export function GeminiStudioView({ state, selectedSymbol }: GeminiStudioViewProps) {
  const [tab, setTab] = useState<StudioTab>('chat');

  // --- 1. Multi-Turn Gemini Chatbot State ---
  const [chatModel, setChatModel] = useState<string>('gemini-4-hydrogen');
  const [includeLiveContext, setIncludeLiveContext] = useState(true);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'model',
      modelUsed: 'gemini-4-hydrogen',
      timestamp: Date.now(),
      text: 'Halo! Saya Asisten Kuantitatif Aurex Quant. Tanyakan analisis teknikal XAU/USD atau Kripto, evaluasi manajemen risiko 90%, interpretasi pola candlestick, atau optimasi parameter backtesting Anda.',
    },
  ]);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // --- 2. Create & Edit Image State (gemini-nano-banana-2.1) ---
  const [imgPrompt, setImgPrompt] = useState('');
  const [imgAspect, setImgAspect] = useState('16:9');
  const [imgSize, setImgSize] = useState('1K');
  const [imgSource, setImgSource] = useState<{
    base64: string;
    mimeType: string;
    dataUrl: string;
    name: string;
  } | null>(null);
  const [imgResult, setImgResult] = useState<{ imageUrl: string; caption: string } | null>(null);
  const [imgLoading, setImgLoading] = useState(false);
  const [imgError, setImgError] = useState<string | null>(null);

  // --- 3. Animate Image to Video State (gemini-omni-1.2-flash via Interactions API) ---
  const [vidPrompt, setVidPrompt] = useState(
    'Animasikan grafik pasar emas dan kripto ini dengan gerakan kamera sinematik halus, cahaya refleksi lembut pada garis tren.'
  );
  const [vidAspect, setVidAspect] = useState<'16:9' | '9:16'>('16:9');
  const [vidSource, setVidSource] = useState<{
    base64: string;
    mimeType: string;
    dataUrl: string;
    name: string;
  } | null>(null);
  const [vidResultUrl, setVidResultUrl] = useState<string | null>(null);
  const [vidLoading, setVidLoading] = useState(false);
  const [vidError, setVidError] = useState<string | null>(null);

  const sendChatMessage = async (overrideText?: string) => {
    const text = (overrideText ?? chatInput).trim();
    if (!text || chatLoading) return;

    const userMsg: ChatMessage = {
      id: `u_${Date.now()}`,
      role: 'user',
      text,
      timestamp: Date.now(),
    };
    const nextHistory = [...messages, userMsg];
    setMessages(nextHistory);
    setChatInput('');
    setChatError(null);
    setChatLoading(true);

    try {
      const res = await fetch('/api/gemini/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: chatModel,
          message: text,
          includeLiveContext,
          history: messages.map((m) => ({ role: m.role, text: m.text })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Gagal mendapatkan respons dari Gemini.');
      }

      setMessages((prev) => [
        ...prev,
        {
          id: `m_${Date.now()}`,
          role: 'model',
          modelUsed: data.model,
          text: data.reply,
          timestamp: Date.now(),
        },
      ]);
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 60);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'Gagal menghubungi layanan Gemini.');
    } finally {
      setChatLoading(false);
    }
  };

  const handleImageGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!imgPrompt.trim()) {
      setImgError('Masukkan deskripsi visual atau instruksi pengeditan terlebih dahulu.');
      return;
    }
    setImgLoading(true);
    setImgError(null);
    try {
      const res = await fetch('/api/gemini/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: imgPrompt.trim(),
          aspectRatio: imgAspect,
          imageSize: imgSize,
          sourceImageBase64: imgSource?.base64 ?? '',
          sourceMimeType: imgSource?.mimeType ?? 'image/png',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Gagal membuat gambar.');
      }
      setImgResult({ imageUrl: data.imageUrl, caption: data.caption || '' });
    } catch (err) {
      setImgError(err instanceof Error ? err.message : 'Gagal memproses gambar.');
    } finally {
      setImgLoading(false);
    }
  };

  const handleVideoGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vidSource) {
      setVidError('Unggah foto atau gambar grafik terlebih dahulu untuk dianimasikan.');
      return;
    }
    if (!vidPrompt.trim()) {
      setVidError('Masukkan instruksi animasi gerakan video.');
      return;
    }

    setVidLoading(true);
    setVidError(null);
    setVidResultUrl(null);
    try {
      const res = await fetch('/api/gemini/video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: vidSource.base64,
          mimeType: vidSource.mimeType,
          prompt: vidPrompt.trim(),
          aspectRatio: vidAspect,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Gagal membuat animasi video.');
      }
      setVidResultUrl(data.videoUrl);
    } catch (err) {
      setVidError(err instanceof Error ? err.message : 'Gagal menganimasikan gambar menjadi video.');
    } finally {
      setVidLoading(false);
    }
  };

  const liveSig = state.signalsBySymbol[selectedSymbol];

  return (
    <div className="space-y-5">
      {/* Segmented Feature Tabs */}
      <div
        className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-[#11161D] border border-slate-200 dark:border-slate-800/90 w-fit"
        role="tablist"
        aria-label="Fitur Studio AI Gemini"
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'chat'}
          onClick={() => setTab('chat')}
          className={`flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
            tab === 'chat'
              ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          <MessageSquare className="w-3.5 h-3.5" aria-hidden="true" />
          Asisten Analis Gemini
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={tab === 'image'}
          onClick={() => setTab('image')}
          className={`flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
            tab === 'image'
              ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          <ImageIcon className="w-3.5 h-3.5" aria-hidden="true" />
          Kreator &amp; Editor Visual (Nano Banana 2.1)
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={tab === 'video'}
          onClick={() => setTab('video')}
          className={`flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
            tab === 'video'
              ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          <Film className="w-3.5 h-3.5" aria-hidden="true" />
          Animator Gambar ke Video (Omni Flash)
        </button>
      </div>

      {/* TAB 1: Multi-Turn Gemini Chatbot */}
      {tab === 'chat' && (
        <section className="bg-white dark:bg-[#11161D] border border-slate-200 dark:border-slate-800/90 rounded-lg overflow-hidden flex flex-col h-[620px]">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800/90 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <label htmlFor="gemini-chat-model" className="text-xs font-medium text-slate-600 dark:text-slate-300">
                Model Gemini:
              </label>
              <select
                id="gemini-chat-model"
                value={chatModel}
                onChange={(e) => setChatModel(e.target.value)}
                className="px-2.5 py-1.5 text-xs rounded-md bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100"
              >
                {CHAT_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-3 text-xs">
              <label className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeLiveContext}
                  onChange={(e) => setIncludeLiveContext(e.target.checked)}
                  className="accent-amber-500"
                />
                Sertakan Data Pasar Live
              </label>
              <button
                type="button"
                onClick={() => setMessages(messages.slice(0, 1))}
                className="text-slate-500 hover:text-rose-500 transition-colors"
              >
                Bersihkan Riwayat
              </button>
            </div>
          </div>

          {/* Scrollable Message Thread */}
          <div
            className="flex-1 overflow-y-auto p-4 space-y-4"
            aria-live="polite"
            data-testid="gemini-chat-thread"
          >
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mb-1">
                  {msg.role === 'user' ? 'Anda' : `Analis Aurex · ${msg.modelUsed ?? chatModel}`}
                </div>
                <div
                  className={`max-w-2xl rounded-lg px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'bg-amber-600 text-white'
                      : 'bg-slate-100 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-100'
                  }`}
                >
                  {msg.text}
                </div>
              </div>
            ))}
            {chatLoading && (
              <div className="text-xs font-mono text-slate-500 dark:text-slate-400">
                Menganalisis data pasar dengan {chatModel}...
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Quick Prompts + Composer */}
          <div className="p-3.5 border-t border-slate-200 dark:border-slate-800/90 space-y-2.5">
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() =>
                  void sendChatMessage(
                    `Evaluasi sinyal ${selectedSymbol} saat ini (harga $${liveSig?.entryPrice}, akurasi ${liveSig?.confidence}%, risiko ${liveSig?.riskScore}/100) dan apakah layak masuk dengan aturan risiko rendah?`
                  )
                }
                className="px-2.5 py-1 text-xs rounded-md bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-amber-500/60 transition-colors"
              >
                Audit Sinyal {selectedSymbol}
              </button>
              <button
                type="button"
                onClick={() =>
                  void sendChatMessage(
                    'Berikan rekomendasi parameter Stop-Loss, Take-Profit, dan batas ATR circuit breaker optimal untuk XAU/USD saat sesi London-New York.'
                  )
                }
                className="px-2.5 py-1 text-xs rounded-md bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-amber-500/60 transition-colors"
              >
                Strategi Risiko XAU/USD
              </button>
              <button
                type="button"
                onClick={() =>
                  void sendChatMessage(
                    'Bagaimana mengombinasikan pola candlestick Bullish Engulfing dengan RSI dan MACD untuk menghindari false breakout di BTC/USDT?'
                  )
                }
                className="px-2.5 py-1 text-xs rounded-md bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-amber-500/60 transition-colors"
              >
                Filter False Breakout Kripto
              </button>
            </div>

            {chatError && (
              <div
                role="alert"
                className="text-xs p-2.5 rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-300"
              >
                {chatError}
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void sendChatMessage();
              }}
              className="flex items-center gap-2"
            >
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Tanyakan analisis teknikal, manajemen risiko, atau strategi bot..."
                aria-label="Pesan untuk asisten Gemini"
                className="flex-1 px-3.5 py-2.5 text-sm rounded-md bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-amber-500"
              />
              <button
                type="submit"
                disabled={chatLoading || !chatInput.trim()}
                className="flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold rounded-md bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white transition-colors whitespace-nowrap"
              >
                <Send className="w-3.5 h-3.5" aria-hidden="true" />
                Kirim
              </button>
            </form>
          </div>
        </section>
      )}

      {/* TAB 2: Create & Edit Images (gemini-nano-banana-2.1) */}
      {tab === 'image' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <form
            onSubmit={handleImageGenerate}
            className="lg:col-span-5 bg-white dark:bg-[#11161D] border border-slate-200 dark:border-slate-800/90 rounded-lg p-5 space-y-4"
          >
            <div>
              <h2 className="font-display font-semibold text-sm text-slate-900 dark:text-slate-100">
                Buat &amp; Edit Visual Trading (gemini-nano-banana-2.1)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Buat infografis laporan pasar harian, ilustrasi strategi XAU/USD, atau unggah gambar untuk diedit dengan prompt teks.
              </p>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label htmlFor="img-prompt" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Prompt Visual / Instruksi Edit
                </label>
                <textarea
                  id="img-prompt"
                  rows={4}
                  value={imgPrompt}
                  onChange={(e) => setImgPrompt(e.target.value)}
                  placeholder="Contoh: Kartu laporan performa mingguan XAU/USD bertema emas editorial minimalis dengan grafik tren naik di latar gelap..."
                  className="w-full px-3 py-2 rounded-md bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="img-aspect" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Rasio Aspek
                  </label>
                  <select
                    id="img-aspect"
                    value={imgAspect}
                    onChange={(e) => setImgAspect(e.target.value)}
                    className="w-full px-3 py-2 rounded-md bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                  >
                    <option value="16:9">16:9 (Lanskap)</option>
                    <option value="1:1">1:1 (Persegi)</option>
                    <option value="4:3">4:3 (Presentasi)</option>
                    <option value="3:4">3:4 (Vertikal)</option>
                    <option value="9:16">9:16 (Story / Mobile)</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="img-size" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Resolusi
                  </label>
                  <select
                    id="img-size"
                    value={imgSize}
                    onChange={(e) => setImgSize(e.target.value)}
                    className="w-full px-3 py-2 rounded-md bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                  >
                    <option value="1K">1K (Standar)</option>
                    <option value="2K">2K (Tinggi)</option>
                    <option value="4K">4K (Ultra)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Gambar Sumber untuk Diedit (Opsional)
                </label>
                <div className="flex items-center gap-2">
                  <label className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-md border border-dashed border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-amber-500 cursor-pointer">
                    <Upload className="w-4 h-4" aria-hidden="true" />
                    <span className="truncate">{imgSource ? imgSource.name : 'Unggah PNG / JPG / WEBP'}</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="sr-only"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        try {
                          const parsed = await fileToBase64(file);
                          setImgSource({ ...parsed, name: file.name });
                          setImgError(null);
                        } catch (err) {
                          setImgError(err instanceof Error ? err.message : 'Gagal memuat file.');
                        }
                      }}
                    />
                  </label>
                  {imgSource && (
                    <button
                      type="button"
                      onClick={() => setImgSource(null)}
                      aria-label="Hapus gambar sumber"
                      className="p-2.5 rounded-md border border-slate-300 dark:border-slate-700 text-slate-500 hover:text-rose-500"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>

            {imgError && (
              <div
                role="alert"
                className="text-xs p-2.5 rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-300"
              >
                {imgError}
              </div>
            )}

            <button
              type="submit"
              disabled={imgLoading}
              className="w-full py-2.5 px-4 text-xs font-semibold rounded-md bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white transition-colors"
            >
              {imgLoading
                ? 'Menghasilkan Visual...'
                : imgSource
                  ? 'Edit Gambar dengan Gemini'
                  : 'Buat Gambar dengan Gemini'}
            </button>
          </form>

          <section className="lg:col-span-7 bg-white dark:bg-[#11161D] border border-slate-200 dark:border-slate-800/90 rounded-lg p-5 min-h-[380px] flex flex-col justify-between">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-display font-semibold text-sm text-slate-900 dark:text-slate-100">
                Pratinjau Hasil Visual
              </h3>
              {imgResult && (
                <a
                  href={imgResult.imageUrl}
                  download="aurex-visual-gemini.png"
                  className="flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400 hover:underline"
                >
                  <Download className="w-3.5 h-3.5" aria-hidden="true" />
                  Unduh Gambar
                </a>
              )}
            </div>

            {imgResult ? (
              <div className="space-y-3">
                <img
                  src={imgResult.imageUrl}
                  alt={imgPrompt || 'Visual yang dihasilkan Gemini'}
                  referrerPolicy="no-referrer"
                  className="w-full rounded-md border border-slate-200 dark:border-slate-800 object-contain max-h-[420px]"
                />
                {imgResult.caption && (
                  <p className="text-xs text-slate-600 dark:text-slate-300">{imgResult.caption}</p>
                )}
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center py-12 text-xs text-slate-500 dark:text-slate-400 space-y-2">
                <ImageIcon className="w-8 h-8 opacity-40" aria-hidden="true" />
                <p className="max-w-sm">
                  Hasil gambar dari <span className="font-mono">gemini-nano-banana-2.1</span> akan muncul di sini. Model ini memerlukan API key berbayar yang aktif di panel Settings &gt; Secrets.
                </p>
              </div>
            )}
          </section>
        </div>
      )}

      {/* TAB 3: Animate Images into Video (gemini-omni-1.2-flash via Interactions API) */}
      {tab === 'video' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <form
            onSubmit={handleVideoGenerate}
            className="lg:col-span-5 bg-white dark:bg-[#11161D] border border-slate-200 dark:border-slate-800/90 rounded-lg p-5 space-y-4"
          >
            <div>
              <h2 className="font-display font-semibold text-sm text-slate-900 dark:text-slate-100">
                Animasi Foto ke Video (gemini-omni-1.2-flash)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Unggah tangkapan layar grafik atau foto untuk dianimasikan menjadi video 16:9 atau 9:16 via Gemini Interactions API.
              </p>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Foto / Frame Awal (Wajib)
                </label>
                <label className="flex flex-col items-center justify-center gap-2 p-4 rounded-md border border-dashed border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-amber-500 cursor-pointer">
                  {vidSource ? (
                    <img
                      src={vidSource.dataUrl}
                      alt="Pratinjau foto untuk animasi video"
                      className="max-h-36 rounded object-contain"
                    />
                  ) : (
                    <>
                      <Upload className="w-5 h-5" aria-hidden="true" />
                      <span>Pilih Foto (PNG, JPG, WEBP)</span>
                    </>
                  )}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="sr-only"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      try {
                        const parsed = await fileToBase64(file);
                        setVidSource({ ...parsed, name: file.name });
                        setVidError(null);
                      } catch (err) {
                        setVidError(err instanceof Error ? err.message : 'Gagal membaca foto.');
                      }
                    }}
                  />
                </label>
              </div>

              <div>
                <label htmlFor="vid-prompt" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Instruksi Gerakan Animasi
                </label>
                <textarea
                  id="vid-prompt"
                  rows={3}
                  value={vidPrompt}
                  onChange={(e) => setVidPrompt(e.target.value)}
                  className="w-full px-3 py-2 rounded-md bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                />
              </div>

              <div>
                <span className="block font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Rasio Aspek Video
                </span>
                <div className="grid grid-cols-2 gap-2" role="group" aria-label="Pilih rasio aspek video">
                  <button
                    type="button"
                    onClick={() => setVidAspect('16:9')}
                    className={`py-2 px-3 rounded-md border text-xs font-medium transition-colors ${
                      vidAspect === '16:9'
                        ? 'bg-amber-600 text-white border-amber-600'
                        : 'border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    16:9 Lanskap
                  </button>
                  <button
                    type="button"
                    onClick={() => setVidAspect('9:16')}
                    className={`py-2 px-3 rounded-md border text-xs font-medium transition-colors ${
                      vidAspect === '9:16'
                        ? 'bg-amber-600 text-white border-amber-600'
                        : 'border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    9:16 Potret
                  </button>
                </div>
              </div>
            </div>

            {vidError && (
              <div
                role="alert"
                className="text-xs p-2.5 rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-300"
              >
                {vidError}
              </div>
            )}

            <button
              type="submit"
              disabled={vidLoading}
              className="w-full py-2.5 px-4 text-xs font-semibold rounded-md bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white transition-colors"
            >
              {vidLoading ? 'Memproses Animasi Video (Omni Flash)...' : 'Generate Video Animasi'}
            </button>
          </form>

          <section className="lg:col-span-7 bg-white dark:bg-[#11161D] border border-slate-200 dark:border-slate-800/90 rounded-lg p-5 min-h-[380px] flex flex-col justify-between">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-display font-semibold text-sm text-slate-900 dark:text-slate-100">
                Pemutar Hasil Video ({vidAspect})
              </h3>
              {vidResultUrl && (
                <a
                  href={vidResultUrl}
                  download={`aurex-video-${vidAspect.replace(':', 'x')}.mp4`}
                  className="flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400 hover:underline"
                >
                  <Download className="w-3.5 h-3.5" aria-hidden="true" />
                  Unduh MP4
                </a>
              )}
            </div>

            {vidResultUrl ? (
              <video
                src={vidResultUrl}
                controls
                playsInline
                className="w-full rounded-md border border-slate-200 dark:border-slate-800 max-h-[420px] bg-black"
              />
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center py-12 text-xs text-slate-500 dark:text-slate-400 space-y-2">
                <Film className="w-8 h-8 opacity-40" aria-hidden="true" />
                <p className="max-w-sm">
                  Video animasi dari <span className="font-mono">gemini-omni-1.2-flash</span> (Interactions API) akan tampil di sini dalam format {vidAspect}. Model ini memerlukan API key berbayar di Settings &gt; Secrets.
                </p>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
