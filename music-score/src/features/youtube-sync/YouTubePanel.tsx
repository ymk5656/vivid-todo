'use client';

import { useEffect, useRef, useState } from 'react';
import { SyncPoint } from '@/types/music';
import { usePlayerStore } from '@/store/playerStore';
import { findMeasureForTime, findBeatForTime, calcBpmFromSyncPoints } from './useSyncEngine';

interface YTPlayer {
  getCurrentTime(): number;
  destroy(): void;
}

interface YTPlayerOptions {
  videoId: string;
  playerVars?: Record<string, number | string>;
  events?: {
    onStateChange?: (event: { data: number }) => void;
  };
}

interface YTNamespace {
  Player: new (el: HTMLElement, opts: YTPlayerOptions) => YTPlayer;
  PlayerState: { PLAYING: number };
}

declare global {
  interface Window {
    YT: YTNamespace;
    onYouTubeIframeAPIReady: () => void;
  }
}

interface Props {
  youtubeUrl?: string;
  syncPoints: SyncPoint[];
}

function extractVideoId(url: string): string | null {
  const m = url.match(/(?:v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

const DEFAULT_SYNC: SyncPoint[] = [{ measureNumber: 1, timestamp: 0 }];
const ONSET_THRESHOLD = 12;
const BPM_ANALYSIS_SECONDS = 12;

export default function YouTubePanel({ youtubeUrl, syncPoints }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelDetectRef = useRef<(() => void) | null>(null);

  const [statusMsg, setStatusMsg] = useState<string>('');
  const [detectedBpm, setDetectedBpm] = useState<number | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [localUrl, setLocalUrl] = useState(youtubeUrl ?? '');
  const [urlDraft, setUrlDraft] = useState('');
  const [isMobile, setIsMobile] = useState(false);

  const { setCurrentMeasure, setCurrentBeat, setBpm, setSyncPoints } = usePlayerStore();

  // Tab-audio capture (getDisplayMedia) is desktop-Chrome-only — on phones it's
  // missing or throws, so auto BPM analysis can't work there. Detect that case and
  // offer a manual "mark start point" button instead.
  useEffect(() => {
    const noTabCapture =
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getDisplayMedia !== 'function';
    setIsMobile(noTabCapture || window.innerWidth < 768);
  }, []);

  // Keep localUrl in sync when the prop changes (e.g., navigating to a different score)
  useEffect(() => {
    setLocalUrl(youtubeUrl ?? '');
  }, [youtubeUrl]);

  const videoId = extractVideoId(localUrl);

  function applyStartPoint(time: number) {
    const currentSps = usePlayerStore.getState().syncPoints;
    const others = currentSps.filter((sp) => sp.measureNumber !== 1);
    setSyncPoints([{ measureNumber: 1, timestamp: time }, ...others]);
  }

  // Mobile manual sync: save the video's current playback position as measure-1's
  // start point so the score follows the video from this moment on.
  function handleMarkStart() {
    const time = playerRef.current?.getCurrentTime() ?? 0;
    applyStartPoint(time);
    setStatusMsg(`시작점 저장: ${time.toFixed(1)}초 — 악보가 영상을 따라갑니다`);
  }

  async function handleAnalyze() {
    if (isAnalyzing) {
      cancelDetectRef.current?.();
      return;
    }

    setIsAnalyzing(true);
    setStatusMsg('탭 공유 허용 → 현재 탭 선택 → 영상 재생...');

    let stream: MediaStream;
    try {
      // selfBrowserSurface/preferCurrentTab: show the current tab in Chrome's picker (Chrome 107+)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      stream = await (navigator.mediaDevices.getDisplayMedia as any)({
        video: true,
        audio: true,
        selfBrowserSurface: 'include',
        preferCurrentTab: true,
      });
    } catch {
      setStatusMsg('공유 취소됨. 탭을 선택하고 다시 시도하세요.');
      setIsAnalyzing(false);
      return;
    }

    const audioTracks = stream.getAudioTracks();
    if (!audioTracks.length) {
      stream.getTracks().forEach((t) => t.stop());
      setStatusMsg('오디오 없음 — 탭 공유 시 "오디오 공유" 체크 필요');
      setIsAnalyzing(false);
      return;
    }

    const audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.15;
    source.connect(analyser);

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    let active = true;

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      active = false;
      stream.getTracks().forEach((t) => t.stop());
      audioCtx.close();
      setIsAnalyzing(false);
    };

    cancelDetectRef.current = () => {
      cleanup();
      setStatusMsg('분석 취소됨');
    };

    // Phase 1: wait for onset (first audio above threshold)
    setStatusMsg('영상을 재생하세요. 첫 음 감지 중...');

    const cancelTimer = setTimeout(() => {
      if (!active) return;
      cleanup();
      setStatusMsg('시간 초과 — 다시 시도하세요.');
    }, 90000);

    // Full-range frequency energy average. Full range is more reliable across all
    // music types; low-freq-only misses piano/strings which lack prominent bass.
    function getEnergy(): number {
      analyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 1; i < dataArray.length; i++) sum += dataArray[i];
      return sum / (dataArray.length - 1);
    }

    function waitForOnset() {
      if (!active) return;
      const avg = getEnergy();

      if (avg > ONSET_THRESHOLD) {
        clearTimeout(cancelTimer);
        const startTime = playerRef.current?.getCurrentTime() ?? 0;
        applyStartPoint(startTime);
        setStatusMsg(`시작점 감지: ${startTime.toFixed(1)}초 — BPM 분석 중...`);

        // Phase 2: adaptive peak detection over BPM_ANALYSIS_SECONDS.
        // Compare each frame against a rolling local mean (last ~43 frames ≈ 700ms).
        // A beat is detected when energy rises above mean*1.15 from a sub-mean state.
        // This works even when the signal never drops to near-zero between beats.
        const peakTimes: number[] = [];
        let lastPeakTime = audioCtx.currentTime;
        const analysisEnd = audioCtx.currentTime + BPM_ANALYSIS_SECONDS;
        const energyHistory: number[] = [avg];
        let prevIsHigh = false;

        function trackBeats() {
          if (!active) return;
          const curEnergy = getEnergy();
          const now = audioCtx.currentTime;

          energyHistory.push(curEnergy);
          if (energyHistory.length > 43) energyHistory.shift();
          const localMean = energyHistory.reduce((a, b) => a + b, 0) / energyHistory.length;

          const isHigh = curEnergy > localMean * 1.15 && curEnergy > ONSET_THRESHOLD;
          if (isHigh && !prevIsHigh && now - lastPeakTime > 0.25) {
            peakTimes.push(now);
            lastPeakTime = now;
          }
          prevIsHigh = isHigh;

          if (now < analysisEnd) {
            requestAnimationFrame(trackBeats);
            return;
          }

          // Calculate BPM from inter-peak intervals
          let bpm: number | null = null;

          if (peakTimes.length >= 2) {
            const intervals: number[] = [];
            for (let i = 1; i < peakTimes.length; i++) {
              intervals.push(peakTimes[i] - peakTimes[i - 1]);
            }
            intervals.sort((a, b) => a - b);
            const medianInterval = intervals[Math.floor(intervals.length / 2)];
            if (medianInterval > 0) {
              bpm = Math.round(60 / medianInterval);
              // Snap to reasonable range
              if (bpm < 40) bpm = null;
              if (bpm && bpm > 240) bpm = null;
            }
          }

          // Also try calcBpmFromSyncPoints if we have enough sync points
          const { parsedMeasures, syncPoints: sp } = usePlayerStore.getState();
          const effSp = sp.length > 0 ? sp : DEFAULT_SYNC;
          if (!bpm && parsedMeasures && parsedMeasures.length > 0 && effSp.length >= 2) {
            bpm = calcBpmFromSyncPoints(effSp, parsedMeasures);
          }

          cleanup();

          if (bpm) {
            setDetectedBpm(bpm);
            setBpm(bpm);
            setStatusMsg(`BPM: ${bpm} | 시작점: ${startTime.toFixed(1)}초`);
          } else {
            setStatusMsg(`시작점: ${startTime.toFixed(1)}초 (BPM 감지 실패)`);
          }
        }

        requestAnimationFrame(trackBeats);
        return;
      }

      requestAnimationFrame(waitForOnset);
    }

    requestAnimationFrame(waitForOnset);
  }

  useEffect(() => {
    return () => {
      cancelDetectRef.current?.();
    };
  }, []);

  useEffect(() => {
    if (!videoId || !containerRef.current) return;

    function initPlayer() {
      if (!containerRef.current || !videoId) return;
      playerRef.current = new window.YT.Player(containerRef.current, {
        videoId,
        playerVars: { controls: 1, modestbranding: 1 },
        events: {
          onStateChange: (event) => {
            if (event.data === window.YT.PlayerState.PLAYING) {
              intervalRef.current = setInterval(() => {
                const time = playerRef.current?.getCurrentTime() ?? 0;
                const { bpm, parsedMeasures, syncPoints: sp } = usePlayerStore.getState();
                const effSp = sp.length > 0 ? sp : DEFAULT_SYNC;

                if (parsedMeasures && parsedMeasures.length > 0) {
                  const beatInfo = findBeatForTime(effSp, parsedMeasures, time, bpm);
                  if (beatInfo) {
                    setCurrentBeat(beatInfo);
                    setCurrentMeasure(beatInfo.measure);
                    return;
                  }
                }
                const measure = findMeasureForTime(effSp, time);
                setCurrentMeasure(measure);
              }, 100);
            } else {
              if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
              }
              setCurrentBeat(null);
            }
          },
        },
      });
    }

    if (window.YT && window.YT.Player) {
      initPlayer();
    } else {
      window.onYouTubeIframeAPIReady = initPlayer;
      if (!document.getElementById('yt-api-script')) {
        const script = document.createElement('script');
        script.id = 'yt-api-script';
        script.src = 'https://www.youtube.com/iframe_api';
        document.head.appendChild(script);
      }
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      setCurrentBeat(null);
      playerRef.current?.destroy();
    };
  }, [videoId, setCurrentMeasure, setCurrentBeat]);

  function handleLoadUrl() {
    const trimmed = urlDraft.trim();
    if (trimmed) {
      setLocalUrl(trimmed);
      setUrlDraft('');
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-muted-foreground">YouTube 동기화</h3>
        <div className="flex items-center gap-2">
          {detectedBpm && (
            <span className="text-xs font-medium text-orange-500">BPM: {detectedBpm}</span>
          )}
          {isMobile ? (
            <button
              onClick={handleMarkStart}
              disabled={!videoId}
              className="text-xs px-2 py-1 rounded transition-colors whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed bg-primary text-primary-foreground hover:bg-primary/90"
            >
              시작점 표시
            </button>
          ) : (
            <button
              onClick={handleAnalyze}
              disabled={!videoId && !isAnalyzing}
              className={`text-xs px-2 py-1 rounded transition-colors whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed ${
                isAnalyzing
                  ? 'bg-orange-500 text-white hover:bg-orange-600'
                  : 'bg-primary text-primary-foreground hover:bg-primary/90'
              }`}
            >
              {isAnalyzing ? '분석 중단' : '분석 시작'}
            </button>
          )}
        </div>
      </div>

      {!videoId && (
        <div className="flex gap-1">
          <input
            type="text"
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleLoadUrl()}
            placeholder="YouTube URL 붙여넣기"
            className="flex-1 min-w-0 text-xs px-2 py-1 rounded border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            onClick={handleLoadUrl}
            className="text-xs px-2 py-1 rounded bg-secondary text-secondary-foreground hover:bg-secondary/80 whitespace-nowrap"
          >
            로드
          </button>
        </div>
      )}

      {videoId && (
        <button
          onClick={() => { setLocalUrl(''); setUrlDraft(''); setStatusMsg(''); setDetectedBpm(null); }}
          className="text-xs text-muted-foreground hover:text-foreground self-start underline underline-offset-2"
        >
          URL 변경
        </button>
      )}

      {isMobile && videoId && !statusMsg && (
        <p className="text-xs text-muted-foreground">
          영상 재생 중 음악이 시작되는 순간 &ldquo;시작점 표시&rdquo;를 누르세요. 기본값은 영상 시작부터 따라갑니다.
        </p>
      )}

      {statusMsg && (
        <p className="text-xs text-muted-foreground truncate">{statusMsg}</p>
      )}

      {videoId && (
        <div className="w-full aspect-video rounded overflow-hidden">
          <div ref={containerRef} className="w-full h-full" />
        </div>
      )}
    </div>
  );
}
