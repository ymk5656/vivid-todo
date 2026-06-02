import Link from 'next/link';
import { Music, FileMusic, Sparkles, Settings, ScanLine } from 'lucide-react';
import { getAllScores } from '@/lib/scoreRepository';
import { ScoreDocument } from '@/types/music';

export const dynamic = 'force-dynamic';

const LOCAL_FALLBACK: ScoreDocument[] = [
  { id: 'twinkle', title: '반짝반짝 작은 별', composer: '전통 동요', musicXmlUrl: '/samples/twinkle.xml', syncPoints: [], createdAt: '' },
  { id: 'ode-to-joy', title: '기쁨의 송가', composer: 'Beethoven', musicXmlUrl: '/samples/ode-to-joy.xml', syncPoints: [], createdAt: '' },
  { id: 'fur-elise', title: '엘리제를 위하여', composer: 'Beethoven', musicXmlUrl: '/samples/fur-elise.xml', syncPoints: [], createdAt: '' },
];

export default async function Home() {
  let scores: ScoreDocument[] = [];
  let fromDb = false;
  try {
    scores = await getAllScores();
    fromDb = true;
  } catch {
    // Supabase not configured — use local samples
  }

  const displayScores = scores.length > 0 ? scores : LOCAL_FALLBACK;

  return (
    <div className="h-full overflow-y-auto">
    <div className="flex flex-col items-center justify-center min-h-full gap-8 p-8">
      <div className="text-center">
        <div className="flex items-center justify-center gap-2 mb-2">
          <Music className="h-8 w-8 text-primary" />
          <h1 className="text-3xl font-bold">Music Platform</h1>
        </div>
        <p className="text-muted-foreground">AI 기반 악보 렌더링 &amp; 음악 학습 플랫폼</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full max-w-2xl">
        {displayScores.map((score) => (
          <Link
            key={score.id}
            href={`/score/${score.id}`}
            className="flex flex-col gap-2 p-5 rounded-xl border bg-card hover:bg-accent transition-colors"
          >
            <FileMusic className="h-6 w-6 text-primary" />
            <div>
              <p className="font-semibold text-sm">{score.title}</p>
              <p className="text-xs text-muted-foreground">{score.composer}</p>
            </div>
          </Link>
        ))}
      </div>

      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <Link href="/omr" className="flex items-center gap-1 hover:text-foreground transition-colors">
          <ScanLine className="h-3 w-3" />
          <span>악보 인식</span>
        </Link>
        <Link href="/admin" className="flex items-center gap-1 hover:text-foreground transition-colors">
          <Settings className="h-3 w-3" />
          <span>악보 관리</span>
        </Link>
        <div className="flex items-center gap-1">
          <Sparkles className="h-3 w-3" />
          <span>{fromDb ? 'Supabase 연결됨' : '로컬 샘플 모드'}</span>
        </div>
      </div>
    </div>
    </div>
  );
}
