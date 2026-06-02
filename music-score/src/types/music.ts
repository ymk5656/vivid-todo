export interface ScoreDocument {
  id: string;
  title: string;
  composer?: string;
  musicXmlUrl: string;
  midiUrl?: string;
  youtubeUrl?: string;
  syncPoints: SyncPoint[];
  createdAt: string;
}

export interface SyncPoint {
  measureNumber: number;
  timestamp: number;
}

export type PlaybackState = 'stopped' | 'playing' | 'paused';
