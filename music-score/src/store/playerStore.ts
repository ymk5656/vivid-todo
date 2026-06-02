import { create } from 'zustand';
import { PlaybackState, SyncPoint } from '@/types/music';
import { ParsedMeasure, ParsedPart } from '@/lib/musicXmlParser';

export type InstrumentType = 'piano' | 'clarinet' | 'harmonica' | 'violin' | 'flute' | 'guitar' | 'trumpet';

interface PlayerStore {
  playbackState: PlaybackState;
  bpm: number;
  currentMeasure: number;
  currentBeat: { measure: number; beat: number } | null;
  currentTimestamp: number;
  xmlUrl: string | null;
  youtubeUrl: string | null;
  syncPoints: SyncPoint[];
  instrument: InstrumentType;
  parsedMeasures: ParsedMeasure[] | null;
  parts: ParsedPart[] | null;
  partVolumes: Record<string, number>;
  partMutes: Record<string, boolean>;
  partSolos: Record<string, boolean>;
  // Loop (반복 재생): inclusive range of 1-based measure numbers.
  loopRange: { start: number; end: number } | null;
  loopEnabled: boolean;
  setPlaybackState: (state: PlaybackState) => void;
  setBpm: (bpm: number) => void;
  setCurrentMeasure: (measure: number) => void;
  setCurrentBeat: (beat: { measure: number; beat: number } | null) => void;
  setCurrentTimestamp: (timestamp: number) => void;
  setXmlUrl: (url: string | null) => void;
  setYoutubeUrl: (url: string | null) => void;
  setSyncPoints: (points: SyncPoint[]) => void;
  setInstrument: (instrument: InstrumentType) => void;
  setParsedMeasures: (measures: ParsedMeasure[] | null) => void;
  setParts: (parts: ParsedPart[] | null) => void;
  setPartVolume: (partId: string, volume: number) => void;
  togglePartMute: (partId: string) => void;
  togglePartSolo: (partId: string) => void;
  setLoopRange: (range: { start: number; end: number } | null) => void;
  setLoopEnabled: (enabled: boolean) => void;
  toggleLoopEnabled: () => void;
  clearLoop: () => void;
}

export const usePlayerStore = create<PlayerStore>((set) => ({
  playbackState: 'stopped',
  bpm: 120,
  currentMeasure: 0,
  currentBeat: null,
  currentTimestamp: 0,
  xmlUrl: null,
  youtubeUrl: null,
  syncPoints: [],
  instrument: 'piano',
  parsedMeasures: null,
  parts: null,
  partVolumes: {},
  partMutes: {},
  partSolos: {},
  loopRange: null,
  loopEnabled: false,
  setPlaybackState: (state) => set({ playbackState: state }),
  setBpm: (bpm) => set({ bpm }),
  setCurrentMeasure: (measure) => set({ currentMeasure: measure }),
  setCurrentBeat: (beat) => set({ currentBeat: beat }),
  setCurrentTimestamp: (timestamp) => set({ currentTimestamp: timestamp }),
  setXmlUrl: (url) => set({ xmlUrl: url }),
  setYoutubeUrl: (url) => set({ youtubeUrl: url }),
  setSyncPoints: (points) => set({ syncPoints: points }),
  setInstrument: (instrument) => set({ instrument }),
  setParsedMeasures: (measures) => set({ parsedMeasures: measures }),
  setParts: (parts) => set({ parts }),
  setPartVolume: (partId, volume) => set((s) => ({
    partVolumes: { ...s.partVolumes, [partId]: volume }
  })),
  togglePartMute: (partId) => set((s) => ({
    partMutes: { ...s.partMutes, [partId]: !s.partMutes[partId] }
  })),
  togglePartSolo: (partId) => set((s) => ({
    partSolos: { ...s.partSolos, [partId]: !s.partSolos[partId] }
  })),
  // Setting a range auto-enables the loop; clearing disables it.
  setLoopRange: (range) => set({ loopRange: range, loopEnabled: range != null }),
  setLoopEnabled: (enabled) => set({ loopEnabled: enabled }),
  toggleLoopEnabled: () => set((s) => ({ loopEnabled: !s.loopEnabled })),
  clearLoop: () => set({ loopRange: null, loopEnabled: false }),
}));
