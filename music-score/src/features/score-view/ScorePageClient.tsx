'use client';

import { useState } from 'react';
import { Sparkles, ChevronRight, ChevronLeft } from 'lucide-react';
import ScoreViewPanel from '@/features/score-view/ScoreViewPanel';
import AnalysisPanel from '@/features/analysis/AnalysisPanel';
import YouTubePanelClient from '@/features/youtube-sync/YouTubePanelClient';
import { SyncPoint } from '@/types/music';

interface Props {
  xmlUrl: string;
  title: string;
  composer?: string;
  youtubeUrl?: string;
  syncPoints: SyncPoint[];
}

export default function ScorePageClient({ xmlUrl, title, composer, youtubeUrl, syncPoints }: Props) {
  const [aiCollapsed, setAiCollapsed] = useState(true);

  return (
    <div className="flex flex-col lg:flex-row h-full gap-4 p-4 overflow-y-auto lg:overflow-hidden">
      <main className="flex-1 min-w-0 flex flex-col min-h-[60vh] lg:min-h-0">
        <ScoreViewPanel xmlUrl={xmlUrl} title={title} />
      </main>

      <div
        className={`shrink-0 rounded-lg border bg-muted/30 p-4 overflow-y-auto transition-[width] duration-300 w-full ${
          aiCollapsed ? 'lg:w-96' : 'lg:w-72'
        }`}
      >
        <YouTubePanelClient youtubeUrl={youtubeUrl} syncPoints={syncPoints} />
      </div>

      <aside
        className={`shrink-0 rounded-lg border bg-muted/30 overflow-y-auto transition-[width] duration-300 w-full ${
          aiCollapsed ? 'p-2 lg:w-10' : 'p-4 lg:w-64'
        }`}
      >
        {aiCollapsed ? (
          <button
            onClick={() => setAiCollapsed(false)}
            className="w-full flex flex-row lg:flex-col items-center justify-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
            title="AI 음악 분석 열기"
          >
            <ChevronLeft className="h-4 w-4 hidden lg:block" />
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="text-xs font-semibold lg:[writing-mode:vertical-rl] leading-none">AI 음악 분석</span>
            <ChevronRight className="h-4 w-4 lg:hidden" />
          </button>
        ) : (
          <>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold">AI 음악 분석</h2>
              </div>
              <button
                onClick={() => setAiCollapsed(true)}
                className="text-muted-foreground hover:text-foreground transition-colors"
                title="AI 음악 분석 접기"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <AnalysisPanel xmlUrl={xmlUrl} title={title} composer={composer} />
          </>
        )}
      </aside>
    </div>
  );
}
