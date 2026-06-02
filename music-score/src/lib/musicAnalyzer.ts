'use client';

import { ParsedScore } from './musicXmlParser';

export interface DangerZone {
  measureStart: number;
  measureEnd: number;
  reason: string;
}

const NOTE_SEMITONES: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

function pitchToMidi(pitch: string): number | null {
  const m = pitch.match(/^([A-G])(#|b)?(\d)$/);
  if (!m) return null;
  const base = NOTE_SEMITONES[m[1]];
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  const octave = parseInt(m[3], 10);
  return base + acc + octave * 12;
}

export function detectDangerZones(score: ParsedScore): DangerZone[] {
  const zones: DangerZone[] = [];

  for (const measure of score.measures) {
    const pitches = measure.notes
      .map((n) => pitchToMidi(n.pitch))
      .filter((p): p is number => p !== null);

    for (let i = 1; i < pitches.length; i++) {
      const interval = Math.abs(pitches[i] - pitches[i - 1]);
      if (interval > 9) {
        zones.push({
          measureStart: measure.measureNumber,
          measureEnd: measure.measureNumber,
          reason: `큰 도약 음정 (${interval}반음)`,
        });
        break;
      }
    }
  }

  return zones;
}
