"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useRef, useState, useCallback, useEffect } from "react";
import Link from "next/link";
import DictDrawer from "./DictDrawer";

interface Message {
  role: "user" | "assistant";
  spanish: string;
  korean?: string;
  correction?: string;
}

interface HighlightState {
  idx: number;
  start: number;
  len: number;
}

interface SummaryWord {
  word: string;
  pos: string;
  translation: string;
  example?: string;
}

interface SummaryExpression {
  expression: string;
  translation: string;
  usage: string;
}

interface SummaryData {
  words: SummaryWord[];
  expressions: SummaryExpression[];
}

interface ISpeechRecognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((ev: ISpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
}

interface ISpeechRecognitionEvent {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface ISpeechRecognitionCtor {
  new(): ISpeechRecognition;
}

const STT_LANG: Record<string, string> = {
  "es-MX": "es-MX",
  "es-CO": "es-CO",
  "es-ES": "es-ES",
  "es-AR": "es-AR",
};

const DIALECT_LABEL: Record<string, string> = {
  "es-MX": "🇲🇽 멕시코",
  "es-CO": "🇨🇴 콜롬비아",
  "es-ES": "🇪🇸 스페인",
  "es-AR": "🇦🇷 아르헨티나",
};

function SpeechText({
  text,
  highlight,
  onWordClick,
}: {
  text: string;
  highlight: { start: number; len: number } | null;
  onWordClick?: (word: string) => void;
}) {
  const tokens: { value: string; start: number }[] = [];
  const re = /\S+|\s+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) tokens.push({ value: m[0], start: m.index });

  return (
    <>
      {tokens.map((tok, i) => {
        const tokEnd = tok.start + tok.value.length;
        const isHighlighted =
          highlight !== null &&
          highlight.len > 0 &&
          tok.start < highlight.start + highlight.len &&
          tokEnd > highlight.start;
        const isWord = /\S/.test(tok.value);
        const hlCls = isHighlighted ? "bg-yellow-300 text-gray-900 rounded-sm px-0.5" : "";

        if (isWord && onWordClick) {
          return (
            <span
              key={i}
              onClick={() =>
                onWordClick(tok.value.replace(/^[¿¡]+|[.,!?¡¿;:"""()\[\]]+$/g, ""))
              }
              className={`cursor-pointer hover:text-yellow-200 transition-colors ${hlCls}`}
              title="사전에서 찾기"
            >
              {tok.value}
            </span>
          );
        }
        return <span key={i} className={hlCls}>{tok.value}</span>;
      })}
    </>
  );
}

export default function TalkClient() {
  const router = useRouter();
  const params = useSearchParams();
  const dialect = params.get("dialect") ?? "es-MX";
  const gender = params.get("gender") ?? "female";
  const level = params.get("level") ?? "beginner";

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [listening, setListening] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showKorean, setShowKorean] = useState(true);
  const [ttsLoading, setTtsLoading] = useState<number | null>(null);
  const [highlight, setHighlight] = useState<HighlightState | null>(null);
  const [sttSupported, setSttSupported] = useState(true);
  const [dictOpen, setDictOpen] = useState(false);
  const [dictSearch, setDictSearch] = useState<{ word: string; key: number }>({ word: "", key: 0 });
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summaryData, setSummaryData] = useState<SummaryData | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  const recognitionRef = useRef<ISpeechRecognition | null>(null);
  const transcriptRef = useRef("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const timerIdsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const pendingAudioRef = useRef<{ idx: number; url: string } | null>(null);
  const playingAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);

useEffect(() => {
    const w = window as Window & { SpeechRecognition?: ISpeechRecognitionCtor; webkitSpeechRecognition?: ISpeechRecognitionCtor };
    if (!w.SpeechRecognition && !w.webkitSpeechRecognition) setSttSupported(false);
  }, []);

  // Unlock AudioContext on every gesture
  useEffect(() => {
    const unlock = () => {
      if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
      if (audioCtxRef.current.state === "suspended") void audioCtxRef.current.resume();
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const clearTimers = useCallback(() => {
    timerIdsRef.current.forEach(clearTimeout);
    timerIdsRef.current = [];
  }, []);

  const handleWordClick = useCallback((word: string) => {
    setDictSearch((prev) => ({ word, key: prev.key + 1 }));
    setDictOpen(true);
  }, []);

  const handleStop = useCallback(async () => {
    if (messages.length === 0) return;
    setSummaryData(null);
    setSummaryOpen(true);
    setSummaryLoading(true);
    try {
      const res = await fetch("/api/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          history: messages.map((m) => ({ role: m.role, content: m.spanish })),
          dialect,
        }),
      });
      const data = (await res.json()) as SummaryData & { error?: string };
      if (!data.error) setSummaryData(data);
    } catch {
      // silently ignore — modal stays open with loading cleared
    } finally {
      setSummaryLoading(false);
    }
  }, [messages, dialect]);

  // ── TTS ────────────────────────────────────────────────────────────────────
  const playTTS = useCallback(
    async (text: string, idx: number) => {
      window.speechSynthesis.cancel();
      clearTimers();
      setHighlight(null);
      setTtsLoading(idx);

      // Stop any in-progress HTML Audio
      if (playingAudioRef.current) {
        playingAudioRef.current.pause();
        playingAudioRef.current = null;
      }

      // ── Try Google TTS ────────────────────────────────────────────────────
      try {
        // Create / resume AudioContext before the fetch (while closer to the gesture)
        if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
        const ctx = audioCtxRef.current;
        if (ctx.state === "suspended") await ctx.resume().catch(() => {});

        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, gender, dialect }),
        });

        if (res.ok) {
          const rawBuf = await res.arrayBuffer();

          // Store as data URL — blob: URLs are blocked in KakaoTalk WebView; data URLs work everywhere
          const dataUrl = arrayBufferToDataUrl(rawBuf);
          pendingAudioRef.current = { idx, url: dataUrl };
          // Pre-load into DOM <audio> element so play() is instant on tap
          if (audioElRef.current) { audioElRef.current.src = dataUrl; audioElRef.current.load(); }

          const cleanupAudio = () => {
            if (pendingAudioRef.current?.idx === idx) {
              pendingAudioRef.current = null;
              if (audioElRef.current) audioElRef.current.src = '';
            }
          };

          // ── Try AudioContext (best quality) ──────────────────────────────
          let played = false;
          try {
            if (ctx.state === "suspended") await ctx.resume();
            const audioBuf = await ctx.decodeAudioData(rawBuf.slice(0));
            const source = ctx.createBufferSource();
            source.buffer = audioBuf;
            source.connect(ctx.destination);

            const durationMs = audioBuf.duration * 1000;
            if (isFinite(durationMs) && durationMs > 0) {
              const wordRanges = buildWordRanges(text);
              wordRanges.forEach((w, i) => {
                const t = setTimeout(
                  () => setHighlight({ idx, start: w.start, len: w.len }),
                  (i / wordRanges.length) * durationMs
                );
                timerIdsRef.current.push(t);
              });
              timerIdsRef.current.push(setTimeout(() => setHighlight(null), durationMs + 100));
            }

            source.onended = () => { cleanupAudio(); clearTimers(); setHighlight(null); };
            setTtsLoading(null);
            source.start(0);
            played = true;
          } catch (ctxErr) {
            console.warn("[TTS] AudioContext failed:", ctxErr, "— HTML Audio fallback");
          }

          // ── Try HTML Audio (Chrome async fallback) ───────────────────────
          if (!played) {
            try {
              const audio = new Audio(dataUrl);
              playingAudioRef.current = audio;
              audio.onended = () => { playingAudioRef.current = null; cleanupAudio(); clearTimers(); setHighlight(null); };
              audio.onerror = () => { playingAudioRef.current = null; clearTimers(); setHighlight(null); };
              setTtsLoading(null);
              await audio.play();
              played = true;
            } catch (audioErr) {
              console.warn("[TTS] HTML Audio failed:", audioErr, "— tap-to-play ready");
              playingAudioRef.current = null;
            }
          }

          // Blob URL stays in pendingAudioRef for direct-tap play (KakaoTalk WebView)
          if (!played) setTtsLoading(null);
          return; // API succeeded — don't fall through to speechSynthesis
        } else {
          const body = await res.json().catch(() => ({})) as { detail?: string };
          console.warn("[TTS] API →", body.detail ?? res.status, "— browser TTS fallback");
        }
      } catch (err) {
        console.warn("[TTS] fetch/decode error:", err, "— browser TTS fallback");
      }

      // ── Browser TTS fallback ─────────────────────────────────────────────
      setTtsLoading(null);
      const utt = new SpeechSynthesisUtterance(text);
      utt.lang = STT_LANG[dialect] ?? "es-MX";
      utt.rate = 0.88;

      // Gender-aware voice selection
      const allVoices = window.speechSynthesis.getVoices();
      const esVoices = allVoices.filter((v) => v.lang.startsWith("es"));
      if (esVoices.length > 0) {
        const femalePattern = /helena|laura|paulina|monica|mónica|female|femenin|sabina/i;
        const malePattern = /pablo|raul|juan|diego|miguel|male|masculin/i;
        const picked =
          gender === "female"
            ? esVoices.find((v) => femalePattern.test(v.name)) ?? esVoices[0]
            : esVoices.find((v) => malePattern.test(v.name)) ?? esVoices[esVoices.length - 1];
        utt.voice = picked;
      }
      utt.pitch = gender === "female" ? 1.15 : 0.85;

      utt.onboundary = (ev: SpeechSynthesisEvent) => {
        if (ev.name === "word") {
          const len =
            (ev as SpeechSynthesisEvent & { charLength?: number }).charLength ??
            nextWordLength(text, ev.charIndex);
          setHighlight({ idx, start: ev.charIndex, len });
        }
      };
      utt.onend = () => setHighlight(null);
      utt.onerror = () => setHighlight(null);

      window.speechSynthesis.speak(utt);
    },
    [dialect, gender, clearTimers]
  );

  // Tap handler for the speaker button.
  // Pre-fetched audio is stored as a data URL and pre-loaded into a DOM <audio> element.
  // play() is called synchronously in the gesture handler — satisfies KakaoTalk WebView policy.
  const handleTTSButton = useCallback(
    (text: string, idx: number) => {
      if (pendingAudioRef.current?.idx === idx) {
        clearTimers();
        setHighlight(null);
        if (playingAudioRef.current) {
          playingAudioRef.current.pause();
          playingAudioRef.current = null;
        }
        const audioEl = audioElRef.current;
        if (audioEl) {
          // DOM element already pre-loaded — play() fires synchronously from gesture (KakaoTalk-safe)
          audioEl.currentTime = 0;
          audioEl.onended = () => { clearTimers(); setHighlight(null); pendingAudioRef.current = null; audioEl.src = ''; };
          void audioEl.play().catch(() => {});
        } else {
          const { url } = pendingAudioRef.current;
          const audio = new Audio(url);
          playingAudioRef.current = audio;
          audio.onended = () => { playingAudioRef.current = null; pendingAudioRef.current = null; clearTimers(); setHighlight(null); };
          void audio.play().catch(() => { playingAudioRef.current = null; });
        }
        return;
      }
      void playTTS(text, idx);
    },
    [clearTimers, playTTS]
  );

  // ── Chat ───────────────────────────────────────────────────────────────────
  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      setInput("");
      setLoading(true);

      setMessages((prev) => [...prev, { role: "user", spanish: text }]);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: text,
            dialect,
            gender,
            level,
            history: messages.map((m) => ({ role: m.role, content: m.spanish })),
          }),
        });
        const data = (await res.json()) as {
          spanish?: string;
          korean?: string;
          correction?: string;
          error?: string;
        };
        if (!res.ok || !data.spanish) {
          throw new Error(data.error ?? "API error");
        }
        const aiMsg: Message = {
          role: "assistant",
          spanish: data.spanish,
          korean: data.korean ?? "",
          correction: data.correction ?? "없음",
        };

        // messages.length + 1 = index after userMsg (at messages.length)
        const aiIdx = messages.length + 1;
        setMessages((prev) => [...prev, aiMsg]);
        void playTTS(aiMsg.spanish, aiIdx);
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            spanish: "Lo siento, hubo un error. Por favor, intenta de nuevo.",
            korean: "죄송합니다, 오류가 발생했습니다. 다시 시도해 주세요.",
          },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [dialect, gender, level, messages, playTTS]
  );

  // ── STT ────────────────────────────────────────────────────────────────────
  const startListening = useCallback(() => {
    const w = window as Window & { SpeechRecognition?: ISpeechRecognitionCtor; webkitSpeechRecognition?: ISpeechRecognitionCtor };
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!SR) return;

    const rec = new SR();
    rec.lang = STT_LANG[dialect] ?? "es-MX";
    rec.interimResults = true;
    rec.continuous = false;
    transcriptRef.current = "";

    rec.onresult = (e: ISpeechRecognitionEvent) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) transcriptRef.current += t;
        else interim = t;
      }
      setInput(transcriptRef.current + interim);
    };
    rec.onend = () => {
      setListening(false);
      if (transcriptRef.current.trim()) sendMessage(transcriptRef.current.trim());
    };
    rec.onerror = () => setListening(false);

    recognitionRef.current = rec;
    rec.start();
    setListening(true);
  }, [dialect, sendMessage]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setListening(false);
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-[100dvh] max-w-2xl mx-auto">
      <header className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 border-b border-gray-800 bg-gray-950">
        <Link href="/" className="text-gray-400 hover:text-white text-sm">
          ← 뒤로
        </Link>
        <span className="flex items-center gap-2 font-semibold">
          {DIALECT_LABEL[dialect]}{" "}
          <span className="text-base">{gender === "male" ? "👨" : "👩"}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full border ${
            level === "beginner"     ? "border-emerald-600 text-emerald-400" :
            level === "intermediate" ? "border-indigo-600 text-indigo-400" :
                                       "border-violet-600 text-violet-400"
          }`}>
            {{ beginner: "초급", intermediate: "중급", advanced: "고급" }[level] ?? "초급"}
          </span>
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setDictSearch({ word: "", key: 0 }); setDictOpen(true); }}
            className="text-sm px-3 py-1 rounded-full border border-gray-700 text-gray-400 hover:border-indigo-500 hover:text-indigo-300 transition-colors"
            title="사전 열기"
          >
            📖
          </button>
          <button
            onClick={() => setShowKorean((v) => !v)}
            className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
              showKorean ? "border-indigo-500 text-indigo-300" : "border-gray-700 text-gray-400"
            }`}
          >
            {showKorean ? "번역ON" : "번역OFF"}
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-2">
            <span className="text-4xl">💬</span>
            <p className="text-sm text-center">
              마이크 버튼을 누르거나 텍스트를 입력해서 대화를 시작하세요
            </p>
          </div>
        )}

        {messages.map((msg, idx) => (
          <div key={idx} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                msg.role === "user" ? "bg-indigo-600 text-white" : "bg-gray-800 text-gray-100"
              }`}
            >
              <div className="flex items-start gap-2">
                <p className="flex-1 leading-relaxed">
                  {msg.role === "assistant" ? (
                    <SpeechText
                      text={msg.spanish ?? ""}
                      highlight={
                        highlight?.idx === idx
                          ? { start: highlight.start, len: highlight.len }
                          : null
                      }
                      onWordClick={handleWordClick}
                    />
                  ) : (
                    msg.spanish
                  )}
                </p>
                {msg.role === "assistant" && (
                  <button
                    onClick={() => handleTTSButton(msg.spanish, idx)}
                    disabled={ttsLoading === idx}
                    className="text-gray-400 hover:text-white mt-0.5 flex-shrink-0 disabled:opacity-50 transition-colors"
                    title="다시 듣기"
                  >
                    {ttsLoading === idx ? "⏳" : "🔊"}
                  </button>
                )}
              </div>

              {msg.role === "assistant" && showKorean && msg.korean && (
                <p className="mt-2 text-sm text-gray-400 border-t border-gray-700 pt-2">
                  {msg.korean}
                </p>
              )}

            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-800 rounded-2xl px-4 py-3 text-gray-400 text-sm animate-pulse">
              답변 생성 중...
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <DictDrawer
        open={dictOpen}
        onClose={() => setDictOpen(false)}
        pendingWord={dictSearch.word}
        searchKey={dictSearch.key}
        dialect={dialect}
      />

      {summaryOpen && (
        <SummaryModal
          data={summaryData}
          loading={summaryLoading}
          onClose={() => setSummaryOpen(false)}
          onExit={() => {
            if (summaryData) {
              try {
                localStorage.setItem("livelingo_last_summary", JSON.stringify(summaryData));
                localStorage.setItem("livelingo_last_settings", JSON.stringify({ dialect, gender, level }));
              } catch {}
            }
            router.push("/");
          }}
          onNewChat={() => {
            setMessages([]);
            setInput("");
            setSummaryOpen(false);
            setSummaryData(null);
          }}
        />
      )}

      {/* Hidden audio element — pre-loaded with TTS data URL for KakaoTalk-compatible synchronous play */}
      <audio ref={audioElRef} preload="none" className="hidden" />

      <div className="sticky bottom-0 z-10 px-4 pt-3 pb-4 border-t border-gray-800 bg-gray-950">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage(input);
              }
            }}
            placeholder="스페인어로 입력하거나 마이크를 누르세요..."
            className="flex-1 bg-gray-800 rounded-xl px-4 py-3 text-sm outline-none focus:ring-1 focus:ring-indigo-500 placeholder-gray-500"
          />

          {sttSupported && (
            <button
              onClick={listening ? stopListening : startListening}
              disabled={loading}
              className={`w-12 h-12 rounded-full flex items-center justify-center text-xl transition-all ${
                listening ? "bg-red-500 animate-pulse" : "bg-indigo-600 hover:bg-indigo-500"
              } disabled:opacity-50`}
              title={listening ? "녹음 중지" : "음성 입력"}
            >
              {listening ? "⏹" : "🎤"}
            </button>
          )}

          <button
            onClick={() => sendMessage(input)}
            disabled={loading || !input.trim()}
            className="w-12 h-12 rounded-full bg-indigo-600 hover:bg-indigo-500 flex items-center justify-center text-xl disabled:opacity-50 transition-all"
            title="전송"
          >
            ➤
          </button>
        </div>
        {messages.length > 0 && (
          <button
            onClick={handleStop}
            className="w-full mt-3 py-2.5 rounded-xl border border-red-700 text-red-400 hover:bg-red-900/30 hover:border-red-500 hover:text-red-300 text-sm font-medium transition-colors"
          >
            대화 종료 및 학습 정리
          </button>
        )}
      </div>
    </div>
  );
}

// ── Summary Modal ─────────────────────────────────────────────────────────────

function SummaryModal({
  data,
  loading,
  onClose,
  onExit,
  onNewChat,
}: {
  data: SummaryData | null;
  loading: boolean;
  onClose: () => void;
  onExit: () => void;
  onNewChat: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 flex-shrink-0">
          <span className="font-bold text-base">📚 오늘의 학습 정리</span>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white w-7 h-7 flex items-center justify-center transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading && (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-gray-400 text-sm">대화를 분석하는 중...</p>
            </div>
          )}

          {!loading && !data && (
            <p className="text-center text-gray-500 text-sm py-16">분석 결과를 불러올 수 없습니다.</p>
          )}

          {!loading && data && (
            <div className="space-y-6">
              {/* Words */}
              <section>
                <h3 className="text-xs font-semibold text-indigo-400 uppercase tracking-widest mb-3">
                  📝 핵심 단어 {data.words?.length ?? 0}개
                </h3>
                <div className="space-y-1.5">
                  {data.words?.map((w, i) => (
                    <div key={i} className="flex items-start gap-3 bg-gray-800/60 rounded-xl px-3 py-2.5">
                      <span className="text-gray-600 text-xs w-4 flex-shrink-0 mt-0.5 text-right">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <span className="font-semibold text-white">{w.word}</span>
                          {w.pos && (
                            <span className="text-[10px] text-indigo-400 bg-indigo-950/60 px-1.5 py-0.5 rounded-full">
                              {w.pos}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-300 mt-0.5">{w.translation}</p>
                        {w.example && (
                          <p className="text-xs text-gray-500 mt-0.5 italic">{w.example}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* Expressions */}
              <section>
                <h3 className="text-xs font-semibold text-emerald-400 uppercase tracking-widest mb-3">
                  💬 핵심 표현 {data.expressions?.length ?? 0}개
                </h3>
                <div className="space-y-1.5">
                  {data.expressions?.map((e, i) => (
                    <div key={i} className="flex items-start gap-3 bg-gray-800/60 rounded-xl px-3 py-2.5">
                      <span className="text-gray-600 text-xs w-4 flex-shrink-0 mt-0.5 text-right">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-emerald-300">{e.expression}</p>
                        <p className="text-sm text-gray-300 mt-0.5">{e.translation}</p>
                        {e.usage && (
                          <p className="text-xs text-gray-500 mt-1 leading-relaxed">{e.usage}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-2 px-5 py-4 border-t border-gray-700 flex-shrink-0">
          <button
            onClick={onExit}
            className="flex-1 py-2.5 rounded-xl border border-red-700 text-red-400 text-sm hover:bg-red-900/30 hover:border-red-500 hover:text-red-300 transition-colors"
          >
            대화 종료
          </button>
          <button
            onClick={onNewChat}
            className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition-colors"
          >
            새 대화 시작
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function arrayBufferToDataUrl(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const CHUNK = 8192;
  const parts: string[] = [];
  for (let i = 0; i < bytes.byteLength; i += CHUNK) {
    parts.push(String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.byteLength))));
  }
  return `data:audio/mpeg;base64,${btoa(parts.join(''))}`;
}

function buildWordRanges(text: string): { start: number; len: number }[] {
  const ranges: { start: number; len: number }[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    ranges.push({ start: m.index, len: m[0].length });
  }
  return ranges;
}

function nextWordLength(text: string, charIndex: number): number {
  const end = text.indexOf(" ", charIndex);
  return (end === -1 ? text.length : end) - charIndex;
}
