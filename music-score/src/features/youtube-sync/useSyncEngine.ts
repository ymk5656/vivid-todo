import { SyncPoint } from '@/types/music';
import { ParsedMeasure } from '@/lib/musicXmlParser';

export function findMeasureForTime(syncPoints: SyncPoint[], time: number): number {
  if (syncPoints.length === 0) return 0;

  let lo = 0;
  let hi = syncPoints.length - 1;

  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (syncPoints[mid].timestamp <= time) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }

  return syncPoints[lo].timestamp <= time ? syncPoints[lo].measureNumber : 0;
}

// Calculate BPM from sync points anchored against parsed measure data.
// Returns null if fewer than 2 sync points or no measures loaded.
export function calcBpmFromSyncPoints(
  syncPoints: SyncPoint[],
  measures: ParsedMeasure[]
): number | null {
  if (syncPoints.length < 2 || measures.length === 0) return null;

  const sorted = [...syncPoints].sort((a, b) => a.measureNumber - b.measureNumber);
  let totalQN = 0;
  let totalSec = 0;

  for (let i = 0; i < sorted.length - 1; i++) {
    const sp1 = sorted[i];
    const sp2 = sorted[i + 1];
    const dt = sp2.timestamp - sp1.timestamp;
    if (dt <= 0 || sp2.measureNumber <= sp1.measureNumber) continue;

    for (let m = sp1.measureNumber; m < sp2.measureNumber; m++) {
      const measure = measures.find((pm) => pm.measureNumber === m);
      totalQN += measure ? measure.durationBeats : 4;
    }
    totalSec += dt;
  }

  return totalSec > 0 ? Math.round((60 * totalQN) / totalSec) : null;
}

// Given a YouTube timestamp, return the exact { measure, beat } position
// using the nearest sync point anchor and linear BPM interpolation.
export function findBeatForTime(
  syncPoints: SyncPoint[],
  measures: ParsedMeasure[],
  time: number,
  bpm: number
): { measure: number; beat: number } | null {
  if (!measures.length || !syncPoints.length || bpm <= 0) return null;

  const sorted = [...syncPoints].sort((a, b) => a.timestamp - b.timestamp);
  let anchor = sorted[0];
  for (const sp of sorted) {
    if (sp.timestamp <= time) anchor = sp;
    else break;
  }
  if (anchor.timestamp > time) return null;

  let remainingQN = (time - anchor.timestamp) * (bpm / 60);

  const fromMeasures = measures
    .filter((m) => m.measureNumber >= anchor.measureNumber)
    .sort((a, b) => a.measureNumber - b.measureNumber);

  if (!fromMeasures.length) return null;

  for (let i = 0; i < fromMeasures.length; i++) {
    const m = fromMeasures[i];
    const isLast = i === fromMeasures.length - 1;

    if (remainingQN < m.durationBeats || isLast) {
      const beatInMeasure = Math.max(0, Math.min(remainingQN, m.durationBeats - 0.001));

      const sortedNotes = [...m.notes].sort((a, b) => a.startBeat - b.startBeat);
      let targetBeat = 0;
      for (const note of sortedNotes) {
        if (note.startBeat <= beatInMeasure + 0.01) targetBeat = note.startBeat;
      }

      return { measure: m.measureNumber, beat: targetBeat };
    }
    remainingQN -= m.durationBeats;
  }

  return null;
}
