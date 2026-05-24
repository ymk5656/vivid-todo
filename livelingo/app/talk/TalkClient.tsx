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
  showTranslation?: boolean;
}

interface HighlightState {
  idx: number;
  start: number;
  len: number;
}

interface SummaryWord {
  word: string;
  reading?: string;
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
  "ja-JP": "ja-JP",
  "ja-KS": "ja-JP",
  "en-US": "en-US",
  "en-GB": "en-GB",
  "zh-CN": "zh-CN",
  "zh-TW": "zh-TW",
};

const DIALECT_LABEL: Record<string, string> = {
  "es-MX": "🇲🇽 멕시코",
  "es-CO": "🇨🇴 콜롬비아",
  "es-ES": "🇪🇸 스페인",
  "es-AR": "🇦🇷 아르헨티나",
  "ja-JP": "🇯🇵 표준 일본어",
  "ja-KS": "🏯 간사이 방언",
  "en-US": "🇺🇸 미국 영어",
  "en-GB": "🇬🇧 영국 영어",
  "zh-CN": "🇨🇳 중국어 (간체)",
  "zh-TW": "🇹🇼 중국어 (번체)",
};

function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[a.length][b.length];
}

function calculateSimilarity(original: string, spoken: string): number {
  const cleanOriginal = original.toLowerCase().replace(/[^\w\s\u0400-\u04FF\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF]/g, "").trim();
  const cleanSpoken = spoken.toLowerCase().replace(/[^\w\s\u0400-\u04FF\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF]/g, "").trim();
  if (!cleanOriginal || !cleanSpoken) return 0;
  const dist = levenshtein(cleanOriginal, cleanSpoken);
  const maxLen = Math.max(cleanOriginal.length, cleanSpoken.length);
  return Math.max(0, Math.round((1 - dist / maxLen) * 100));
}

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
        // font-bold와 가로 패딩(px-1)을 제거하여 렌더링 시 글자가 좌우로 움직이는(밀리는) 현상을 방지
        const hlCls = isHighlighted ? "bg-yellow-400/90 text-gray-900 rounded-sm shadow-[0_0_8px_rgba(250,204,21,0.6)] transition-colors" : "";

        if (isWord && onWordClick) {
          return (
            <span
              key={i}
              onClick={() =>
                onWordClick(tok.value.replace(/^[¿¡「【『（]+|[.,!?¡¿;:"""()\[\]。、！？」】』）…・]+$/g, ""))
              }
              className={`cursor-pointer hover:text-indigo-300 hover:underline decoration-indigo-400 decoration-2 underline-offset-4 transition-colors ${hlCls}`}
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
  const [ttsLoading, setTtsLoading] = useState<number | null>(null);
  const [highlight, setHighlight] = useState<HighlightState | null>(null);
  const [sttSupported, setSttSupported] = useState(true);
  const [dictOpen, setDictOpen] = useState(false);
  const [dictSearch, setDictSearch] = useState<{ word: string; key: number }>({ word: "", key: 0 });
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summaryData, setSummaryData] = useState<SummaryData | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  // Shadowing state
  const [shadowOpen, setShadowOpen] = useState(false);
  const [shadowTarget, setShadowTarget] = useState("");
  const [shadowScore, setShadowScore] = useState<number | null>(null);
  const [shadowListening, setShadowListening] = useState(false);
  const shadowTranscriptRef = useRef("");

  const recognitionRef = useRef<ISpeechRecognition | null>(null);
  const transcriptRef = useRef("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const timerIdsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasGreetedRef = useRef(false);
  const sendProactiveRef = useRef<(trigger: "greet" | "followup") => void>(() => {});
  const loadingRef = useRef(false);
  const playTTSRef = useRef<(text: string, idx: number) => void>(() => {});
  const summaryOpenRef = useRef(false);
  const dictOpenRef = useRef(false);
  const messagesLenRef = useRef(0);
  const prevDictOpenRef = useRef(false);

  useEffect(() => {
    const w = window as Window & { SpeechRecognition?: ISpeechRecognitionCtor; webkitSpeechRecognition?: ISpeechRecognitionCtor };
    if (!w.SpeechRecognition && !w.webkitSpeechRecognition) setSttSupported(false);
  }, []);

  useEffect(() => {
    const w = window as Window & { __audioCtx?: AudioContext };
    if (w.__audioCtx && w.__audioCtx.state === "running") {
      audioCtxRef.current = w.__audioCtx;
      w.__audioCtx = undefined;
    }
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
    const scrollEl = scrollContainerRef.current;
    if (!scrollEl) return;

    if (messages.length === 1) {
      // DOM 렌더링이 완료된 후 확실하게 맨 위로 즉시 이동
      setTimeout(() => {
        scrollEl.scrollTo({ top: 0, behavior: "auto" });
      }, 50);
    } else if (messages.length > 1 || loading) {
      // 대화가 진행 중일 때는 자연스럽게 맨 아래로 스크롤
      setTimeout(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      }, 50);
    }
  }, [messages, loading]);

  const clearTimers = useCallback(() => {
    timerIdsRef.current.forEach(clearTimeout);
    timerIdsRef.current = [];
  }, []);

  useEffect(() => { summaryOpenRef.current = summaryOpen; }, [summaryOpen]);
  useEffect(() => { dictOpenRef.current = dictOpen; }, [dictOpen]);
  useEffect(() => { messagesLenRef.current = messages.length; }, [messages]);

  // Activity logic: reset inactivity timer on input or listening
  useEffect(() => {
    if (input.length > 0 || listening || shadowListening || shadowOpen || ttsLoading !== null) {
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
        inactivityTimerRef.current = null;
      }
    } else if (messages.length > 0 && !loading && !summaryOpen && !dictOpen && !shadowOpen && ttsLoading === null) {
      if (!inactivityTimerRef.current) {
        inactivityTimerRef.current = setTimeout(() => sendProactiveRef.current("followup"), 50000);
      }
    }
  }, [input, listening, shadowListening, shadowOpen, ttsLoading, messages.length, loading, summaryOpen, dictOpen]);

  useEffect(() => {
    if (summaryOpen && inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
    }
  }, [summaryOpen]);

  useEffect(() => {
    if (dictOpen) {
      prevDictOpenRef.current = true;
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
        inactivityTimerRef.current = null;
      }
    } else if (prevDictOpenRef.current) {
      prevDictOpenRef.current = false;
      if (messagesLenRef.current > 0 && !loadingRef.current && !summaryOpenRef.current && input.length === 0) {
        inactivityTimerRef.current = setTimeout(() => sendProactiveRef.current("followup"), 50000);
      }
    }
  }, [dictOpen, input]);

  const handleNewChat = useCallback(() => {
    setMessages([]);
    setInput("");
    setSummaryOpen(false);
    setSummaryData(null);
    hasGreetedRef.current = false;
    setTimeout(() => sendProactiveRef.current("greet"), 600);
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
    } finally {
      setSummaryLoading(false);
    }
  }, [messages, dialect]);

  const sendProactiveMessage = useCallback(
    async (trigger: "greet" | "followup") => {
      if (loadingRef.current || dictOpenRef.current || summaryOpenRef.current) return;
      if (inactivityTimerRef.current) { clearTimeout(inactivityTimerRef.current); inactivityTimerRef.current = null; }
      loadingRef.current = true;
      setLoading(true);
      let hadError = false;
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            trigger,
            dialect,
            gender,
            level,
            history: messages.map((m) => ({ role: m.role, content: m.spanish })),
          }),
        });
        const data = (await res.json()) as { spanish?: string; korean?: string; error?: string };
        if (!res.ok || !data.spanish) throw new Error(data.error ?? "API error");
        const aiMsg: Message = { role: "assistant", spanish: data.spanish, korean: data.korean ?? "", correction: "없음", showTranslation: false };
        const aiIdx = messages.length;
        setMessages((prev) => [...prev, aiMsg]);
        void playTTSRef.current(aiMsg.spanish, aiIdx);
      } catch (err) {
        hadError = true;
      } finally {
        loadingRef.current = false;
        setLoading(false);
        if (!hadError && !dictOpenRef.current && !summaryOpenRef.current && input.length === 0) {
          inactivityTimerRef.current = setTimeout(() => sendProactiveRef.current("followup"), 50000);
        }
      }
    },
    [dialect, gender, level, messages, input]
  );

  useEffect(() => { sendProactiveRef.current = sendProactiveMessage; }, [sendProactiveMessage]);

  useEffect(() => {
    if (hasGreetedRef.current) return;
    hasGreetedRef.current = true;
    const t = setTimeout(() => sendProactiveRef.current("greet"), 600);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    return () => { if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current); };
  }, []);

  const playTTS = useCallback(
    async (text: string, idx: number) => {
      window.speechSynthesis.cancel();
      clearTimers();
      setHighlight(null);
      setTtsLoading(idx);

      try {
        if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
        const ctx = audioCtxRef.current;
        if (ctx.state === "suspended") await ctx.resume().catch(() => {});

        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, gender, dialect, level }),
        });

        if (res.ok) {
          const buf = await res.arrayBuffer();
          let played = false;
          try {
            if (ctx.state === "suspended") await ctx.resume();
            const audioBuf = await ctx.decodeAudioData(buf.slice(0));
            const source = ctx.createBufferSource();
            source.buffer = audioBuf;
            source.connect(ctx.destination);

            const durationMs = audioBuf.duration * 1000;
            if (isFinite(durationMs) && durationMs > 0) {
              const wordRanges = buildWordRanges(text);
              const totalLen = Math.max(text.length, 1);
              wordRanges.forEach((w) => {
                const t = setTimeout(
                  () => setHighlight({ idx, start: w.start, len: w.len }),
                  (w.start / totalLen) * durationMs
                );
                timerIdsRef.current.push(t);
              });
              timerIdsRef.current.push(setTimeout(() => setHighlight(null), durationMs + 100));
            }

            source.onended = () => { clearTimers(); setHighlight(null); };
            setTtsLoading(null);
            source.start(0);
            played = true;
          } catch (ctxErr) {}

          if (!played) {
            try {
              const blob = new Blob([buf], { type: "audio/mpeg" });
              const url = URL.createObjectURL(blob);
              const audio = new Audio(url);
              audio.onended = () => { URL.revokeObjectURL(url); clearTimers(); setHighlight(null); };
              audio.onerror = () => { URL.revokeObjectURL(url); clearTimers(); setHighlight(null); };
              setTtsLoading(null);
              await audio.play();
              played = true;
            } catch (audioErr) {}
          }
          if (played) return;
        }
      } catch (err) {}

      setTtsLoading(null);
      const utt = new SpeechSynthesisUtterance(text);
      utt.lang = STT_LANG[dialect] ?? "es-MX";
      utt.rate = 0.88;

      const allVoices = window.speechSynthesis.getVoices();
      const ttsLang = dialect.startsWith("ja-") ? "ja" : dialect.startsWith("en-") ? "en" : dialect.startsWith("zh-") ? "zh" : "es";
      const langVoices = allVoices.filter((v) => v.lang.startsWith(ttsLang === "zh" ? "zh" : ttsLang));
      if (langVoices.length > 0) {
        const femalePattern =
          ttsLang === "ja" ? /female|kyoko|akiko|hiroshi.*f|女/i :
          ttsLang === "en" ? /female|samantha|karen|victoria|moira|fiona|zira/i :
          ttsLang === "zh" ? /female|tingting|meijia|女|ting-ting/i :
          /helena|laura|paulina|monica|mónica|female|femenin|sabina/i;
        const malePattern =
          ttsLang === "ja" ? /male|otoya|hiroshi|男/i :
          ttsLang === "en" ? /male|daniel|alex|fred|tom|lee/i :
          ttsLang === "zh" ? /male|lekiu|男|li-mu/i :
          /pablo|raul|juan|diego|miguel|male|masculin/i;
        const picked =
          gender === "female"
            ? langVoices.find((v) => femalePattern.test(v.name)) ?? langVoices[0]
            : langVoices.find((v) => malePattern.test(v.name)) ?? langVoices[langVoices.length - 1];
        utt.voice = picked;
      }
      utt.pitch = gender === "female" ? 1.15 : 0.85;

      utt.onboundary = (ev: SpeechSynthesisEvent) => {
        if (ev.name === "word") {
          const len = (ev as SpeechSynthesisEvent & { charLength?: number }).charLength ?? nextWordLength(text, ev.charIndex);
          setHighlight({ idx, start: ev.charIndex, len });
        }
      };
      utt.onend = () => setHighlight(null);
      utt.onerror = () => setHighlight(null);
      window.speechSynthesis.speak(utt);
    },
    [dialect, gender, level, clearTimers]
  );
  useEffect(() => { playTTSRef.current = playTTS; }, [playTTS]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      if (inactivityTimerRef.current) { clearTimeout(inactivityTimerRef.current); inactivityTimerRef.current = null; }
      setInput("");
      loadingRef.current = true;
      setLoading(true);

      setMessages((prev) => [...prev, { role: "user", spanish: text }]);

      let hadError = false;
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
        const data = (await res.json()) as { spanish?: string; korean?: string; correction?: string; error?: string; };
        if (res.status === 429) throw new Error("rate_limit");
        if (!res.ok || !data.spanish) throw new Error(data.error ?? "API error");
        
        const aiMsg: Message = {
          role: "assistant",
          spanish: data.spanish,
          korean: data.korean ?? "",
          correction: data.correction ?? "없음",
          showTranslation: false
        };

        const aiIdx = messages.length + 1;
        setMessages((prev) => [...prev, aiMsg]);
        void playTTS(aiMsg.spanish, aiIdx);
      } catch (err) {
        hadError = true;
        const isRateLimit = (err as Error).message === "rate_limit";
        const errText = "오류가 발생했습니다. 잠시 후 다시 시도해주세요.";
        setMessages((prev) => [ ...prev, { role: "assistant", spanish: errText, korean: errText }]);
      } finally {
        loadingRef.current = false;
        setLoading(false);
        if (!hadError && !dictOpenRef.current && !summaryOpenRef.current) {
          inactivityTimerRef.current = setTimeout(() => sendProactiveRef.current("followup"), 50000);
        }
      }
    },
    [dialect, gender, level, messages, playTTS]
  );

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
      // Wait slightly to see if user sends manually
      setTimeout(() => {
        if (transcriptRef.current.trim() && !loadingRef.current) {
          sendMessage(transcriptRef.current.trim());
          transcriptRef.current = "";
        }
      }, 300);
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
  
  // Shadowing Handlers
  const startShadowListening = useCallback(() => {
    const w = window as Window & { SpeechRecognition?: ISpeechRecognitionCtor; webkitSpeechRecognition?: ISpeechRecognitionCtor };
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!SR) return;

    const rec = new SR();
    rec.lang = STT_LANG[dialect] ?? "es-MX";
    rec.interimResults = true;
    rec.continuous = false;
    shadowTranscriptRef.current = "";

    rec.onresult = (e: ISpeechRecognitionEvent) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) shadowTranscriptRef.current += t;
      }
    };
    rec.onend = () => {
      setShadowListening(false);
      const score = calculateSimilarity(shadowTarget, shadowTranscriptRef.current);
      setShadowScore(score);
    };
    rec.onerror = () => setShadowListening(false);

    rec.start();
    setShadowScore(null);
    setShadowListening(true);
  }, [dialect, shadowTarget]);

  const stopShadowListening = useCallback(() => {
    setShadowListening(false);
  }, []);

  const openShadow = (text: string) => {
    setShadowTarget(text);
    setShadowScore(null);
    setShadowOpen(true);
  };

  const toggleTranslation = (idx: number) => {
    setMessages(prev => prev.map((msg, i) => i === idx ? { ...msg, showTranslation: !msg.showTranslation } : msg));
  };

  return (
    <div className="flex flex-col h-[100dvh] max-w-2xl mx-auto bg-gradient-to-b from-gray-950 to-indigo-950/20 text-gray-100">
      <header className="flex-shrink-0 z-10 flex items-center justify-between px-4 py-3 glass-panel-light !bg-gray-950/80 border-b border-white/5">
        <Link href="/" className="text-gray-400 hover:text-white text-sm font-semibold transition-colors">
          ← 뒤로
        </Link>
        <span className="flex items-center gap-2 font-bold bg-gray-900/50 px-3 py-1.5 rounded-full border border-white/5">
          {DIALECT_LABEL[dialect]}{" "}
          <span className="text-base">{gender === "male" ? "👨" : "👩"}</span>
          <span className={`text-[10px] px-2 py-0.5 rounded-full border tracking-wide uppercase ${
            level === "beginner"     ? "border-emerald-600 bg-emerald-500/10 text-emerald-400" :
            level === "intermediate" ? "border-indigo-600 bg-indigo-500/10 text-indigo-400" :
                                       "border-violet-600 bg-violet-500/10 text-violet-400"
          }`}>
            {{ beginner: "초급", intermediate: "중급", advanced: "고급" }[level] ?? "초급"}
          </span>
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setDictSearch({ word: "", key: 0 }); setDictOpen(true); }}
            className="text-sm w-8 h-8 rounded-full border border-gray-700 bg-gray-800 flex items-center justify-center hover:border-indigo-500 hover:bg-indigo-900/50 transition-all shadow-md"
            title="사전 열기"
          >
            📖
          </button>
        </div>
      </header>

      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-4">
            {loading ? (
              <>
                <div className="w-12 h-12 rounded-full border-4 border-indigo-500/30 border-t-indigo-500 animate-spin shadow-[0_0_15px_rgba(99,102,241,0.5)]"></div>
                <p className="text-sm font-semibold text-indigo-300 animate-pulse">원어민을 부르고 있습니다...</p>
              </>
            ) : (
              <>
                <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-4xl shadow-lg">💬</div>
                <p className="text-sm text-center font-medium bg-gray-900/50 px-4 py-2 rounded-full border border-white/5">마이크를 누르거나 텍스트를 입력하여 시작하세요</p>
              </>
            )}
          </div>
        )}

        {messages.map((msg, idx) => (
          <div key={idx} className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"} gap-1.5`}>
            <div
              className={`max-w-[85%] rounded-2xl px-5 py-3.5 shadow-xl border ${
                msg.role === "user" 
                  ? "bg-indigo-600 border-indigo-500 text-white rounded-tr-sm" 
                  : "glass-panel bg-gray-800/80 border-gray-700 text-gray-100 rounded-tl-sm"
              }`}
            >
              <div className="flex items-start gap-3">
                <p className="flex-1 text-base leading-relaxed tracking-wide font-medium">
                  {msg.role === "assistant" ? (
                    <SpeechText
                      text={msg.spanish ?? ""}
                      highlight={highlight?.idx === idx ? { start: highlight.start, len: highlight.len } : null}
                      onWordClick={handleWordClick}
                    />
                  ) : (
                    msg.spanish
                  )}
                </p>
              </div>

              {msg.role === "assistant" && msg.showTranslation && msg.korean && (
                <div className="mt-3 text-sm text-indigo-200 bg-indigo-900/30 p-3 rounded-xl border border-indigo-500/20 animate-in fade-in slide-in-from-top-2 duration-300 font-medium">
                  {msg.korean}
                </div>
              )}
            </div>

            {/* 개별 말풍선 하단 컨트롤 툴바 (AI 전용) */}
            {msg.role === "assistant" && (
              <div className="flex items-center gap-2 pl-2">
                <button
                  onClick={() => toggleTranslation(idx)}
                  className="text-xs font-semibold px-2.5 py-1 rounded-full border border-gray-700 bg-gray-800/50 text-gray-400 hover:text-white hover:border-gray-500 transition-colors"
                >
                  {msg.showTranslation ? "번역 숨기기" : "번역 보기"}
                </button>
                <button
                  onClick={() => playTTS(msg.spanish, idx)}
                  disabled={ttsLoading === idx}
                  className="text-xs font-semibold px-2.5 py-1 rounded-full border border-indigo-700/50 bg-indigo-900/30 text-indigo-300 hover:bg-indigo-800/50 transition-colors disabled:opacity-50"
                  title="다시 듣기"
                >
                  {ttsLoading === idx ? "로딩중..." : "🔊 발음 듣기"}
                </button>
                <button
                  onClick={() => openShadow(msg.spanish)}
                  className="text-xs font-semibold px-2.5 py-1 rounded-full border border-emerald-700/50 bg-emerald-900/30 text-emerald-300 hover:bg-emerald-800/50 transition-colors"
                  title="Shadowing"
                >
                  🎤 따라 읽기
                </button>
              </div>
            )}
          </div>
        ))}

        {loading && messages.length > 0 && (
          <div className="flex justify-start">
            <div className="glass-panel bg-gray-800/80 rounded-2xl rounded-tl-sm px-5 py-3 flex gap-1.5 items-center">
              <span className="w-2 h-2 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: "0ms" }}></span>
              <span className="w-2 h-2 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: "150ms" }}></span>
              <span className="w-2 h-2 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: "300ms" }}></span>
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
        title={
          dialect.startsWith("ja-") ? "📖 한-일 사전" :
          dialect.startsWith("en-") ? "📖 한-영 사전" :
          dialect.startsWith("zh-") ? "📖 한-중 사전" :
          "📖 한-스 사전"
        }
      />

      {/* Shadowing Modal */}
      {shadowOpen && (
         <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="glass-panel rounded-3xl w-full max-w-sm p-6 flex flex-col items-center border border-indigo-500/30 shadow-2xl shadow-indigo-900/50">
               <div className="w-full flex justify-between items-center mb-6">
                 <span className="text-xs font-bold uppercase tracking-widest text-indigo-400">Shadowing 모드</span>
                 <button onClick={() => setShadowOpen(false)} className="text-gray-400 hover:text-white w-6 h-6 flex items-center justify-center">✕</button>
               </div>
               
               <p className="text-lg font-bold text-center mb-6 leading-relaxed bg-gray-900/50 p-4 rounded-2xl border border-white/5">{shadowTarget}</p>
               
               {shadowScore !== null && (
                 <div className="mb-6 flex flex-col items-center">
                   <div className="relative w-24 h-24 flex items-center justify-center rounded-full bg-gray-900 border-4 shadow-inner" style={{ borderColor: shadowScore > 80 ? '#10B981' : shadowScore > 50 ? '#F59E0B' : '#EF4444' }}>
                     <span className="text-2xl font-black">{shadowScore}%</span>
                   </div>
                   <p className="text-sm mt-3 text-gray-400 font-medium">일치율 점수</p>
                 </div>
               )}

               <div className="flex gap-4 w-full justify-center">
                 <button onClick={() => playTTS(shadowTarget, -999)} className="flex-1 py-3 rounded-2xl bg-gray-800 hover:bg-gray-700 text-white font-bold transition-all border border-gray-600">
                    🔊 듣기
                 </button>
                 <button 
                   onClick={shadowListening ? stopShadowListening : startShadowListening} 
                   className={`flex-1 py-3 rounded-2xl font-bold transition-all border flex items-center justify-center gap-2 ${
                     shadowListening 
                       ? "bg-red-500/20 text-red-400 border-red-500 shadow-[0_0_15px_rgba(239,68,68,0.5)] animate-waveform" 
                       : "bg-indigo-600 hover:bg-indigo-500 text-white border-indigo-500 shadow-lg shadow-indigo-600/20"
                   }`}
                 >
                    {shadowListening ? "⏹ 녹음 중지" : "🎤 녹음"}
                 </button>
               </div>
            </div>
         </div>
      )}

      {summaryOpen && (
        <SummaryModal
          data={summaryData}
          loading={summaryLoading}
          dialect={dialect}
          onClose={() => setSummaryOpen(false)}
          onExit={() => {
            if (summaryData) {
              try {
                const entry = {
                  date: new Date().toISOString(),
                  dialect,
                  gender,
                  level,
                  words: summaryData.words,
                  expressions: summaryData.expressions,
                };
                const prev: typeof entry[] = JSON.parse(
                  localStorage.getItem("livelingo_summaries") ?? "[]"
                );
                localStorage.setItem(
                  "livelingo_summaries",
                  JSON.stringify([entry, ...prev].slice(0, 3))
                );
                localStorage.setItem("livelingo_last_summary", JSON.stringify(summaryData));
                localStorage.setItem("livelingo_last_settings", JSON.stringify({ dialect, gender, level }));
              } catch {}
            }
            router.push("/");
          }}
          onNewChat={handleNewChat}
          onPlayTTS={(text, idx) => { void playTTSRef.current(text, idx); }}
          ttsLoading={ttsLoading}
        />
      )}

      <div className="sticky bottom-0 z-10 px-4 pt-3 pb-1 glass-panel-light !bg-gray-950/80 border-t border-white/5 shadow-[0_-10px_30px_rgba(0,0,0,0.5)]">
        <div className="flex items-center gap-2.5">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                // 사용자가 입력 중 엔터를 치면, 리스닝 상태라도 수동 전송.
                if (listening) {
                   stopListening();
                   transcriptRef.current = "";
                }
                sendMessage(input);
              }
            }}
            placeholder={
              dialect.startsWith("ja-") ? "일본어로 말하거나 입력..." :
              dialect.startsWith("en-") ? "영어로 말하거나 입력..." :
              dialect.startsWith("zh-") ? "중국어로 말하거나 입력..." :
              "스페인어로 말하거나 입력..."
            }
            className="flex-1 bg-gray-900/80 border border-gray-700/50 rounded-2xl px-5 py-3.5 text-sm outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 placeholder-gray-500 transition-all shadow-inner"
          />

          {sttSupported && (
            <button
              onClick={listening ? stopListening : startListening}
              disabled={loading}
              className={`w-12 h-12 rounded-full flex items-center justify-center text-xl transition-all shadow-lg ${
                listening 
                  ? "bg-red-500 shadow-red-500/40 animate-waveform" 
                  : "bg-indigo-600 hover:bg-indigo-500 shadow-indigo-600/30"
              } disabled:opacity-50`}
              title={listening ? "녹음 중지" : "음성 입력"}
            >
              {listening ? "⏹" : "🎤"}
            </button>
          )}

          <button
            onClick={() => {
              if (listening) { stopListening(); transcriptRef.current = ""; }
              sendMessage(input);
            }}
            disabled={loading || !input.trim()}
            className="w-12 h-12 rounded-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 flex items-center justify-center text-xl shadow-lg shadow-indigo-600/30 disabled:opacity-50 transition-all transform hover:scale-105 active:scale-95"
            title="전송"
          >
            ➤
          </button>
        </div>
        {messages.length > 0 && (
          <button
            onClick={handleStop}
            className="w-full mt-4 py-3 rounded-2xl border border-red-900/50 bg-red-950/20 text-red-400 hover:bg-red-900/40 hover:border-red-500/50 hover:text-red-300 text-sm font-bold transition-all shadow-inner"
          >
            대화 종료 및 학습 정리
          </button>
        )}
      </div>
    </div>
  );
}

function SummaryModal({
  data,
  loading,
  dialect,
  onClose,
  onExit,
  onNewChat,
  onPlayTTS,
  ttsLoading,
}: {
  data: SummaryData | null;
  loading: boolean;
  dialect: string;
  onClose: () => void;
  onExit: () => void;
  onNewChat: () => void;
  onPlayTTS: (text: string, idx: number) => void;
  ttsLoading: number | null;
}) {
  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="glass-panel rounded-t-3xl sm:rounded-3xl w-full sm:max-w-lg max-h-[92vh] flex flex-col overflow-hidden shadow-2xl border-white/10">
        <div className="flex items-center justify-between px-6 py-5 border-b border-white/10 flex-shrink-0 bg-gray-900/50">
          <span className="font-extrabold text-lg">📚 오늘의 학습 정리</span>
          <button onClick={onClose} className="text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-full w-8 h-8 flex items-center justify-center transition-all">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading && (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <div className="w-12 h-12 border-4 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin"></div>
              <p className="text-indigo-300 font-bold text-sm animate-pulse">대화 내용을 분석하고 정리하는 중...</p>
            </div>
          )}

          {!loading && !data && (
            <p className="text-center text-gray-500 font-medium py-16">분석 결과를 불러올 수 없습니다.</p>
          )}

          {!loading && data && (
            <div className="space-y-8">
              <section>
                <h3 className="text-xs font-bold text-indigo-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                   <span className="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>
                   핵심 단어 ({data.words?.length ?? 0})
                </h3>
                <div className="space-y-2">
                  {data.words?.map((w, i) => (
                    <div key={i} className="flex items-start gap-4 bg-gray-800/40 rounded-2xl px-4 py-3.5 border border-white/5">
                      <span className="text-gray-600 text-xs font-bold mt-1 min-w-[16px]">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2 flex-wrap mb-1">
                          {(dialect.startsWith("ja-") || dialect.startsWith("zh-")) && w.reading ? (
                            <ruby className="font-bold text-white text-base">
                              {w.word}
                              <rt className="text-[10px] font-medium text-indigo-300 tracking-wider">{w.reading}</rt>
                            </ruby>
                          ) : (
                            <span className="font-bold text-white text-base">{w.word}</span>
                          )}
                          {w.pos && <span className="text-[10px] font-semibold text-indigo-300 bg-indigo-900/40 border border-indigo-700/50 px-2 py-0.5 rounded-full">{w.pos}</span>}
                        </div>
                        <p className="text-sm text-gray-300 font-medium">{w.translation}</p>
                        {w.example && <p className="text-xs text-gray-500 mt-1.5 italic bg-gray-900/50 p-2 rounded-lg border border-white/5">{w.example}</p>}
                      </div>
                      <button onClick={() => onPlayTTS(w.word, -(i + 1))} disabled={ttsLoading === -(i + 1)} className="text-indigo-400 bg-indigo-900/30 hover:bg-indigo-800/50 p-2 rounded-full transition-colors disabled:opacity-50 mt-0.5" title="발음 듣기">
                        {ttsLoading === -(i + 1) ? "⏳" : "🔊"}
                      </button>
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <h3 className="text-xs font-bold text-emerald-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                   <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                   핵심 표현 ({data.expressions?.length ?? 0})
                </h3>
                <div className="space-y-2">
                  {data.expressions?.map((e, i) => (
                    <div key={i} className="flex items-start gap-4 bg-gray-800/40 rounded-2xl px-4 py-3.5 border border-white/5">
                      <span className="text-gray-600 text-xs font-bold mt-1 min-w-[16px]">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-emerald-300 text-base mb-1">{e.expression}</p>
                        <p className="text-sm text-gray-300 font-medium">{e.translation}</p>
                        {e.usage && <p className="text-xs text-gray-500 mt-2 leading-relaxed bg-gray-900/50 p-2 rounded-lg border border-white/5">{e.usage}</p>}
                      </div>
                      <button onClick={() => onPlayTTS(e.expression, -(100 + i + 1))} disabled={ttsLoading === -(100 + i + 1)} className="text-emerald-400 bg-emerald-900/30 hover:bg-emerald-800/50 p-2 rounded-full transition-colors disabled:opacity-50 mt-0.5" title="발음 듣기">
                        {ttsLoading === -(100 + i + 1) ? "⏳" : "🔊"}
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}
        </div>

        <div className="flex gap-3 px-6 py-5 border-t border-white/10 flex-shrink-0 bg-gray-900/50">
          <button onClick={onExit} className="flex-1 py-3.5 rounded-2xl border border-red-900/50 bg-red-950/20 text-red-400 font-bold hover:bg-red-900/40 hover:text-red-300 transition-colors">
            홈으로
          </button>
          <button onClick={onNewChat} className="flex-1 py-3.5 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold transition-all shadow-lg shadow-indigo-600/20">
            새 대화 시작
          </button>
        </div>
      </div>
    </div>
  );
}

function buildWordRanges(text: string): { start: number; len: number }[] {
  const ranges: { start: number; len: number }[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) ranges.push({ start: m.index, len: m[0].length });
  return ranges;
}

function nextWordLength(text: string, charIndex: number): number {
  const end = text.indexOf(" ", charIndex);
  return (end === -1 ? text.length : end) - charIndex;
}
