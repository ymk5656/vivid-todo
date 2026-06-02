'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { useDropzone } from 'react-dropzone';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { getSupabase } from '@/lib/supabase';
import { Server, Database } from 'lucide-react';

const FIFTHS_LABELS: [number, string][] = [
  [-5, 'Db장조 (-5♭)'],
  [-4, 'Ab장조 (-4♭)'],
  [-3, 'Eb장조 (-3♭)'],
  [-2, 'Bb장조 (-2♭)'],
  [-1, 'F장조 (-1♭)'],
  [0, 'C장조 (♮)'],
  [1, 'G장조 (+1#)'],
  [2, 'D장조 (+2#)'],
  [3, 'A장조 (+3#)'],
  [4, 'E장조 (+4#)'],
];

type Status = 'idle' | 'converting' | 'uploading' | 'done' | 'error';

// Vercel serverless functions reject request bodies larger than 4.5MB with a 413
// AT THE EDGE — before our /api/omr route (and its Groq fallback) ever runs. So
// every upload must stay under that wall. But OMR accuracy scales with resolution
// (Audiveris wants ~300 DPI; the old 1700px ≈ 150 DPI starved it), so we want the
// HIGHEST-quality image that still fits, not a fixed small one.
const UPLOAD_BUDGET = 4.3 * 1024 * 1024; // headroom under Vercel's 4.5MB body limit
const TARGET_WIDTH = 2480;               // ~300 DPI for an A4/Letter-width page

function blobOf(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Canvas blob 변환 실패'))), type, quality));
}

function extForType(type: string): string {
  return type === 'image/png' ? 'png' : 'jpg';
}

// Encode a canvas to the largest-quality image that fits the byte budget:
//   1. lossless PNG at full resolution (ideal for OMR line art) if it fits,
//   2. else descending-quality JPEG at full resolution (keeps every pixel),
//   3. else shrink resolution ~18% and retry from the top.
// This fills the upload budget instead of pre-shrinking to a conservative size.
async function encodeToFit(source: HTMLCanvasElement, budget: number): Promise<Blob> {
  let canvas = source;
  for (let attempt = 0; attempt < 6; attempt++) {
    const png = await blobOf(canvas, 'image/png');
    if (png.size <= budget) return png;
    for (const q of [0.95, 0.9, 0.85, 0.8]) {
      const jpg = await blobOf(canvas, 'image/jpeg', q);
      if (jpg.size <= budget) return jpg;
    }
    if (canvas.width <= 1200) return blobOf(canvas, 'image/jpeg', 0.8); // floor: accept smallest
    const shrunk = document.createElement('canvas');
    shrunk.width = Math.round(canvas.width * 0.82);
    shrunk.height = Math.round(canvas.height * 0.82);
    shrunk.getContext('2d')!.drawImage(canvas, 0, 0, shrunk.width, shrunk.height);
    canvas = shrunk;
  }
  return blobOf(canvas, 'image/jpeg', 0.8);
}

async function pdfToPageBlobs(
  file: File,
  onPageProgress: (current: number, total: number) => void,
): Promise<Blob[]> {
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const numPages = pdf.numPages;
  const blobs: Blob[] = [];

  // PDFs are vector — render at high DPI for free (no source-quality loss), then
  // encodeToFit packs the largest image that clears Vercel's 4.5MB wall.
  for (let i = 1; i <= numPages; i++) {
    onPageProgress(i, numPages);
    const page = await pdf.getPage(i);
    const baseWidth = page.getViewport({ scale: 1 }).width;
    // Render to ~300 DPI; allow up to 6x upscale for tiny pages, never below 1x.
    const scale = Math.min(6, Math.max(1, TARGET_WIDTH / baseWidth));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise;
    blobs.push(await encodeToFit(canvas, UPLOAD_BUDGET));
  }

  return blobs;
}

// Direct image uploads (not PDFs) skip the per-page rendering above and can exceed
// Vercel's 4.5MB serverless body limit — a high-res scan or phone photo is easily
// 7–8MB → HTTP 413 at the edge, before the route (or its Groq fallback) runs.
// An original already under the budget is passed through UNTOUCHED (no re-encode,
// so we never throw away its native quality); only oversized images are re-encoded
// to the largest size that fits, preferring resolution over a smaller file.
async function prepareImageForUpload(file: File): Promise<File> {
  if (file.size <= UPLOAD_BUDGET) return file;

  const bitmap = await createImageBitmap(file);
  // Bound peak canvas memory for huge photos while staying well above target DPI;
  // encodeToFit then trades quality/resolution down only as far as the budget needs.
  const startWidth = Math.min(bitmap.width, 3500);
  const scale = startWidth / bitmap.width;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const blob = await encodeToFit(canvas, UPLOAD_BUDGET);
  const baseName = file.name.replace(/\.[^.]+$/, '');
  return new File([blob], `${baseName}.${extForType(blob.type)}`, { type: blob.type });
}

function mergeXmls(xmls: string[]): string {
  if (xmls.length === 0) return '';
  if (xmls.length === 1) return xmls[0];

  const parser = new DOMParser();
  const baseDom = parser.parseFromString(xmls[0], 'text/xml');

  for (let p = 1; p < xmls.length; p++) {
    const pageDom = parser.parseFromString(xmls[p], 'text/xml');
    const baseParts = Array.from(baseDom.querySelectorAll('score-partwise > part'));

    let maxMeasureNum = 0;
    for (const part of baseParts) {
      for (const m of part.querySelectorAll('measure')) {
        const num = parseInt(m.getAttribute('number') || '0', 10);
        if (num > maxMeasureNum) maxMeasureNum = num;
      }
    }

    const pageParts = Array.from(pageDom.querySelectorAll('score-partwise > part'));
    for (const pagePart of pageParts) {
      const partId = pagePart.getAttribute('id') || 'P1';
      let basePart = baseDom.querySelector(`part[id="${partId}"]`);
      if (!basePart && baseParts.length > 0) basePart = baseParts[0];
      if (!basePart) continue;

      Array.from(pagePart.querySelectorAll('measure')).forEach((measure) => {
        const num = parseInt(measure.getAttribute('number') || '1', 10);
        const clone = baseDom.importNode(measure, true);
        clone.setAttribute('number', String(num + maxMeasureNum));
        basePart!.appendChild(clone);
      });
    }
  }

  return new XMLSerializer().serializeToString(baseDom);
}

export default function OmrPage() {
  const [status, setStatus] = useState<Status>('idle');
  const [progress, setProgress] = useState(0);
  const [pageInfo, setPageInfo] = useState('');
  const [resultXml, setResultXml] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [keyOverride, setKeyOverride] = useState<number | null>(null);
  const [railwayStatus, setRailwayStatus] = useState<'checking' | 'connected' | 'error'>('checking');
  const [supabaseStatus, setSupabaseStatus] = useState<'checking' | 'connected' | 'error'>('checking');
  const [omrEngine, setOmrEngine] = useState<'Audiveris' | 'Groq' | null>(null);

  useEffect(() => {
    // Check Railway OMR status
    const directUrl = process.env.NEXT_PUBLIC_OMR_API_URL;
    if (!directUrl) {
      setRailwayStatus('error');
    } else {
      // Health check only drives the status badge. It must NOT disable the direct
      // upload path: /health can fail transiently (cold start, CORS preflight) while
      // the actual POST still succeeds. Let each upload attempt decide for itself.
      fetch(`${directUrl.replace(/\/$/, '')}/health`)
        .then((res) => {
          setRailwayStatus(res.ok ? 'connected' : 'error');
        })
        .catch(() => {
          setRailwayStatus('error');
        });
    }

    // Check Supabase status
    async function checkSupabase() {
      try {
        const supabase = getSupabase();
        const { error } = await supabase.from('scores').select('id', { count: 'exact', head: true }).limit(1);
        if (error && !error.message) {
          setSupabaseStatus('error');
        } else {
          setSupabaseStatus('connected');
        }
      } catch {
        setSupabaseStatus('error');
      }
    }
    checkSupabase();
  }, []);

  const detectedFifths = useMemo(() => {
    if (!resultXml) return null;
    const m = resultXml.match(/<fifths>(-?\d+)<\/fifths>/);
    return m ? parseInt(m[1], 10) : null;
  }, [resultXml]);

  const effectiveXml = useMemo(() => {
    if (!resultXml) return null;
    if (keyOverride === null) return resultXml;
    return resultXml.replace(/<fifths>-?\d+<\/fifths>/g, `<fifths>${keyOverride}</fifths>`);
  }, [resultXml, keyOverride]);

  // Update localStorage when user changes the key override
  useEffect(() => {
    if (keyOverride === null || !effectiveXml || !fileName) return;
    try {
      localStorage.setItem('omr_pending_xml', JSON.stringify({
        xml: effectiveXml,
        filename: fileName.replace(/\.[^.]+$/, '.xml'),
      }));
    } catch { /* ignore quota errors */ }
  }, [keyOverride, effectiveXml, fileName]);

function hasNotes(xml: string): boolean {
  return /<note[\s>]/.test(xml);
}

let globalRailwayFailed = false;

async function uploadToOmr(file: File): Promise<{ xml: string; engine: 'Audiveris' | 'Groq' }> {
  const directUrl = process.env.NEXT_PUBLIC_OMR_API_URL;
  if (directUrl && !globalRailwayFailed) {
    try {
      console.log('Trying direct OMR upload to Railway:', directUrl);
      const form = new FormData();
      form.append('file', file);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120000); // 120s: the server may try grayscale + binarized passes across orientations
      
      const res = await fetch(directUrl, { 
        method: 'POST', 
        body: form,
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      
      if (res.ok) {
        const xml = await res.text();
        if (hasNotes(xml)) {
          console.log('Direct OMR succeeded!');
          return { xml, engine: 'Audiveris' };
        }
        console.warn('Direct OMR returned empty XML (no notes), trying fallback...');
      } else {
        const errText = await res.text().catch(() => '');
        // Log the full server detail (Audiveris reports per-orientation/mode failure
        // reasons) — truncating to 100 chars hides why a real photo failed.
        console.warn(`Direct OMR failed with status ${res.status}: ${errText.slice(0, 1500)}. trying fallback...`);
      }
    } catch (e) {
      console.warn('Direct OMR failed with error, trying fallback:', e);
      // A timeout (AbortError) just means this one score was slow — don't disable
      // the direct path for the rest of the session. Only a genuine connectivity/
      // CORS error (Railway truly unreachable) is worth caching to avoid repeated
      // 90s hangs.
      if (e instanceof Error && e.name !== 'AbortError') {
        globalRailwayFailed = true;
      }
    }
  }

  // Serverless fallback. When the direct browser→Railway path didn't return notes,
  // still let the server route try Railway server-side (works for files under Vercel's
  // 4.5MB limit, and isn't subject to browser CORS). The server only runs Audiveris —
  // the Groq fallback is disabled unless ?groq=1 is passed, which we never do, so a
  // failure here surfaces an honest "couldn't recognize" error rather than hallucinated
  // notes.
  console.log('Falling back to serverless OMR API...');
  const form = new FormData();
  form.append('file', file, file.name);
  const res = await fetch('/api/omr', { method: 'POST', body: form });
  if (!res.ok) {
    const j = await res.json().catch(() => null);
    throw new Error(j?.error ?? `HTTP ${res.status}`);
  }
  const xml = await res.text();
  if (!hasNotes(xml)) {
    throw new Error('악보를 인식하지 못했습니다. 더 선명한 이미지를 사용해 주세요.');
  }
  const engine = res.headers.get('X-OMR-Engine') === 'Audiveris' ? 'Audiveris' : 'Groq';
  return { xml, engine };
}

  const processFile = useCallback(async (file: File) => {
    setStatus('uploading');
    setProgress(10);
    setResultXml(null);
    setErrorMsg(null);
    setFileName(file.name);
    setPageInfo('');
    setKeyOverride(null);
    setOmrEngine(null);

    if (file.type === 'application/pdf') {
      setStatus('converting');
      setProgress(20);
      try {
        const pageBlobs = await pdfToPageBlobs(file, (cur, total) => {
          setPageInfo(`(${cur}/${total}페이지)`);
          setProgress(20 + Math.round((cur / total) * 20));
        });

        setStatus('uploading');
        const xmls: string[] = [];
        let lastEngine: 'Audiveris' | 'Groq' = 'Audiveris';
        for (let i = 0; i < pageBlobs.length; i++) {
          setPageInfo(`(${i + 1}/${pageBlobs.length}페이지 인식)`);
          setProgress(40 + Math.round((i / pageBlobs.length) * 50));
          const pageBlob = pageBlobs[i];
          const ext = extForType(pageBlob.type);
          const pageFile = new File([pageBlob], `page_${i + 1}.${ext}`, { type: pageBlob.type });
          const result = await uploadToOmr(pageFile);
          xmls.push(result.xml);
          lastEngine = result.engine;
        }

        const xml = mergeXmls(xmls);
        setProgress(100);
        setResultXml(xml);
        setOmrEngine(lastEngine);
        setStatus('done');
        setPageInfo('');
        try {
          localStorage.setItem('omr_pending_xml', JSON.stringify({
            xml,
            filename: file.name.replace(/\.[^.]+$/, '.xml'),
          }));
        } catch { /* ignore quota errors */ }
        return;
      } catch (e) {
        setErrorMsg(`PDF 처리 실패: ${e instanceof Error ? e.message : String(e)}`);
        setStatus('error');
        return;
      }
    }

    // Image file — single request
    setProgress(40);
    const timer = setInterval(() => {
      setProgress((p) => Math.min(p + 10, 85));
    }, 600);

    try {
      const uploadFile = await prepareImageForUpload(file);
      const result = await uploadToOmr(uploadFile);
      clearInterval(timer);
      setProgress(100);
      setResultXml(result.xml);
      setOmrEngine(result.engine);
      setStatus('done');
      try {
        localStorage.setItem('omr_pending_xml', JSON.stringify({
          xml: result.xml,
          filename: file.name.replace(/\.[^.]+$/, '.xml'),
        }));
      } catch { /* ignore quota errors */ }
    } catch (e) {
      clearInterval(timer);
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { 'image/*': [], 'application/pdf': [] },
    multiple: false,
    onDrop: (accepted) => {
      if (accepted[0]) processFile(accepted[0]);
    },
  });

  const statusLabel =
    status === 'converting' ? `PDF → 이미지 변환 중... ${pageInfo}` :
    status === 'uploading' && pageInfo ? `악보 인식 중... ${pageInfo}` :
    '악보 인식 중...';

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-5">
      <h1 className="text-xl font-bold">악보 인식</h1>
      <p className="text-muted-foreground text-sm">
        악보 이미지(PNG/JPG) 또는 PDF를 업로드하면 MusicXML로 변환합니다.
      </p>

      {/* 서버 연결 상태 패널 */}
      <div className="flex gap-4 flex-wrap text-xs font-medium pb-2 border-b">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border bg-muted/30">
          <Server className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-muted-foreground">Railway OMR:</span>
          {railwayStatus === 'checking' && <span className="text-orange-500 animate-pulse">확인 중...</span>}
          {railwayStatus === 'connected' && (
            <span className="flex items-center gap-1 text-green-600 font-bold">
              <span className="h-2 w-2 rounded-full bg-green-500" />
              연결됨 (Online)
            </span>
          )}
          {railwayStatus === 'error' && (
            <span className="flex items-center gap-1 text-red-600 font-bold">
              <span className="h-2 w-2 rounded-full bg-red-500 animate-ping" />
              연결 실패
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border bg-muted/30">
          <Database className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-muted-foreground">Supabase DB:</span>
          {supabaseStatus === 'checking' && <span className="text-orange-500 animate-pulse">확인 중...</span>}
          {supabaseStatus === 'connected' && (
            <span className="flex items-center gap-1 text-green-600 font-bold">
              <span className="h-2 w-2 rounded-full bg-green-500" />
              연결됨
            </span>
          )}
          {supabaseStatus === 'error' && (
            <span className="flex items-center gap-1 text-red-600 font-bold">
              <span className="h-2 w-2 rounded-full bg-red-500 animate-ping" />
              연결 실패
            </span>
          )}
        </div>
      </div>

      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors
          ${isDragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/30 hover:border-primary/50'}`}
      >
        <input {...getInputProps()} />
        <p className="text-muted-foreground text-sm">
          {isDragActive ? '여기에 놓으세요...' : '악보 이미지 또는 PDF를 드래그하거나 클릭하여 선택'}
        </p>
        <p className="text-xs text-muted-foreground mt-1">PNG, JPG, PDF 지원</p>
      </div>

      {(status === 'converting' || status === 'uploading') && (
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span>{statusLabel} {fileName}</span>
            <span>{progress}%</span>
          </div>
          <Progress value={progress} />
        </div>
      )}

      {status === 'error' && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-4 text-destructive text-sm">
          {errorMsg}
        </div>
      )}

      {status === 'done' && effectiveXml && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-green-600 font-bold text-sm">인식 완료!</span>
            {omrEngine === 'Audiveris' && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/50">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-600 dark:bg-emerald-400" />
                Audiveris 엔진 적용
              </span>
            )}
            <Button
              size="sm"
              onClick={() => {
                const blob = new Blob([effectiveXml], { type: 'text/xml' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = fileName?.replace(/\.[^.]+$/, '.xml') ?? 'score.xml';
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              MusicXML 다운로드
            </Button>
            <Link href="/admin">
              <Button size="sm" variant="outline">악보 관리로 이동</Button>
            </Link>
          </div>

          {detectedFifths !== null && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">조성 보정:</span>
              <select
                value={keyOverride ?? detectedFifths}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  setKeyOverride(v === detectedFifths ? null : v);
                }}
                className="border rounded px-2 py-1 text-sm bg-background"
              >
                {FIFTHS_LABELS.map(([f, label]) => (
                  <option key={f} value={f}>
                    {label}{f === detectedFifths ? ' (인식됨)' : ''}
                  </option>
                ))}
              </select>
              {keyOverride !== null && (
                <span className="text-xs text-orange-500">수정됨</span>
              )}
            </div>
          )}

          <pre className="text-xs bg-muted rounded p-3 overflow-auto max-h-64 whitespace-pre-wrap">
            {effectiveXml.slice(0, 2000)}{effectiveXml.length > 2000 ? '\n...(생략)' : ''}
          </pre>
        </div>
      )}
    </div>
  );
}
