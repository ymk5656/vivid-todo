'use client';

import { useState, useEffect } from 'react';
import { Music2, BookOpen, Loader2, AlertCircle, ListMusic, TriangleAlert } from 'lucide-react';
import type { AnalysisResult } from '@/app/api/analyze/route';

interface AnalysisPanelProps {
  xmlUrl: string;
  title: string;
  composer?: string;
}

const DIFFICULTY_COLOR: Record<string, string> = {
  '초급': 'text-green-600 bg-green-50',
  '중급': 'text-yellow-600 bg-yellow-50',
  '고급': 'text-red-600 bg-red-50',
};

export default function AnalysisPanel({ xmlUrl, title, composer }: AnalysisPanelProps) {
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setAnalysis(null);

    fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ xmlUrl, title, composer }),
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setAnalysis(data as AnalysisResult);
      })
      .catch((e) => {
        if (e.name !== 'AbortError') setError(e.message);
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [xmlUrl, title, composer]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <p className="text-xs">AI가 악보를 분석 중입니다…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-start gap-2 text-xs text-destructive rounded-lg bg-destructive/10 p-3">
        <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
        <p className="leading-relaxed">{error}</p>
      </div>
    );
  }

  if (!analysis) return null;

  const diffColor = DIFFICULTY_COLOR[analysis.difficulty] ?? 'text-muted-foreground bg-muted';

  return (
    <div className="space-y-4">
      {/* 기본 정보 그리드 */}
      <div className="grid grid-cols-2 gap-2">
        <MetaCard label="조성" value={analysis.key} />
        <MetaCard label="박자" value={analysis.timeSignature} />
        <MetaCard label="분위기" value={analysis.mood} span />
        <div className="rounded-lg bg-muted/50 p-2 col-span-2 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">난이도</span>
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${diffColor}`}>
            {analysis.difficulty}
          </span>
        </div>
      </div>

      {/* 요약 */}
      <div>
        <SectionHeader icon={<Music2 className="h-3 w-3 text-primary" />} label="요약" />
        <p className="text-xs text-muted-foreground leading-relaxed mt-1">{analysis.summary}</p>
      </div>

      {/* 코드 진행 */}
      {analysis.chordProgression && analysis.chordProgression.length > 0 && (
        <div>
          <SectionHeader icon={<ListMusic className="h-3 w-3 text-primary" />} label="코드 진행" />
          <div className="mt-1 flex flex-wrap gap-1">
            {analysis.chordProgression.map((chord, i) => (
              <span
                key={i}
                className="text-xs font-mono bg-primary/10 text-primary px-1.5 py-0.5 rounded"
              >
                {chord}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 위험 구간 */}
      {analysis.dangerZones && analysis.dangerZones.length > 0 && (
        <div>
          <SectionHeader icon={<TriangleAlert className="h-3 w-3 text-amber-500" />} label="주의 구간" />
          <ul className="mt-1 space-y-1.5">
            {analysis.dangerZones.map((zone, i) => (
              <li key={i} className="rounded bg-amber-50 border border-amber-200 px-2 py-1.5">
                <span className="text-xs font-semibold text-amber-700">
                  마디 {zone.measureStart}
                  {zone.measureEnd !== zone.measureStart ? `–${zone.measureEnd}` : ''}
                </span>
                <p className="text-xs text-amber-600 mt-0.5">{zone.reason}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 학습 포인트 */}
      <div>
        <SectionHeader icon={<BookOpen className="h-3 w-3 text-primary" />} label="학습 포인트" />
        <ul className="mt-1 space-y-1.5">
          {analysis.learningPoints.map((point, i) => (
            <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <span className="text-primary font-bold shrink-0">·</span>
              <span className="leading-relaxed">{point}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function MetaCard({ label, value, span }: { label: string; value: string; span?: boolean }) {
  return (
    <div className={`rounded-lg bg-muted/50 p-2 ${span ? 'col-span-2' : ''}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium text-xs mt-0.5 truncate" title={value}>{value}</p>
    </div>
  );
}

function SectionHeader({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-1">
      {icon}
      <span className="text-xs font-semibold">{label}</span>
    </div>
  );
}
