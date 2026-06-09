'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { Upload, Trash2, Music, ArrowLeft, CheckCircle, AlertCircle, Plus, X, Video, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { uploadScore, getAllScores, deleteScore, updateScore } from '@/lib/scoreRepository';
import { ScoreDocument, SyncPoint } from '@/types/music';

type UploadStatus = 'idle' | 'uploading' | 'success' | 'error';

function getFileName(url?: string): string {
  if (!url) return '';
  try {
    const decoded = decodeURIComponent(url);
    const parts = decoded.split('/');
    const last = parts[parts.length - 1];
    const clean = last.split('?')[0];
    return clean;
  } catch {
    return '';
  }
}

export default function AdminPage() {
  const [scores, setScores] = useState<ScoreDocument[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [composer, setComposer] = useState('');
  const [scoreId, setScoreId] = useState('');
  const [status, setStatus] = useState<UploadStatus>('idle');
  const [message, setMessage] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [ytUrls, setYtUrls] = useState<Record<string, string>>({});
  const [syncPointsMap, setSyncPointsMap] = useState<Record<string, SyncPoint[]>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadScores = useCallback(async () => {
    try {
      const data = await getAllScores();
      setScores(data);
      const urls: Record<string, string> = {};
      const sps: Record<string, SyncPoint[]> = {};
      for (const s of data) {
        urls[s.id] = s.youtubeUrl ?? '';
        sps[s.id] = s.syncPoints.length > 0 ? s.syncPoints : [];
      }
      setYtUrls(urls);
      setSyncPointsMap(sps);
    } catch {
      setScores([]);
    }
  }, []);

  useEffect(() => { loadScores(); }, [loadScores]);

  // Auto-scroll expanded score item into view
  useEffect(() => {
    if (expandedId) {
      const timer = setTimeout(() => {
        const el = document.getElementById(`score-item-${expandedId}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [expandedId]);

  // Pre-fill from OMR result if available
  useEffect(() => {
    const pending = localStorage.getItem('omr_pending_xml');
    if (!pending) return;
    try {
      const { xml, filename } = JSON.parse(pending) as { xml: string; filename: string };
      const blob = new Blob([xml], { type: 'text/xml' });
      const f = new File([blob], filename, { type: 'text/xml' });
      setFile(f);
      setScoreId(filename.replace(/\.(xml|musicxml)$/, '').toLowerCase().replace(/\s+/g, '-'));
      localStorage.removeItem('omr_pending_xml');
    } catch { /* ignore parse errors */ }
  }, []);

  const isValidXmlFile = (f: File) => f.name.endsWith('.xml') || f.name.endsWith('.musicxml');

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (!dropped) return;
    if (!isValidXmlFile(dropped)) {
      setMessage('.xml 또는 .musicxml 파일만 업로드할 수 있습니다.');
      setStatus('error');
      return;
    }
    setMessage('');
    setFile(dropped);
    if (!scoreId) setScoreId(dropped.name.replace(/\.(xml|musicxml)$/, '').toLowerCase().replace(/\s+/g, '-'));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    if (!isValidXmlFile(selected)) {
      setMessage('.xml 또는 .musicxml 파일만 업로드할 수 있습니다.');
      setStatus('error');
      if (e.target) e.target.value = '';
      return;
    }
    setMessage('');
    setFile(selected);
    if (!scoreId) setScoreId(selected.name.replace(/\.(xml|musicxml)$/, '').toLowerCase().replace(/\s+/g, '-'));
  };

  const handleUpload = async () => {
    if (!file || !title || !scoreId) {
      setMessage('파일, ID, 제목을 모두 입력하세요.');
      setStatus('error');
      return;
    }
    setStatus('uploading');
    setMessage('');
    try {
      await uploadScore(file, { id: scoreId, title, composer: composer || undefined });
      setStatus('success');
      setMessage(`"${title}" 업로드 완료`);
      setFile(null);
      setTitle('');
      setComposer('');
      setScoreId('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      // Collapse the form after a successful upload so the registered list is in view.
      setUploadOpen(false);
      await loadScores();
    } catch (err) {
      setStatus('error');
      setMessage(err instanceof Error ? err.message : '업로드 실패');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(`"${id}" 악보를 삭제하시겠습니까?`)) return;
    try {
      await deleteScore(id);
      await loadScores();
    } catch (err) {
      alert(err instanceof Error ? err.message : '삭제 실패');
    }
  };

  const handleSaveSync = async (id: string) => {
    setSavingId(id);
    try {
      await updateScore(id, {
        youtubeUrl: ytUrls[id] || undefined,
        syncPoints: syncPointsMap[id] ?? [],
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : '저장 실패');
    } finally {
      setSavingId(null);
    }
  };

  const addSyncPoint = (id: string) => {
    setSyncPointsMap((prev) => ({
      ...prev,
      [id]: [...(prev[id] ?? []), { measureNumber: 1, timestamp: 0 }],
    }));
  };

  const removeSyncPoint = (id: string, idx: number) => {
    setSyncPointsMap((prev) => ({
      ...prev,
      [id]: (prev[id] ?? []).filter((_, i) => i !== idx),
    }));
  };

  const updateSyncPoint = (id: string, idx: number, field: keyof SyncPoint, value: number) => {
    setSyncPointsMap((prev) => {
      const arr = [...(prev[id] ?? [])];
      arr[idx] = { ...arr[idx], [field]: value };
      return { ...prev, [id]: arr };
    });
  };

  return (
    <div className="h-full overflow-y-auto">
    <div className="max-w-2xl mx-auto p-4 space-y-5">
      <div className="flex items-center gap-3">
        <Link href="/" className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex items-center gap-2">
          <Music className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold">악보 관리</h1>
        </div>
      </div>

      {/* Upload form (collapsible) */}
      <div className="rounded-xl border p-6 space-y-4">
        <button
          type="button"
          onClick={() => setUploadOpen((v) => !v)}
          className="w-full flex items-center justify-between font-semibold"
        >
          <span>MusicXML 업로드</span>
          {uploadOpen ? <ChevronUp className="h-5 w-5 text-muted-foreground" /> : <ChevronDown className="h-5 w-5 text-muted-foreground" />}
        </button>

        {uploadOpen && (<>
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
            dragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/30 hover:border-primary/50'
          }`}
        >
          <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
          {file ? (
            <p className="text-sm font-medium">{file.name}</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              .xml 파일을 드래그하거나 클릭하여 선택
            </p>
          )}
          <input ref={fileInputRef} type="file" accept=".xml,.musicxml" className="hidden" onChange={handleFileChange} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">악보 ID *</label>
            <input
              value={scoreId}
              onChange={(e) => setScoreId(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
              placeholder="twinkle"
              className="w-full px-3 py-2 text-sm rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">제목 *</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="반짝반짝 작은 별"
              className="w-full px-3 py-2 text-sm rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div className="col-span-2 space-y-1">
            <label className="text-xs font-medium text-muted-foreground">작곡가</label>
            <input
              value={composer}
              onChange={(e) => setComposer(e.target.value)}
              placeholder="Beethoven"
              list="composer-options"
              className="w-full px-3 py-2 text-sm rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
            />
            {/* 유명 작곡가 제안 목록 — datalist라 자유 입력은 그대로 가능 */}
            <datalist id="composer-options">
              <option value="Ludwig van Beethoven" />
              <option value="Wolfgang Amadeus Mozart" />
              <option value="Johann Sebastian Bach" />
              <option value="Frédéric Chopin" />
              <option value="Pyotr Ilyich Tchaikovsky" />
              <option value="Franz Schubert" />
              <option value="Johannes Brahms" />
              <option value="Antonio Vivaldi" />
              <option value="George Frideric Handel" />
              <option value="Claude Debussy" />
            </datalist>
          </div>
        </div>

        <Button onClick={handleUpload} disabled={status === 'uploading'} className="w-full">
          {status === 'uploading' ? '업로드 중...' : '업로드'}
        </Button>
        </>)}

        {/* Outside the collapsible body so the success message stays visible after the form folds. */}
        {message && (
          <div className={`flex items-center gap-2 text-sm ${status === 'error' ? 'text-destructive' : 'text-green-600'}`}>
            {status === 'error' ? <AlertCircle className="h-4 w-4" /> : <CheckCircle className="h-4 w-4" />}
            {message}
          </div>
        )}
      </div>

      {/* Score list */}
      <div className="space-y-3">
        <h2 className="font-semibold">등록된 악보 ({scores.length})</h2>
        {scores.length === 0 ? (
          <p className="text-sm text-muted-foreground">등록된 악보가 없습니다.</p>
        ) : (
          <div className="max-h-[600px] overflow-y-auto space-y-2 pr-1">
            {scores.map((score) => (
              <div key={score.id} id={`score-item-${score.id}`} className="rounded-lg border transition-all duration-300">
                <div className="flex items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{score.title}</p>
                    <p className="text-xs text-muted-foreground truncate" title={score.musicXmlUrl ? getFileName(score.musicXmlUrl) : ''}>
                      {score.composer ?? '—'} · {score.id}
                      {score.musicXmlUrl && ` · ${getFileName(score.musicXmlUrl)}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => setExpandedId(expandedId === score.id ? null : score.id)}
                      aria-label="동기화 설정"
                      className={`flex items-center gap-1 px-2 py-2 rounded-md text-xs transition-colors ${
                        expandedId === score.id
                          ? 'bg-primary/10 text-primary font-medium'
                          : 'text-muted-foreground hover:text-primary hover:bg-accent'
                      }`}
                    >
                      <Video className="h-4 w-4" />
                      <span className="hidden sm:inline">동기화</span>
                    </button>
                    <Link
                      href={`/score/${score.id}`}
                      aria-label="악보 열기"
                      className="px-3 py-2 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors font-medium"
                    >
                      열기
                    </Link>
                    <button
                      type="button"
                      onClick={() => handleDelete(score.id)}
                      aria-label="악보 삭제"
                      className="p-2 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                    >
                      <Trash2 className="h-5 w-5" />
                    </button>
                  </div>
                </div>

                {expandedId === score.id && (
                  <div className="border-t px-4 py-3 space-y-3 bg-muted/20">
                    <div className="flex items-center justify-between border-b pb-2">
                      <span className="text-xs font-semibold text-foreground">동기화 설정</span>
                      {score.musicXmlUrl && (
                        <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[200px]" title={getFileName(score.musicXmlUrl)}>
                          파일명: {getFileName(score.musicXmlUrl)}
                        </span>
                      )}
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">YouTube 추천 검색</label>
                      <div className="flex flex-col gap-0.5">
                        <a
                          href={`https://www.youtube.com/results?search_query=${encodeURIComponent(`${score.title} ${score.composer ?? ''} 피아노`.trim())}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-primary hover:underline truncate"
                        >
                          🔍 {score.title} {score.composer ? `${score.composer} ` : ''}피아노
                        </a>
                        <a
                          href={`https://www.youtube.com/results?search_query=${encodeURIComponent(`${score.title} ${score.composer ?? ''}`.trim())}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-primary hover:underline truncate"
                        >
                          🔍 {score.title}{score.composer ? ` ${score.composer}` : ''}
                        </a>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">YouTube URL</label>
                      <input
                        value={ytUrls[score.id] ?? ''}
                        onChange={(e) => setYtUrls((prev) => ({ ...prev, [score.id]: e.target.value }))}
                        placeholder="https://www.youtube.com/watch?v=..."
                        className="w-full px-3 py-2 text-sm rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-medium text-muted-foreground">동기화 포인트</label>
                        <button
                          onClick={() => addSyncPoint(score.id)}
                          className="text-xs text-primary flex items-center gap-1 hover:underline"
                        >
                          <Plus className="h-3 w-3" /> 추가
                        </button>
                      </div>
                      {(syncPointsMap[score.id] ?? []).map((sp, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground w-4">{idx + 1}</span>
                          <div className="flex items-center gap-1 flex-1">
                            <input
                              type="number"
                              min={1}
                              value={sp.measureNumber}
                              onChange={(e) => updateSyncPoint(score.id, idx, 'measureNumber', Number(e.target.value))}
                              className="w-20 px-2 py-1 text-xs rounded border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                              placeholder="마디"
                            />
                            <span className="text-xs text-muted-foreground">마디</span>
                            <input
                              type="number"
                              min={0}
                              step={0.1}
                              value={sp.timestamp}
                              onChange={(e) => updateSyncPoint(score.id, idx, 'timestamp', Number(e.target.value))}
                              className="w-24 px-2 py-1 text-xs rounded border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                              placeholder="초"
                            />
                            <span className="text-xs text-muted-foreground">초</span>
                          </div>
                          <button onClick={() => removeSyncPoint(score.id, idx)} className="text-muted-foreground hover:text-destructive">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>

                    <Button
                      size="sm"
                      onClick={() => handleSaveSync(score.id)}
                      disabled={savingId === score.id}
                      className="w-full"
                    >
                      {savingId === score.id ? '저장 중...' : '저장'}
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
    </div>
  );
}
