"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Lang = "es" | "ja";

const DIALECTS_ES = [
  { code: "es-MX", flag: "🇲🇽", name: "멕시코", sub: "라틴아메리카 표준" },
  { code: "es-CO", flag: "🇨🇴", name: "콜롬비아", sub: "명확한 발음" },
  { code: "es-ES", flag: "🇪🇸", name: "스페인", sub: "카스티야 발음" },
  { code: "es-AR", flag: "🇦🇷", name: "아르헨티나", sub: "voseo 사용" },
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
  emerald: "border-emerald-500 bg-emerald-500/10 text-emerald-300",
  indigo:  "border-indigo-500 bg-indigo-500/10 text-indigo-300",
  violet:  "border-violet-500 bg-violet-500/10 text-violet-300",
};

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
interface SavedSettings {
  dialect: string;
  gender: string;
  level: string;
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
  const router = useRouter();
  const [lang, setLang] = useState<Lang>("es");
  const [gender, setGender] = useState<"female" | "male">("female");
  const [level, setLevel] = useState<Level>("beginner");
  const [savedSummary, setSavedSummary] = useState<SummaryData | null>(null);
  const [savedSettings, setSavedSettings] = useState<SavedSettings | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("livelingo_last_summary");
      const rawSettings = localStorage.getItem("livelingo_last_settings");
      if (raw) setSavedSummary(JSON.parse(raw));
      if (rawSettings) setSavedSettings(JSON.parse(rawSettings));
    } catch {}
  }, []);

  const talkHref = savedSettings
    ? `/talk?dialect=${savedSettings.dialect}&gender=${savedSettings.gender}&level=${savedSettings.level}`
    : `/talk?dialect=${lang === "ja" ? "ja-JP" : "es-MX"}&gender=${gender}&level=${level}`;

  const dialects = lang === "ja" ? DIALECTS_JA : DIALECTS_ES;
  const subtitle = lang === "ja" ? "일본어 대화 연습" : "스페인어 대화 연습";

  return (
    <main className="flex flex-col items-center justify-center min-h-screen px-4 pb-28">
      <h1 className="text-3xl font-bold mb-1 tracking-tight">LiveLingo</h1>
      <p className="text-gray-500 mb-6 text-sm">{subtitle}</p>

      {/* Language tabs */}
      <div className="flex gap-1 mb-6 bg-gray-900 border border-gray-800 rounded-xl p-1">
        {([
          { id: "es" as Lang, label: "🇪🇸 스페인어" },
          { id: "ja" as Lang, label: "🇯🇵 일본어" },
        ] as const).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setLang(tab.id)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
              lang === tab.id
                ? "bg-indigo-600 text-white"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Controls row */}
      <div className="flex items-center gap-3 mb-6 flex-wrap justify-center">
        {(["female", "male"] as const).map((g) => (
          <button
            key={g}
            onClick={() => setGender(g)}
            className={`px-3 py-1.5 rounded-full border text-xs font-medium transition-all ${
              gender === g
                ? g === "female"
                  ? "border-pink-500 bg-pink-500/10 text-pink-300"
                  : "border-blue-500 bg-blue-500/10 text-blue-300"
                : "border-gray-700 text-gray-500 hover:border-gray-500 hover:text-gray-300"
            }`}
          >
            {g === "female" ? "👩 여성" : "👨 남성"}
          </button>
        ))}

        <span className="text-gray-700 text-xs">|</span>

        {LEVELS.map((lv) => (
          <button
            key={lv.code}
            onClick={() => setLevel(lv.code)}
            className={`px-3 py-1.5 rounded-full border text-xs font-medium transition-all ${
              level === lv.code
                ? LEVEL_ACTIVE[lv.color]
                : "border-gray-700 text-gray-500 hover:border-gray-500 hover:text-gray-300"
            }`}
          >
            {lv.label}
          </button>
        ))}
      </div>

      {/* Dialect list */}
      <div className="w-full max-w-xs flex flex-col gap-1.5">
        {dialects.map((d) => (
          <Link
            key={d.code}
            href={`/talk?dialect=${d.code}&gender=${gender}&level=${level}`}
            onClick={primeAudio}
            className="flex items-center gap-3 px-4 py-2.5 rounded-xl border border-gray-800 bg-gray-900 hover:border-indigo-500 hover:bg-gray-800/80 transition-all group"
          >
            <span className="text-2xl">{d.flag}</span>
            <span className="font-medium text-sm group-hover:text-indigo-300 transition-colors">{d.name}</span>
            <span className="text-gray-600 text-xs ml-auto">{d.sub}</span>
          </Link>
        ))}
      </div>

      {/* Bottom bar — shown only when saved summary exists */}
      {savedSummary && (
        <div className="fixed bottom-0 left-0 right-0 flex justify-center px-4 py-4 bg-gray-950/95 backdrop-blur-sm border-t border-gray-800">
          <div className="flex gap-2 w-full max-w-xs">
            <button
              onClick={() => { primeAudio(); router.push(talkHref); }}
              className="flex-1 py-2.5 rounded-xl border border-gray-700 text-gray-300 text-sm hover:border-indigo-500 hover:text-indigo-300 transition-colors"
            >
              대화하기
            </button>
            <button
              onClick={() => setReviewOpen(true)}
              className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition-colors"
            >
              📚 복습하기
            </button>
          </div>
        </div>
      )}

      {/* Review modal */}
      {reviewOpen && savedSummary && (
        <ReviewModal
          data={savedSummary}
          onClose={() => setReviewOpen(false)}
        />
      )}
    </main>
  );
}

function ReviewModal({
  data,
  onClose,
}: {
  data: SummaryData;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 flex-shrink-0">
          <span className="font-bold text-base">📚 지난 학습 정리</span>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white w-7 h-7 flex items-center justify-center transition-colors"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="space-y-6">
            {/* Words */}
            {data.words?.length > 0 && (
              <section>
                <h3 className="text-xs font-semibold text-indigo-400 uppercase tracking-widest mb-3">
                  📝 핵심 단어 {data.words.length}개
                </h3>
                <div className="space-y-1.5">
                  {data.words.map((w, i) => (
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
            )}

            {/* Expressions */}
            {data.expressions?.length > 0 && (
              <section>
                <h3 className="text-xs font-semibold text-emerald-400 uppercase tracking-widest mb-3">
                  💬 핵심 표현 {data.expressions.length}개
                </h3>
                <div className="space-y-1.5">
                  {data.expressions.map((e, i) => (
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
            )}
          </div>
        </div>

        <div className="px-5 py-4 border-t border-gray-700 flex-shrink-0">
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition-colors"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
