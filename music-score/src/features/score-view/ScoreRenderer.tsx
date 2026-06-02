'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { Repeat, Check } from 'lucide-react';
import { usePlayerStore } from '@/store/playerStore';

interface RegionRect { left: number; top: number; width: number; height: number; }

interface ScoreRendererProps {
  xmlUrl: string;
  currentMeasure?: number;
  title?: string;
}

export default function ScoreRenderer({ xmlUrl, currentMeasure = 0, title }: ScoreRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const osmdRef = useRef<any>(null);
  const cursorReadyRef = useRef(false);
  const generationRef = useRef(0);
  const lastLineYRef = useRef<number>(-1);
  const [loadError, setLoadError] = useState(false);

  const currentBeat = usePlayerStore((s) => s.currentBeat);
  const parsedMeasures = usePlayerStore((s) => s.parsedMeasures);
  const loopRange = usePlayerStore((s) => s.loopRange);
  const loopEnabled = usePlayerStore((s) => s.loopEnabled);
  const setLoopRange = usePlayerStore((s) => s.setLoopRange);

  // 구간 선택(loop range drag-select) state.
  const [selectMode, setSelectMode] = useState(false);
  const [previewRange, setPreviewRange] = useState<{ start: number; end: number } | null>(null);
  const [regionRects, setRegionRects] = useState<RegionRect[]>([]);
  const [layoutRev, setLayoutRev] = useState(0);
  const dragRef = useRef<{ start: number } | null>(null);

  // Map a screen point to the 1-based measure number under it, using OSMD's
  // graphical measure bounding boxes. OSMD positions are in abstract units;
  // screen px = unit * unitInPixels(10) * zoom.
  const pointToMeasureNumber = useCallback((clientX: number, clientY: number): number | null => {
    const osmd = osmdRef.current;
    const container = containerRef.current;
    if (!osmd?.GraphicSheet || !container) return null;
    const rect = container.getBoundingClientRect();
    const zoom = osmd.zoom || 1;
    const f = 10 * zoom;
    const ux = (clientX - rect.left) / f;
    const uy = (clientY - rect.top) / f;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const list: any[][] = osmd.GraphicSheet.MeasureList || [];
    let best: number | null = null;
    let bestDist = Infinity;
    for (const staffMeasures of list) {
      for (const gm of staffMeasures) {
        if (!gm) continue;
        const bb = gm.PositionAndShape;
        if (!bb) continue;
        const pos = bb.AbsolutePosition;
        const size = bb.Size;
        const x0 = pos.x, x1 = pos.x + size.width;
        const y0 = pos.y, y1 = pos.y + size.height;
        if (ux >= x0 && ux <= x1 && uy >= y0 && uy <= y1) {
          return gm.MeasureNumber;
        }
        const dx = ux < x0 ? x0 - ux : ux > x1 ? ux - x1 : 0;
        const dy = uy < y0 ? y0 - uy : uy > y1 ? uy - y1 : 0;
        const dist = dx * dx + dy * dy;
        if (dist < bestDist) { bestDist = dist; best = gm.MeasureNumber; }
      }
    }
    return best;
  }, []);

  // Recompute the highlight rectangles for the active (preview or committed) range.
  // A range can span multiple systems/lines, so we emit one rect per y-band.
  const recomputeRegions = useCallback((range: { start: number; end: number } | null) => {
    const osmd = osmdRef.current;
    const container = containerRef.current;
    if (!range || !osmd?.GraphicSheet || !container) { setRegionRects([]); return; }
    const zoom = osmd.zoom || 1;
    const f = 10 * zoom;
    const offL = container.offsetLeft;
    const offT = container.offsetTop;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const list: any[][] = osmd.GraphicSheet.MeasureList || [];
    const bands: { yc: number; x0: number; x1: number; y0: number; y1: number }[] = [];
    for (const staffMeasures of list) {
      for (const gm of staffMeasures) {
        if (!gm) continue;
        const num = gm.MeasureNumber;
        if (num < range.start || num > range.end) continue;
        const bb = gm.PositionAndShape;
        if (!bb) continue;
        const pos = bb.AbsolutePosition;
        const size = bb.Size;
        const x0 = pos.x, x1 = pos.x + size.width, y0 = pos.y, y1 = pos.y + size.height;
        const yc = (y0 + y1) / 2;
        const h = y1 - y0;
        const band = bands.find((b) => Math.abs(b.yc - yc) < h);
        if (!band) {
          bands.push({ yc, x0, x1, y0, y1 });
        } else {
          band.x0 = Math.min(band.x0, x0);
          band.x1 = Math.max(band.x1, x1);
          band.y0 = Math.min(band.y0, y0);
          band.y1 = Math.max(band.y1, y1);
          band.yc = (band.y0 + band.y1) / 2;
        }
      }
    }
    setRegionRects(bands.map((b) => ({
      left: offL + b.x0 * f,
      top: offT + b.y0 * f,
      width: (b.x1 - b.x0) * f,
      height: (b.y1 - b.y0) * f,
    })));
  }, []);

  // Pointer drag-select handlers (touch + mouse). Only active in select mode so
  // they never hijack normal vertical scrolling of the score.
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (!selectMode) return;
    const m = pointToMeasureNumber(e.clientX, e.clientY);
    if (m == null) return;
    dragRef.current = { start: m };
    setPreviewRange({ start: m, end: m });
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
    e.preventDefault();
  }, [selectMode, pointToMeasureNumber]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const m = pointToMeasureNumber(e.clientX, e.clientY);
    if (m == null) return;
    const s = dragRef.current.start;
    setPreviewRange({ start: Math.min(s, m), end: Math.max(s, m) });
    e.preventDefault();
  }, [pointToMeasureNumber]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const m = pointToMeasureNumber(e.clientX, e.clientY) ?? dragRef.current.start;
    const s = dragRef.current.start;
    dragRef.current = null;
    setPreviewRange(null);
    setLoopRange({ start: Math.min(s, m), end: Math.max(s, m) }); // commits + enables loop
    setSelectMode(false);
    e.preventDefault();
  }, [pointToMeasureNumber, setLoopRange]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const syncOverlay = useCallback((osmd: any) => {
    try {
      const cursorEl = osmd.cursor?.cursorElement as HTMLElement | null;
      const overlay = overlayRef.current;
      const container = containerRef.current;
      if (!cursorEl || !overlay || !container) return;
      const wrapper = overlay.parentElement;
      if (!wrapper) return;

      const cRect = cursorEl.getBoundingClientRect();
      const wRect = wrapper.getBoundingClientRect();

      let left: number, top: number, width: number, height: number;

      if (cRect.height > 0) {
        left = cRect.left - wRect.left;
        top = cRect.top - wRect.top;
        width = Math.max(cRect.width, 4);
        height = cRect.height;
      } else {
        // OSMD cursor <img> src not yet rendered (canvas data URL loads async).
        // Fall back to OSMD's inline style offsets which are set synchronously.
        const ctnRect = container.getBoundingClientRect();
        const styleLeft = parseFloat(cursorEl.style.left) || 0;
        const styleTop = parseFloat(cursorEl.style.top) || 0;
        const styleWidth = parseFloat(cursorEl.style.width) || 0;
        const styleHeight = parseFloat(cursorEl.style.height) || 0;
        left = ctnRect.left - wRect.left + styleLeft;
        top = ctnRect.top - wRect.top + styleTop;
        width = Math.max(styleWidth, 4);
        height = styleHeight > 0 ? styleHeight : 120;
      }

      overlay.style.left = `${Math.round(left)}px`;
      overlay.style.top = `${Math.round(top - 8)}px`;
      // Note mark: 20% wider (width factor 0.5 → 0.6) and 20% taller than the base.
      overlay.style.width = `${Math.max(Math.round(width * 0.6), 5)}px`;
      overlay.style.height = `${Math.max(Math.round((height + 24) * 1.2), 67)}px`;
      overlay.style.display = 'block';
    } catch { /* ignore */ }
  }, []);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scrollToCursor = useCallback((_osmd: any) => {
    try {
      const overlay = overlayRef.current;
      const scrollParent = containerRef.current?.closest('.overflow-auto') as HTMLElement | null
        ?? containerRef.current?.parentElement;
      if (!overlay || !scrollParent) return;

      const oRect = overlay.getBoundingClientRect();
      const pRect = scrollParent.getBoundingClientRect();
      const viewH = scrollParent.clientHeight;

      const absY = scrollParent.scrollTop + oRect.top - pRect.top;
      if (Math.abs(absY - lastLineYRef.current) < 30) return;
      lastLineYRef.current = absY;

      const relTop = oRect.top - pRect.top;
      const relBottom = oRect.bottom - pRect.top;
      if (relTop < 40 || relBottom > viewH - 40) {
        scrollParent.scrollTo({
          top: Math.max(0, scrollParent.scrollTop + relTop - viewH * 0.3),
          behavior: 'smooth',
        });
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    const gen = ++generationRef.current;
    setLoadError(false);

    async function run() {
      if (!containerRef.current) return;
      const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
      if (gen !== generationRef.current || !containerRef.current) return;
      if (osmdRef.current) {
        try { osmdRef.current.clear(); } catch { /* ignore */ }
        osmdRef.current = null;
      }

      const osmd = new OpenSheetMusicDisplay(containerRef.current, {
        autoResize: true,
        drawingParameters: 'default',
        renderSingleHorizontalStaffline: false,
        drawTitle: false,
        drawComposer: false,
        // Keep OSMD cursor nearly invisible — we use our own overlay for visuals.
        cursorsOptions: [{ type: 0, color: '#000000', alpha: 0.01, follow: false }],
      });
      osmdRef.current = osmd;
      cursorReadyRef.current = false;

      // Show the instrument/voice name only on the first system; OSMD repeats an
      // abbreviation on every subsequent line by default — turn that off.
      osmd.EngravingRules.RenderPartNames = true;
      osmd.EngravingRules.RenderPartAbbreviations = false;

      try {
        await osmd.load(xmlUrl);
        if (gen !== generationRef.current) return;
        // On phones the default scale overflows and the staff is barely legible —
        // halve the score so a full line fits within the narrow viewport.
        if (typeof window !== 'undefined' && window.innerWidth < 768) {
          osmd.zoom = 0.5;
        }
        osmd.render();
        // Graphical layout is now available — let the loop-region effect recompute.
        setLayoutRev((v) => v + 1);
      } catch (err) {
        // Incomplete/malformed MusicXML (e.g. a recognition that produced no notes)
        // makes OSMD throw "createStaves" on undefined. Surface a readable message
        // instead of a blank panel + console crash.
        if (gen === generationRef.current) {
          console.error('OSMD load error:', err);
          setLoadError(true);
        }
        return;
      }

      try {
        osmd.cursor.reset();
        osmd.cursor.show();
        cursorReadyRef.current = true;
        // Delay one frame so the browser renders the cursor <img> src before we read its rect
        requestAnimationFrame(() => {
          if (gen === generationRef.current) syncOverlay(osmd);
        });
      } catch { /* cursor not available */ }
    }

    run();

    return () => {
      generationRef.current++;
      cursorReadyRef.current = false;
      if (overlayRef.current) overlayRef.current.style.display = 'none';
      if (osmdRef.current) {
        try { osmdRef.current.clear(); } catch { /* ignore */ }
        osmdRef.current = null;
      }
    };
  }, [xmlUrl, syncOverlay]);

  // Measure-level cursor (when per-note beat data is not available)
  useEffect(() => {
    if (currentBeat !== null) return;
    if (!osmdRef.current || !cursorReadyRef.current) return;

    try {
      const osmd = osmdRef.current;
      const cursor = osmd.cursor;
      cursor.reset();

      if (currentMeasure <= 1) {
        cursor.show();
        syncOverlay(osmd);
        return;
      }

      const targetIndex = currentMeasure - 1;
      let safety = 0;
      while (
        safety++ < 500 &&
        !cursor.Iterator.EndReached &&
        cursor.Iterator.CurrentMeasureIndex < targetIndex
      ) {
        cursor.next();
      }

      cursor.show();
      syncOverlay(osmd);
      scrollToCursor(osmd);
    } catch { /* cursor iteration failed */ }
  }, [currentMeasure, currentBeat, syncOverlay, scrollToCursor]);

  // Per-note cursor: advance to exact measure + beat position
  useEffect(() => {
    if (currentBeat === null) return;
    if (!osmdRef.current || !cursorReadyRef.current) return;

    try {
      const osmd = osmdRef.current;
      const cursor = osmd.cursor;
      cursor.reset();

      const targetMeasureIndex = currentBeat.measure - 1;
      const targetBeatQN = currentBeat.beat;

      const measureData = parsedMeasures?.find((m) => m.measureNumber === currentBeat.measure);
      const uniqueBeats = measureData
        ? [...new Set(measureData.notes.map((n) => n.startBeat))].sort((a, b) => a - b)
        : null;
      const targetBeatIndex = uniqueBeats
        ? uniqueBeats.findIndex((b) => Math.abs(b - targetBeatQN) < 0.02)
        : -1;

      let safety = 0;
      while (
        safety++ < 2000 &&
        !cursor.Iterator.EndReached &&
        cursor.Iterator.CurrentMeasureIndex < targetMeasureIndex
      ) {
        cursor.next();
      }

      if (cursor.Iterator.CurrentMeasureIndex === targetMeasureIndex && targetBeatIndex > 0) {
        let notedBeatsSeen = 0;
        while (
          safety++ < 4000 &&
          !cursor.Iterator.EndReached &&
          cursor.Iterator.CurrentMeasureIndex === targetMeasureIndex
        ) {
          const gnotes = cursor.GNotesUnderCursor?.() ?? [];
          if (gnotes.length > 0) {
            if (notedBeatsSeen === targetBeatIndex) break;
            notedBeatsSeen++;
          }
          cursor.next();
        }
      }

      cursor.show();
      syncOverlay(osmd);
      scrollToCursor(osmd);
    } catch { /* cursor iteration failed */ }
  }, [currentBeat, parsedMeasures, syncOverlay, scrollToCursor]);

  // Redraw the loop-region highlight whenever the active range or layout changes.
  useEffect(() => {
    recomputeRegions(previewRange ?? loopRange);
  }, [previewRange, loopRange, layoutRev, recomputeRegions]);

  // OSMD reflows on container resize (autoResize); re-measure the region after.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setLayoutRev((v) => v + 1));
    });
    ro.observe(container);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  return (
    <div className="w-full h-full overflow-auto bg-white rounded-lg shadow-inner p-4">
      {title && (
        <h1 className="text-xl font-bold text-center text-gray-800 mb-4">{title}</h1>
      )}
      {loadError && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-4 text-destructive text-sm mb-4">
          악보를 표시할 수 없습니다. 인식 결과가 비어 있거나 손상된 MusicXML입니다.
          더 선명한 악보 이미지로 다시 인식해 주세요.
        </div>
      )}
      {/* 반복 구간 선택 토글 — 켜면 악보 위에서 드래그해 구간을 지정 */}
      <div className="flex items-center justify-end mb-2">
        <button
          onClick={() => { setSelectMode((v) => !v); setPreviewRange(null); dragRef.current = null; }}
          className={
            'flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm font-medium transition-colors ' +
            (selectMode
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-border bg-muted/30 text-muted-foreground hover:text-foreground hover:bg-muted')
          }
          title={selectMode ? '드래그해 반복 구간을 지정하세요' : '반복 구간 선택 모드'}
        >
          {selectMode ? <Check className="h-4 w-4" /> : <Repeat className="h-4 w-4" />}
          <span>{selectMode ? '구간 드래그' : '구간 선택'}</span>
        </button>
      </div>
      {/* position:relative so our absolute overlay aligns with OSMD's cursor coords */}
      <div
        className="relative min-h-[400px]"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={selectMode ? { touchAction: 'none', cursor: 'crosshair' } : undefined}
      >
        <div ref={containerRef} className="w-full" />
        {/* 반복 구간 하이라이트 — 여러 단(line)에 걸치면 단마다 한 블록 */}
        {regionRects.map((r, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: r.left,
              top: r.top,
              width: r.width,
              height: r.height,
              background: previewRange
                ? 'rgba(250, 204, 21, 0.22)'
                : loopEnabled
                  ? 'rgba(250, 204, 21, 0.28)'
                  : 'rgba(148, 163, 184, 0.20)',
              border: previewRange
                ? '1.5px dashed rgba(202, 138, 4, 0.7)'
                : loopEnabled
                  ? '1.5px solid rgba(202, 138, 4, 0.6)'
                  : '1.5px solid rgba(148, 163, 184, 0.5)',
              pointerEvents: 'none',
              zIndex: 998,
              borderRadius: 4,
            }}
          />
        ))}
        <div
          ref={overlayRef}
          style={{
            position: 'absolute',
            background: 'rgba(56, 189, 248, 0.55)',
            pointerEvents: 'none',
            zIndex: 999,
            borderRadius: 2,
            display: 'none',
          }}
        />
      </div>
    </div>
  );
}
