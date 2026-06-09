'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { Repeat, Check, X } from 'lucide-react';
import { usePlayerStore } from '@/store/playerStore';
import { sanitizeForOsmd } from '@/lib/sanitizeForOsmd';

interface RegionRect { left: number; top: number; width: number; height: number; }

// OSMD-unit -> SVG user-coordinate factor (unitInPixels, a stable OSMD constant).
const UNIT = 10;

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
  const clearLoop = usePlayerStore((s) => s.clearLoop);

  // 구간 선택(loop range drag-select) state.
  const [selectMode, setSelectMode] = useState(false);
  const [previewRange, setPreviewRange] = useState<{ start: number; end: number } | null>(null);
  const [regionRects, setRegionRects] = useState<RegionRect[]>([]);
  const [layoutRev, setLayoutRev] = useState(0);
  const dragRef = useRef<{ start: number } | null>(null);

  // OSMD draws into an <svg> whose coordinate system is OSMD-units * unitInPixels(10),
  // then scaled to the screen via a viewBox + zoom. The viewBox scale is NOT simply
  // `10 * zoom` (it varies with container width / device), so we read the live
  // screen transform matrix (getScreenCTM) instead of assuming a constant factor.
  // This mirrors how the cursor overlay measures real DOM rects and works on every
  // device.
  const getSvgCTM = useCallback((): DOMMatrix | null => {
    const svg = containerRef.current?.querySelector('svg') as SVGSVGElement | null;
    if (!svg || typeof svg.getScreenCTM !== 'function') return null;
    return svg.getScreenCTM();
  }, []);

  // Map a screen point to the 1-based measure number under it, using OSMD's
  // graphical measure bounding boxes (in OSMD units). We invert the SVG screen
  // matrix to convert the click into OSMD-unit space.
  const pointToMeasureNumber = useCallback((clientX: number, clientY: number): number | null => {
    const osmd = osmdRef.current;
    const ctm = getSvgCTM();
    if (!osmd?.GraphicSheet || !ctm) return null;
    const inv = ctm.inverse();
    const ux = (inv.a * clientX + inv.c * clientY + inv.e) / UNIT;
    const uy = (inv.b * clientX + inv.d * clientY + inv.f) / UNIT;
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
  }, [getSvgCTM]);

  // Recompute the highlight rectangles for the active (preview or committed) range.
  // A range can span multiple systems/lines, so we emit one rect per y-band.
  const recomputeRegions = useCallback((range: { start: number; end: number } | null) => {
    const osmd = osmdRef.current;
    const container = containerRef.current;
    const wrapper = container?.parentElement;
    const ctm = getSvgCTM();
    if (!range || !osmd?.GraphicSheet || !container || !wrapper || !ctm) { setRegionRects([]); return; }
    const wRect = wrapper.getBoundingClientRect();
    // OSMD-unit point -> wrapper-relative px, via the SVG's live screen matrix.
    const toPx = (ux: number, uy: number) => {
      const x = ux * UNIT, y = uy * UNIT;
      return {
        x: ctm.a * x + ctm.c * y + ctm.e - wRect.left,
        y: ctm.b * x + ctm.d * y + ctm.f - wRect.top,
      };
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const list: any[][] = osmd.GraphicSheet.MeasureList || [];
    // Group measures into y-bands (one rect per system/line) in unit space, which
    // is resolution-independent; convert to px only at the end.
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
    setRegionRects(bands.map((b) => {
      const tl = toPx(b.x0, b.y0);
      const br = toPx(b.x1, b.y1);
      return { left: tl.x, top: tl.y, width: br.x - tl.x, height: br.y - tl.y };
    }));
  }, [getSvgCTM]);

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
        // Fetch the XML ourselves so we can repair render-breaking artifacts
        // (e.g. Audiveris' unmatched <octave-shift>) before handing it to OSMD.
        // The downloaded / stored MusicXML stays the untouched original.
        let source: string = xmlUrl;
        try {
          const res = await fetch(xmlUrl);
          if (res.ok) source = sanitizeForOsmd(await res.text());
        } catch { /* fall back to letting OSMD fetch the URL itself */ }
        if (gen !== generationRef.current) return;
        await osmd.load(source);
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
      {loadError && (() => {
        // OSMD(악보 그리기 엔진)는 보표·음자리표 구조가 완전해야 렌더한다. 인식 결과가
        // 구조적으로 불완전하면 render()가 던져 빈 화면이 된다. 반면 재생 엔진은 같은 XML을
        // 너그럽게 파싱(parseMusicXml)해 음표만 뽑아내므로 "악보는 안 보여도 소리는 난다".
        // 그래서 인식된 음표(parsedMeasures)가 있으면, 레이아웃 대신 음 이름이라도 보여준다.
        const fallbackMeasures = (parsedMeasures ?? []).filter((m) => m.notes.length > 0);
        const hasFallback = fallbackMeasures.length > 0;
        return (
          <div className="mb-4 space-y-3">
            <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-4 text-destructive text-sm">
              {hasFallback ? (
                <>
                  악보 이미지로는 그릴 수 없습니다. 인식 결과의 보표·음자리표 구조가 불완전해
                  정식 악보 레이아웃을 만들 수 없습니다. <strong>음표 자체는 인식되어 아래 목록과
                  같이 재생은 됩니다.</strong> 정확한 악보를 보려면 더 선명하고 정면에서 찍은(또는
                  스캔한) 이미지로 다시 인식해 주세요.
                </>
              ) : (
                <>
                  악보를 표시할 수 없습니다. 인식 결과가 비어 있거나 손상된 MusicXML입니다.
                  더 선명한 악보 이미지로 다시 인식해 주세요.
                </>
              )}
            </div>
            {hasFallback && (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-gray-800">
                <div className="mb-2 text-xs font-semibold text-gray-500">
                  인식된 음표 (재생 가능 · 악보 미리보기 대용)
                </div>
                <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                  {fallbackMeasures.map((m) => (
                    <div key={m.measureNumber} className="flex gap-2 text-sm">
                      <span className="shrink-0 tabular-nums font-medium text-gray-400">
                        마디 {m.measureNumber}
                      </span>
                      <span className="font-mono">
                        {m.notes.map((n) => n.pitch).join(' ')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })()}
      {/* 반복 구간 선택 토글 — 켜면 악보 위에서 드래그해 구간을 지정 */}
      <div className="flex items-center justify-end gap-2 mb-2">
        {/* 지정된 반복 구간이 있으면 해제 버튼을 노출 */}
        {loopRange && (
          <button
            onClick={() => { clearLoop(); setSelectMode(false); setPreviewRange(null); dragRef.current = null; }}
            className="flex items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2.5 py-1 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title={`반복 구간 해제 (${loopRange.start === loopRange.end ? `${loopRange.start}마디` : `${loopRange.start}–${loopRange.end}마디`})`}
          >
            <X className="h-4 w-4" />
            <span>구간 해제</span>
          </button>
        )}
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
