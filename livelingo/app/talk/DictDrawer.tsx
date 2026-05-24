"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface Meaning {
  definition: string;
  example_foreign: string;
  example_ko: string;
}

interface DictEntry {
  word: string;
  lang: string;
  pos: string;
  translation: string;
  pronunciation?: string;
  meanings: Meaning[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  pendingWord: string;
  searchKey?: number;
  dialect?: string;
  title?: string;
}

export default function DictDrawer({ open, onClose, pendingWord, searchKey = 0, dialect = "es-MX", title }: Props) {
  const [query, setQuery] = useState("");
  const [entry, setEntry] = useState<DictEntry | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const search = useCallback(
    async (q: string) => {
      const trimmed = q.trim();
      if (!trimmed) return;
      setLoading(true);
      setError("");
      setEntry(null);
      try {
        const res = await fetch("/api/dict", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: trimmed, dialect }),
        });
        const data = (await res.json()) as DictEntry & { error?: string };
        if (data.error) { setError(data.error); return; }
        setEntry(data);
        setHistory((prev) =>
          [trimmed, ...prev.filter((h) => h !== trimmed)].slice(0, 8)
        );
      } catch {
        setError("검색 중 오류가 발생했습니다.");
      } finally {
        setLoading(false);
      }
    },
    [dialect]
  );

  // Ref so the effect below can call latest search without it being a dep
  const searchRef = useRef(search);
  searchRef.current = search;

  // Auto-search when a word is clicked from the chat (searchKey increments even for same word)
  useEffect(() => {
    if (pendingWord) {
      setQuery(pendingWord);
      void searchRef.current(pendingWord);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingWord, searchKey]);

  // Focus input when drawer opens with no pending word
  useEffect(() => {
    if (open && !pendingWord) {
      const t = setTimeout(() => inputRef.current?.focus(), 300);
      return () => clearTimeout(t);
    }
  }, [open, pendingWord]);

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 bg-black/50 z-40"
          onClick={onClose}
        />
      )}

      {/* Drawer */}
      <div
        className={`fixed top-0 right-0 h-full w-[88vw] sm:w-80 bg-gray-900 border-l border-gray-700 z-50 flex flex-col transform transition-transform duration-300 ease-in-out ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 flex-shrink-0">
          <span className="font-semibold text-sm tracking-wide">{title ?? "📖 한-스 사전"}</span>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors text-lg leading-none w-7 h-7 flex items-center justify-center"
          >
            ✕
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-3 border-b border-gray-800 flex-shrink-0">
          <form
            onSubmit={(e) => { e.preventDefault(); void search(query); }}
            className="flex gap-2"
          >
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="한국어 또는 외국어..."
              className="flex-1 bg-gray-800 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-indigo-500 placeholder-gray-500"
            />
            <button
              type="submit"
              disabled={loading || !query.trim()}
              className="bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg px-3 py-2 text-sm disabled:opacity-50 transition-colors flex-shrink-0"
            >
              {loading ? "⏳" : "검색"}
            </button>
          </form>

          {history.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2.5">
              {history.map((h) => (
                <button
                  key={h}
                  onClick={() => { setQuery(h); void search(h); }}
                  className="text-xs px-2.5 py-0.5 rounded-full bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white transition-colors"
                >
                  {h}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {loading && (
            <p className="text-center text-gray-500 text-sm animate-pulse py-10">검색 중...</p>
          )}

          {error && !loading && (
            <p className="text-red-400 text-sm py-6 text-center">{error}</p>
          )}

          {entry && !loading && (
            <div className="space-y-4">
              {/* Word + meta */}
              <div>
                <div className="flex items-baseline gap-2 flex-wrap">
                  {(entry.lang === "ja" || entry.lang === "zh") && entry.pronunciation ? (
                    <ruby className="text-2xl font-bold text-white leading-loose">
                      {entry.word}
                      <rt className="text-xs font-normal text-indigo-300 tracking-wider">{entry.pronunciation}</rt>
                    </ruby>
                  ) : (
                    <span className="text-2xl font-bold text-white">{entry.word}</span>
                  )}
                  <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">
                    {entry.lang === "es" ? "스페인어" : entry.lang === "ja" ? "일본어" : entry.lang === "en" ? "영어" : entry.lang === "zh" ? "중국어" : "한국어"}
                  </span>
                  {entry.pos && (
                    <span className="text-xs text-indigo-400">{entry.pos}</span>
                  )}
                </div>
                {/* Show bracket pronunciation for Spanish and English (IPA) entries only */}
                {entry.pronunciation && entry.lang !== "ja" && entry.lang !== "zh" && (
                  <p className="text-gray-400 text-sm mt-1">[{entry.pronunciation}]</p>
                )}
              </div>

              {/* Translation */}
              <div className="bg-indigo-950/70 border border-indigo-800/50 rounded-xl px-4 py-3">
                <p className="text-xs text-indigo-400 mb-1">번역</p>
                <p className="text-white font-medium leading-snug">{entry.translation}</p>
              </div>

              {/* Meanings + examples */}
              {entry.meanings?.map((m, i) => (
                <div key={i} className="bg-gray-800/50 rounded-xl px-4 py-3 space-y-2">
                  {m.definition && (
                    <p className="text-xs text-gray-400">{m.definition}</p>
                  )}
                  <p className="text-sm text-gray-200 italic leading-relaxed">"{m.example_foreign}"</p>
                  <p className="text-xs text-gray-400 leading-relaxed">{m.example_ko}</p>
                </div>
              ))}
            </div>
          )}

          {!entry && !loading && !error && (
            <div className="text-center text-gray-600 text-sm py-14">
              <p className="text-4xl mb-3">🔍</p>
              <p className="text-gray-500">단어를 입력하거나</p>
              <p className="text-gray-500">대화창의 단어를 클릭하세요</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
