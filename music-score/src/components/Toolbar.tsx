'use client';

import Link from 'next/link';
import { Play, Pause, Square, Music, ScanLine, Settings, Repeat, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { usePlayerStore } from '@/store/playerStore';
import { useTonePlayer } from '@/features/music-player/MusicPlayer';

const INSTRUMENTS = [
  { value: 'piano', label: '피아노' },
  { value: 'violin', label: '바이올린' },
  { value: 'flute', label: '플루트' },
  { value: 'guitar', label: '기타' },
  { value: 'trumpet', label: '트럼펫' },
  { value: 'clarinet', label: '클라리넷' },
  { value: 'harmonica', label: '하모니카' },
] as const;

export default function Toolbar() {
  useTonePlayer();

  const {
    playbackState, bpm, instrument, setPlaybackState, setBpm, setInstrument,
    loopEnabled, loopRange, toggleLoopEnabled, clearLoop,
  } = usePlayerStore();

  const handlePlayPause = () => {
    if (playbackState === 'playing') {
      setPlaybackState('paused');
    } else {
      setPlaybackState('playing');
    }
  };

  const handleStop = () => {
    setPlaybackState('stopped');
  };

  return (
    <header className="h-14 border-b bg-background flex items-center px-4 gap-3 sm:gap-4 shrink-0 overflow-x-auto">
      <Link href="/" className="flex items-center gap-2 text-primary font-semibold hover:text-primary/80 transition-colors shrink-0">
        <Music className="h-5 w-5" />
        <span className="hidden sm:inline">Music Platform</span>
      </Link>

      <Link
        href="/omr"
        className="flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/5 px-2.5 py-1 text-sm font-medium text-primary hover:bg-primary/10 transition-colors shrink-0"
      >
        <ScanLine className="h-4 w-4" />
        <span>악보 인식</span>
      </Link>

      <Link
        href="/admin"
        className="flex items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2.5 py-1 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
      >
        <Settings className="h-4 w-4" />
        <span>악보 관리</span>
      </Link>

      <div className="w-px h-6 bg-border shrink-0" />

      {/* 재생 컨트롤 */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={handlePlayPause}
          title={playbackState === 'playing' ? '일시정지' : '재생'}
        >
          {playbackState === 'playing' ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
        </Button>
        <Button variant="ghost" size="icon" onClick={handleStop} title="정지">
          <Square className="h-4 w-4" />
        </Button>
        {/* 반복 재생(Loop) 토글 — 구간이 지정되면 활성화 색상으로 표시 */}
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleLoopEnabled}
          disabled={!loopRange}
          title={
            loopRange
              ? loopEnabled
                ? `반복 재생 켜짐 (${loopRange.start}–${loopRange.end}마디)`
                : '반복 재생 꺼짐'
              : '악보에서 구간을 드래그해 반복 구간을 지정하세요'
          }
          className={loopEnabled && loopRange ? 'text-primary bg-primary/10' : ''}
        >
          <Repeat className="h-4 w-4" />
        </Button>
        {loopRange && (
          <button
            onClick={clearLoop}
            title="반복 구간 해제"
            className="flex items-center gap-1 rounded-md border border-primary/40 bg-primary/5 px-1.5 py-0.5 text-xs font-medium text-primary hover:bg-primary/10 transition-colors whitespace-nowrap"
          >
            <span>{loopRange.start === loopRange.end ? `${loopRange.start}마디` : `${loopRange.start}–${loopRange.end}마디`}</span>
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      <div className="w-px h-6 bg-border" />

      {/* BPM 조절 */}
      <div className="flex items-center gap-3 min-w-[180px]">
        <span className="text-sm text-muted-foreground whitespace-nowrap">BPM</span>
        <Slider
          min={40}
          max={240}
          step={5}
          value={[bpm]}
          onValueChange={([val]) => setBpm(val)}
          className="w-28"
        />
        <span className="text-sm font-mono w-8 text-right">{bpm}</span>
      </div>

      <div className="w-px h-6 bg-border" />

      {/* 악기 선택 */}
      <select
        value={instrument}
        onChange={(e) => setInstrument(e.target.value as typeof instrument)}
        className="text-sm rounded-md border bg-background px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary"
      >
        {INSTRUMENTS.map((ins) => (
          <option key={ins.value} value={ins.value}>{ins.label}</option>
        ))}
      </select>
    </header>
  );
}
