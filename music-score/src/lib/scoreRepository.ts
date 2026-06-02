import { getSupabase } from './supabase';
import { ScoreDocument, SyncPoint } from '@/types/music';

interface ScoreRow {
  id: string;
  title: string;
  composer: string | null;
  music_xml_url: string;
  youtube_url?: string | null;
  sync_points?: SyncPoint[] | null;
  created_at: string;
}

function rowToDocument(row: ScoreRow): ScoreDocument {
  return {
    id: row.id,
    title: row.title,
    composer: row.composer ?? undefined,
    musicXmlUrl: row.music_xml_url,
    youtubeUrl: row.youtube_url ?? undefined,
    syncPoints: (row.sync_points as SyncPoint[]) ?? [],
    createdAt: row.created_at,
  };
}

export async function getAllScores(): Promise<ScoreDocument[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('scores')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data as ScoreRow[]).map(rowToDocument);
}

export async function getScoreById(id: string): Promise<ScoreDocument | null> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('scores')
    .select('*')
    .eq('id', id)
    .single();

  if (error) return null;
  return rowToDocument(data as ScoreRow);
}

export async function uploadScore(
  file: File,
  meta: { id: string; title: string; composer?: string }
): Promise<ScoreDocument> {
  const sb = getSupabase();
  const path = `${meta.id}.xml`;

  const { error: storageError } = await sb.storage
    .from('music-xml')
    .upload(path, file, { contentType: 'text/xml', upsert: true });

  if (storageError) throw storageError;

  const { data: { publicUrl } } = sb.storage
    .from('music-xml')
    .getPublicUrl(path);

  const { data, error: dbError } = await sb
    .from('scores')
    .upsert({
      id: meta.id,
      title: meta.title,
      composer: meta.composer ?? null,
      music_xml_url: publicUrl,
    })
    .select()
    .single();

  if (dbError) throw dbError;
  return rowToDocument(data as ScoreRow);
}

export async function updateScore(
  id: string,
  updates: { youtubeUrl?: string; syncPoints?: SyncPoint[] }
): Promise<void> {
  const sb = getSupabase();
  const patch: Record<string, unknown> = {};
  if ('youtubeUrl' in updates) patch.youtube_url = updates.youtubeUrl ?? null;
  if ('syncPoints' in updates) patch.sync_points = updates.syncPoints;
  const { error } = await sb.from('scores').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deleteScore(id: string): Promise<void> {
  const sb = getSupabase();
  await sb.storage.from('music-xml').remove([`${id}.xml`]);
  const { error } = await sb.from('scores').delete().eq('id', id);
  if (error) throw error;
}
