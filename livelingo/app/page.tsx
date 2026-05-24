"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { SRSItem, calculateSuperMemo2, getDueItems } from "./utils/srsHelper";

type Lang = "en" | "es" | "zh" | "ja";

const DIALECTS_EN = [
  { code: "en-US", flag: "🇺🇸", name: "미국 영어", sub: "American English" },
  { code: "en-GB", flag: "🇬🇧", name: "영국 영어", sub: "British English" },
];

const DIALECTS_ES = [
  { code: "es-MX", flag: "🇲🇽", name: "멕시코", sub: "라틴아메리카 표준" },
  { code: "es-CO", flag: "🇨🇴", name: "콜롬비아", sub: "명확한 발음" },
  { code: "es-ES", flag: "🇪🇸", name: "스페인", sub: "카스티야 발음" },
  { code: "es-AR", flag: "🇦🇷", name: "아르헨티나", sub: "voseo 사용" },
];

const DIALECTS_ZH = [
  { code: "zh-CN", flag: "🇨🇳", name: "중국어 (간체)", sub: "보통화 · 대륙" },
  { code: "zh-TW", flag: "🇹🇼", name: "중국어 (번체)", sub: "보통화 · 대만" },
];

const DIALECTS_JA = [
  { code: "ja-JP", flag: "🇯🇵", name: "표준 일본어", sub: "도쿄·공통어" },
  { code: "ja-KS", flag: "🏯", name: "간사이 방언", sub: "오사카·교토" },
];

const LEVELS = [
  { code: "beginner",     label: "초급", color: "emerald" },
  { code: "intermediate", label: "중급", color: "indigo"  },
  { code: "advanced",     label: "고급", color: "violet"  },
] as const;

type Level = typeof LEVELS[number]["code"];

const LEVEL_ACTIVE: Record<string, string> = {
  emerald: "border-emerald-500 bg-emerald-500/20 text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.3)]",
  indigo:  "border-indigo-500 bg-indigo-500/20 text-indigo-300 shadow-[0_0_15px_rgba(99,102,241,0.3)]",
  violet:  "border-violet-500 bg-violet-500/20 text-violet-300 shadow-[0_0_15px_rgba(139,92,246,0.3)]",
};

const DIALECT_LABEL: Record<string, string> = {
  "en-US": "🇺🇸 미국 영어",
  "en-GB": "🇬🇧 영국 영어",
  "es-MX": "🇲🇽 멕시코",
  "es-CO": "🇨🇴 콜롬비아",
  "es-ES": "🇪🇸 스페인",
  "es-AR": "🇦🇷 아르헨티나",
  "zh-CN": "🇨🇳 중국어 (간체)",
  "zh-TW": "🇹🇼 중국어 (번체)",
  "ja-JP": "🇯🇵 표준 일본어",
  "ja-KS": "🏯 간사이 방언",
};

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
interface SavedSummaryEntry {
  date: string;       
  dialect: string;
  gender: string;
  level: string;
  words: SummaryWord[];
  expressions: SummaryExpression[];
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const sameDay = (a: Date, b: Date) =>
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate();
    if (sameDay(d, today)) return "오늘";
    if (sameDay(d, yesterday)) return "어제";
    return `${d.getMonth() + 1}/${d.getDate()}`;
  } catch {
    return "";
  }
}

function primeAudio() {
  if (typeof window === "undefined") return;
  try {
    const w = window as Window & { __audioCtx?: AudioContext };
    if (!w.__audioCtx) w.__audioCtx = new AudioContext();
    if (w.__audioCtx.state === "suspended") void w.__audioCtx.resume().catch(() => {});
  } catch {}
}

export default function Home() {
  const [lang, setLang] = useState<Lang>("en");
  const [gender, setGender] = useState<"female" | "male">("female");
  const [level, setLevel] = useState<Level>("beginner");
  const [savedSummaries, setSavedSummaries] = useState<SavedSummaryEntry[]>([]);
  const [srsItems, setSrsItems] = useState<SRSItem[]>([]);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [srsReviewOpen, setSrsReviewOpen] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("livelingo_summaries");
      if (raw) {
        const arr = JSON.parse(raw) as SavedSummaryEntry[];
        if (Array.isArray(arr) && arr.length > 0) {
          setSavedSummaries(arr);
        }
      }
      
      const srsRaw = localStorage.getItem("livelingo_srs_items");
      if (srsRaw) {
        const arr = JSON.parse(srsRaw) as SRSItem[];
        setSrsItems(arr);
      }
    } catch {}
  }, []);

  const filteredSummaries = savedSummaries.filter(s => s.dialect.startsWith(lang + "-"));
  const filteredSrsItems = srsItems.filter(s => s.dialect.startsWith(lang + "-"));
  const dueItems = getDueItems(filteredSrsItems);

  const dialects =
    lang === "en" ? DIALECTS_EN :
    lang === "zh" ? DIALECTS_ZH :
    lang === "ja" ? DIALECTS_JA :
    DIALECTS_ES;

  const subtitle =
    lang === "en" ? "영어 대화 연습" :
    lang === "zh" ? "중국어 대화 연습" :
    lang === "ja" ? "일본어 대화 연습" :
    "스페인어 대화 연습";

  return (
    <main className="flex flex-col items-center justify-center min-h-screen px-4 pb-28 animate-gradient from-gray-950 via-indigo-950/40 to-gray-950 bg-gradient-to-br">
      <div className="glass-panel rounded-3xl p-8 w-full max-w-sm flex flex-col items-center relative overflow-hidden">
        {/* Glow effect */}
        <div className="absolute top-0 right-0 -mr-16 -mt-16 w-32 h-32 rounded-full bg-indigo-500/20 blur-3xl pointer-events-none"></div>
        <div className="absolute bottom-0 left-0 -ml-16 -mb-16 w-32 h-32 rounded-full bg-pink-500/20 blur-3xl pointer-events-none"></div>

        <h1 className="text-4xl font-extrabold mb-1 tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-pink-400">
          LiveLingo
        </h1>
        <p className="text-gray-400 mb-8 text-sm font-medium">{subtitle}</p>

        {/* Language tabs */}
        <div className="flex gap-1 mb-8 bg-gray-950/50 backdrop-blur-md border border-white/5 rounded-xl p-1.5 shadow-inner">
          {([
            { id: "en" as Lang, label: "🇺🇸 영어" },
            { id: "es" as Lang, label: "🇪🇸 스페인어" },
            { id: "zh" as Lang, label: "🇨🇳 중국어" },
            { id: "ja" as Lang, label: "🇯🇵 일본어" },
          ] as const).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setLang(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition-all ${
                lang === tab.id
                  ? "bg-indigo-600/80 text-white shadow-md shadow-indigo-500/20 border border-indigo-500/50"
                  : "text-gray-500 hover:text-gray-300 hover:bg-gray-800/50 border border-transparent"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Controls row */}
        <div className="flex items-center gap-3 mb-8 flex-wrap justify-center w-full">
          {(["female", "male"] as const).map((g) => (
            <button
              key={g}
              onClick={() => setGender(g)}
              className={`px-4 py-2 rounded-full border text-xs font-semibold transition-all ${
                gender === g
                  ? g === "female"
                    ? "border-pink-500 bg-pink-500/20 text-pink-300 shadow-[0_0_15px_rgba(236,72,153,0.3)]"
                    : "border-blue-500 bg-blue-500/20 text-blue-300 shadow-[0_0_15px_rgba(59,130,246,0.3)]"
                  : "border-gray-700 bg-gray-900/50 text-gray-400 hover:border-gray-500 hover:text-gray-200"
              }`}
            >
              {g === "female" ? "👩 여성" : "👨 남성"}
            </button>
          ))}

          <div className="w-full h-px bg-gray-800/50 my-1"></div>

          {LEVELS.map((lv) => (
            <button
              key={lv.code}
              onClick={() => setLevel(lv.code)}
              className={`px-4 py-2 rounded-full border text-xs font-semibold transition-all ${
                level === lv.code
                  ? LEVEL_ACTIVE[lv.color]
                  : "border-gray-700 bg-gray-900/50 text-gray-400 hover:border-gray-500 hover:text-gray-200"
              }`}
            >
              {lv.label}
            </button>
          ))}
        </div>

        {/* Dialect list */}
        <div className="w-full flex flex-col gap-2.5">
          {dialects.map((d) => (
            <Link
              key={d.code}
              href={`/talk?dialect=${d.code}&gender=${gender}&level=${level}`}
              onClick={primeAudio}
              className="flex items-center gap-4 px-5 py-3.5 rounded-2xl border border-white/5 bg-gray-900/40 hover:border-indigo-500/50 hover:bg-indigo-900/20 transition-all group shadow-sm hover:shadow-indigo-500/10"
            >
              <span className="text-3xl filter drop-shadow-md">{d.flag}</span>
              <div className="flex flex-col">
                <span className="font-bold text-sm text-gray-200 group-hover:text-indigo-300 transition-colors">{d.name}</span>
                <span className="text-gray-500 text-xs font-medium">{d.sub}</span>
              </div>
              <div className="ml-auto w-8 h-8 rounded-full bg-gray-800/50 group-hover:bg-indigo-600/50 flex items-center justify-center transition-colors">
                <span className="text-gray-400 group-hover:text-white text-xs">➔</span>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Bottom bar */}
      {(filteredSummaries.length > 0 || dueItems.length > 0 || filteredSrsItems.length > 0) && (
        <div className="fixed bottom-0 left-0 right-0 flex flex-col items-center px-4 py-4 bg-gray-950/80 backdrop-blur-xl border-t border-white/5 z-40">
          <div className="w-full max-w-sm flex gap-3">
            {filteredSummaries.length > 0 && (
              <button
                onClick={() => setReviewOpen(true)}
                className="flex-1 py-3 rounded-2xl bg-gray-800 hover:bg-gray-700 text-gray-200 border border-white/10 text-sm font-semibold transition-all shadow-lg hover:shadow-gray-700/50 flex items-center justify-center gap-2"
              >
                <span>💬 대화 복습</span>
              </button>
            )}
            
            {(dueItems.length > 0 || filteredSrsItems.length > 0) && (
              <button
                onClick={() => setSrsReviewOpen(true)}
                className="flex-1 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white border border-indigo-400/30 text-sm font-semibold transition-all shadow-lg shadow-indigo-600/20 hover:shadow-indigo-500/40 flex items-center justify-center gap-2 relative overflow-hidden"
              >
                <span className="relative z-10">📚 단어장 복습</span>
                {dueItems.length > 0 && (
                  <span className="absolute top-0 right-0 -mt-1 -mr-1 flex h-4 w-4 z-20">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-pink-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-4 w-4 bg-pink-500 text-[9px] font-bold items-center justify-center text-white">{dueItems.length}</span>
                  </span>
                )}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Review modals */}
      {reviewOpen && (
        <ReviewModal
          entries={filteredSummaries}
          onClose={() => setReviewOpen(false)}
        />
      )}
      
      {srsReviewOpen && (
        <SRSReviewModal 
          items={srsItems}
          langPrefix={lang + "-"}
          onUpdate={(newItems) => {
            setSrsItems(newItems);
            localStorage.setItem("livelingo_srs_items", JSON.stringify(newItems));
          }}
          onClose={() => setSrsReviewOpen(false)} 
        />
      )}
    </main>
  );
}

function ReviewModal({
  entries,
  onClose,
}: {
  entries: SavedSummaryEntry[];
  onClose: () => void;
}) {
  const [tab, setTab] = useState(0);
  const entry = entries[tab];
  if (!entry) return null;

  const showRuby = entry.dialect.startsWith("ja-") || entry.dialect.startsWith("zh-");

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="glass-panel rounded-t-3xl sm:rounded-3xl w-full sm:max-w-lg max-h-[92vh] flex flex-col border-white/10 overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between px-6 py-5 border-b border-white/10 flex-shrink-0 bg-gray-900/50">
          <span className="font-extrabold text-lg text-white">💬 지난 대화 세션</span>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-full w-8 h-8 flex items-center justify-center transition-all"
          >
            ✕
          </button>
        </div>

        {entries.length > 1 && (
          <div className="flex gap-2 px-5 pt-4 pb-2 flex-shrink-0 overflow-x-auto">
            {entries.map((e, i) => (
              <button
                key={i}
                onClick={() => setTab(i)}
                className={`flex-shrink-0 px-4 py-2 rounded-xl text-xs font-semibold transition-all border border-transparent ${
                  tab === i
                    ? "bg-indigo-600/30 border-indigo-500/50 text-indigo-300 shadow-inner"
                    : "bg-gray-800/50 text-gray-400 hover:text-gray-200 hover:bg-gray-700/50"
                }`}
              >
                <span className="block text-[10px] opacity-70 mb-0.5">
                  {formatDate(e.date)}
                </span>
                <span>{DIALECT_LABEL[e.dialect] ?? e.dialect}</span>
              </button>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="space-y-8">
            {entry.words?.length > 0 && (
              <section>
                <h3 className="text-xs font-bold text-indigo-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>
                  핵심 단어 ({entry.words.length})
                </h3>
                <div className="space-y-2">
                  {entry.words.map((w, i) => (
                    <div key={i} className="flex items-start gap-4 bg-gray-800/40 rounded-2xl px-4 py-3.5 border border-white/5 hover:bg-gray-800/60 transition-colors">
                      <span className="text-gray-600 text-xs font-bold mt-1 min-w-[16px]">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2 flex-wrap mb-1">
                          {showRuby && w.reading ? (
                            <ruby className="font-bold text-white text-base">
                              {w.word}
                              <rt className="text-[10px] font-medium text-indigo-300 tracking-wider">{w.reading}</rt>
                            </ruby>
                          ) : (
                            <span className="font-bold text-white text-base">{w.word}</span>
                          )}
                          {w.pos && (
                            <span className="text-[10px] font-semibold text-indigo-300 bg-indigo-900/40 border border-indigo-700/50 px-2 py-0.5 rounded-full">
                              {w.pos}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-300 font-medium">{w.translation}</p>
                        {w.example && (
                          <p className="text-xs text-gray-500 mt-1.5 italic bg-gray-900/50 p-2 rounded-lg border border-white/5">{w.example}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {entry.expressions?.length > 0 && (
              <section>
                <h3 className="text-xs font-bold text-emerald-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                  핵심 표현 ({entry.expressions.length})
                </h3>
                <div className="space-y-2">
                  {entry.expressions.map((e, i) => (
                    <div key={i} className="flex items-start gap-4 bg-gray-800/40 rounded-2xl px-4 py-3.5 border border-white/5 hover:bg-gray-800/60 transition-colors">
                      <span className="text-gray-600 text-xs font-bold mt-1 min-w-[16px]">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-emerald-300 text-base mb-1">{e.expression}</p>
                        <p className="text-sm text-gray-300 font-medium">{e.translation}</p>
                        {e.usage && (
                          <p className="text-xs text-gray-500 mt-2 leading-relaxed bg-gray-900/50 p-2 rounded-lg border border-white/5">{e.usage}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>

        <div className="px-6 py-5 border-t border-white/10 flex-shrink-0 bg-gray-900/50">
          <button
            onClick={onClose}
            className="w-full py-3.5 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold transition-all shadow-lg shadow-indigo-600/20"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}

function SRSReviewModal({
  items,
  langPrefix,
  onUpdate,
  onClose,
}: {
  items: SRSItem[];
  langPrefix: string;
  onUpdate: (newItems: SRSItem[]) => void;
  onClose: () => void;
}) {
  const [sessionItems, setSessionItems] = useState<SRSItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [isDone, setIsDone] = useState(false);

  useEffect(() => {
    const langItems = items.filter(it => it.dialect.startsWith(langPrefix));
    const due = getDueItems(langItems);
    setSessionItems(due.length > 0 ? due : langItems.slice(0, 5)); // 복습할게 없으면 해당 언어의 최근 5개 무작위
  }, [items, langPrefix]);

  const currentItem = sessionItems[currentIndex];

  const handleScore = (quality: number) => {
    if (!currentItem) return;
    
    const updatedSRS = calculateSuperMemo2(
      quality,
      currentItem.easiness_factor,
      currentItem.repetitions,
      currentItem.interval_days
    );

    const updatedItem = { ...currentItem, ...updatedSRS };
    
    const newAllItems = items.map(it => it.id === updatedItem.id ? updatedItem : it);
    onUpdate(newAllItems);

    if (currentIndex < sessionItems.length - 1) {
      setCurrentIndex(currentIndex + 1);
      setFlipped(false);
    } else {
      setIsDone(true);
    }
  };

  if (isDone || sessionItems.length === 0) {
    return (
      <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
         <div className="glass-panel rounded-3xl w-full max-w-sm p-8 flex flex-col items-center text-center">
            <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center mb-4">
               <span className="text-3xl">🎉</span>
            </div>
            <h2 className="text-xl font-bold text-white mb-2">학습 완료!</h2>
            <p className="text-gray-400 text-sm mb-6">모든 단어장 복습을 마쳤습니다. 대단해요!</p>
            <button
              onClick={onClose}
              className="w-full py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold transition-all"
            >
              홈으로 돌아가기
            </button>
         </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Progress */}
        <div className="mb-6 flex items-center justify-between">
           <span className="text-gray-400 font-medium text-sm">진행도 {currentIndex + 1} / {sessionItems.length}</span>
           <button onClick={onClose} className="text-gray-500 hover:text-white">✕ 닫기</button>
        </div>

        {/* Card */}
        <div 
          onClick={() => !flipped && setFlipped(true)}
          className={`glass-panel rounded-3xl p-8 min-h-[300px] flex flex-col justify-center items-center text-center cursor-pointer transition-all duration-500 transform ${flipped ? "bg-gray-800/80 border-indigo-500/30" : "hover:scale-[1.02]"}`}
        >
          {currentItem.type === "expression" && <span className="text-xs text-indigo-400 font-bold mb-4 uppercase tracking-widest border border-indigo-500/30 rounded-full px-3 py-1 bg-indigo-500/10">표현</span>}
          {currentItem.type === "word" && <span className="text-xs text-emerald-400 font-bold mb-4 uppercase tracking-widest border border-emerald-500/30 rounded-full px-3 py-1 bg-emerald-500/10">단어</span>}
          
          {currentItem.reading && flipped ? (
             <ruby className="font-bold text-white text-3xl mb-4">
               {currentItem.text}
               <rt className="text-sm font-medium text-indigo-300">{currentItem.reading}</rt>
             </ruby>
          ) : (
            <h2 className="text-3xl font-bold text-white mb-4">{currentItem.text}</h2>
          )}

          {!flipped ? (
            <p className="text-gray-500 mt-8 text-sm animate-pulse">탭하여 뒷면 확인</p>
          ) : (
            <div className="mt-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
               <p className="text-xl text-emerald-300 font-medium mb-4">{currentItem.translation}</p>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        {flipped && (
          <div className="mt-8 grid grid-cols-4 gap-2 animate-in fade-in slide-in-from-bottom-4 duration-500">
             <button onClick={() => handleScore(1)} className="flex flex-col items-center p-3 rounded-2xl bg-gray-900 border border-red-500/30 hover:bg-red-500/20 text-red-400 transition-all">
                <span className="text-xl mb-1">🤯</span>
                <span className="text-xs font-bold">기억안남</span>
             </button>
             <button onClick={() => handleScore(3)} className="flex flex-col items-center p-3 rounded-2xl bg-gray-900 border border-yellow-500/30 hover:bg-yellow-500/20 text-yellow-400 transition-all">
                <span className="text-xl mb-1">🤔</span>
                <span className="text-xs font-bold">어려움</span>
             </button>
             <button onClick={() => handleScore(4)} className="flex flex-col items-center p-3 rounded-2xl bg-gray-900 border border-green-500/30 hover:bg-green-500/20 text-green-400 transition-all">
                <span className="text-xl mb-1">👍</span>
                <span className="text-xs font-bold">보통</span>
             </button>
             <button onClick={() => handleScore(5)} className="flex flex-col items-center p-3 rounded-2xl bg-gray-900 border border-blue-500/30 hover:bg-blue-500/20 text-blue-400 transition-all">
                <span className="text-xl mb-1">😎</span>
                <span className="text-xs font-bold">쉬움</span>
             </button>
          </div>
        )}
      </div>
    </div>
  );
}
