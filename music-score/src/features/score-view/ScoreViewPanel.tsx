'use client';

import dynamic from 'next/dynamic';
import { useEffect } from 'react';
import { usePlayerStore } from '@/store/playerStore';
import PartMixer from '../music-player/PartMixer';

const ScoreRenderer = dynamic(() => import('./ScoreRenderer'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full text-muted-foreground">
      악보 로딩 중...
    </div>
  ),
});

interface ScoreViewPanelProps {
  xmlUrl: string;
  title?: string;
}

export default function ScoreViewPanel({ xmlUrl, title }: ScoreViewPanelProps) {
  const currentMeasure = usePlayerStore((s) => s.currentMeasure);
  const playbackState = usePlayerStore((s) => s.playbackState);
  const setXmlUrl = usePlayerStore((s) => s.setXmlUrl);
  const setPlaybackState = usePlayerStore((s) => s.setPlaybackState);

  useEffect(() => {
    setPlaybackState('stopped');
    setXmlUrl(xmlUrl);
    return () => setXmlUrl(null);
  }, [xmlUrl, setXmlUrl, setPlaybackState]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden h-full">
      <div className="flex-1 overflow-hidden min-h-0">
        <ScoreRenderer xmlUrl={xmlUrl} currentMeasure={currentMeasure} title={title} />
      </div>
      {/* 재생 중에는 악보에 집중할 수 있도록 믹서(Mute/Solo)를 숨긴다 */}
      {playbackState !== 'playing' && <PartMixer />}
    </div>
  );
}
