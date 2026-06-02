import ScorePageClient from '@/features/score-view/ScorePageClient';
import { getScoreById } from '@/lib/scoreRepository';

interface ScorePageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ yt?: string }>;
}

const LOCAL_SAMPLES: Record<string, { title: string; composer: string }> = {
  'twinkle':    { title: '반짝반짝 작은 별', composer: '전통 동요' },
  'ode-to-joy': { title: '기쁨의 송가',      composer: 'Beethoven' },
  'fur-elise':  { title: '엘리제를 위하여',  composer: 'Beethoven' },
};

export default async function ScorePage({ params, searchParams }: ScorePageProps) {
  const { id: rawId } = await params;
  const { yt: ytParam } = await searchParams;
  const id = decodeURIComponent(rawId).replace(/\s+/g, '-');

  const sample = LOCAL_SAMPLES[id];
  let xmlUrl = `/samples/${id}.xml`;
  let title = sample?.title ?? id;
  let composer: string | undefined = sample?.composer;
  let youtubeUrl: string | undefined;
  let syncPoints: { measureNumber: number; timestamp: number }[] = [];

  try {
    const score = await getScoreById(id);
    if (score?.musicXmlUrl) xmlUrl = score.musicXmlUrl;
    if (score?.title) title = score.title;
    composer = score?.composer;
    youtubeUrl = score?.youtubeUrl;
    syncPoints = score?.syncPoints ?? [];
  } catch {
    // Supabase not configured — use local sample
  }

  // Allow ?yt= query param to override YouTube URL (useful for testing without Supabase)
  if (ytParam) youtubeUrl = ytParam;

  return (
    <ScorePageClient
      xmlUrl={xmlUrl}
      title={title}
      composer={composer}
      youtubeUrl={youtubeUrl}
      syncPoints={syncPoints}
    />
  );
}
