'use client';

import dynamic from 'next/dynamic';
import { SyncPoint } from '@/types/music';

const YouTubePanel = dynamic(() => import('./YouTubePanel'), { ssr: false });

interface Props {
  youtubeUrl?: string;
  syncPoints: SyncPoint[];
}

export default function YouTubePanelClient({ youtubeUrl, syncPoints }: Props) {
  return <YouTubePanel youtubeUrl={youtubeUrl} syncPoints={syncPoints} />;
}
