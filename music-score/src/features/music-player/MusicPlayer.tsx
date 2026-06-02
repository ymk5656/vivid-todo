'use client';

import { useEffect, useRef } from 'react';
import { usePlayerStore, InstrumentType } from '@/store/playerStore';
import { parseMusicXml, ParsedMeasure } from '@/lib/musicXmlParser';

function buildFallbackSynth(Tone: typeof import('tone'), instrument: InstrumentType) {
  switch (instrument) {
    case 'clarinet':
      return new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'square' },
        envelope: { attack: 0.08, decay: 0.0, sustain: 1.0, release: 0.5 },
      }).toDestination();
    case 'harmonica':
      return new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'sawtooth' },
        envelope: { attack: 0.03, decay: 0.05, sustain: 0.8, release: 0.2 },
      }).toDestination();
    case 'violin':
      return new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'sawtooth' },
        envelope: { attack: 0.15, decay: 0.3, sustain: 0.6, release: 0.8 },
      }).toDestination();
    case 'flute':
      return new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'sine' },
        envelope: { attack: 0.1, decay: 0.2, sustain: 0.8, release: 0.3 },
      }).toDestination();
    case 'guitar':
      return new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'triangle' },
        envelope: { attack: 0.02, decay: 0.8, sustain: 0.2, release: 1.0 },
      }).toDestination();
    case 'trumpet':
      return new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'sawtooth' },
        envelope: { attack: 0.05, decay: 0.1, sustain: 0.9, release: 0.2 },
      }).toDestination();
    default:
      // Piano: fast percussive attack, quick decay into low sustain, long release
      return new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'triangle' },
        envelope: { attack: 0.005, decay: 0.5, sustain: 0.1, release: 1.5 },
      }).toDestination();
  }
}

async function buildSynth(Tone: typeof import('tone'), instrument: string): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const instrumentMap: Record<string, string> = {
    piano: 'acoustic_grand_piano',
    clarinet: 'clarinet',
    harmonica: 'harmonica',
    violin: 'violin',
    flute: 'flute',
    guitar: 'acoustic_guitar_nylon',
    trumpet: 'trumpet',
  };
  const folderName = instrumentMap[instrument] || instrument;
  const baseUrl = `https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/${folderName}-mp3/`;
  const urls: Record<string, string> = { C3: 'C3.mp3', C4: 'C4.mp3', C5: 'C5.mp3', C6: 'C6.mp3' };

  return new Promise((resolve) => {
    const fallbackInst: InstrumentType = (
      instrument === 'clarinet' ||
      instrument === 'harmonica' ||
      instrument === 'violin' ||
      instrument === 'flute' ||
      instrument === 'guitar' ||
      instrument === 'trumpet'
    ) ? (instrument as InstrumentType) : 'piano';
    
    const timer = setTimeout(() => resolve(buildFallbackSynth(Tone, fallbackInst)), 8000);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sampler = new (Tone.Sampler as any)({
      urls,
      baseUrl,
      onload: () => { clearTimeout(timer); resolve(sampler); },
      onerror: () => { clearTimeout(timer); resolve(buildFallbackSynth(Tone, fallbackInst)); },
    }).toDestination();
  });
}

function mapPartNameToInstrument(partName: string): InstrumentType {
  const name = partName.toLowerCase();
  if (name.includes('violin') || name.includes('cello') || name.includes('string') || name.includes('viola') || name.includes('contrabass')) {
    return 'violin';
  }
  if (name.includes('flute') || name.includes('recorder') || name.includes('piccolo') || name.includes('pipe') || name.includes('whistle')) {
    return 'flute';
  }
  if (name.includes('guitar') || name.includes('lute') || name.includes('ukulele')) {
    return 'guitar';
  }
  if (name.includes('trumpet') || name.includes('trom') || name.includes('horn') || name.includes('tuba') || name.includes('brass') || name.includes('trombone')) {
    return 'trumpet';
  }
  if (name.includes('clarinet') || name.includes('oboe') || name.includes('bassoon') || name.includes('sax')) {
    return 'clarinet';
  }
  if (name.includes('harmonica') || name.includes('accordion') || name.includes('mouth organ')) {
    return 'harmonica';
  }
  return 'piano'; // default
}

export function useTonePlayer() {
  const synthsRef = useRef<Map<string, any>>(new Map()); // Maps partId -> synth
  const measuresRef = useRef<ParsedMeasure[]>([]);
  const measureIndexRef = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Rolling audio-clock playhead (seconds, in Tone/AudioContext time). Notes and
  // the cursor are both anchored to this single timeline so setTimeout jitter
  // between measures can never open a gap of silence or desync the highlight.
  const playheadRef = useRef(0);
  // Audio-clock-driven highlight queue + rAF handle. Each entry fires when
  // Tone.now() passes its `time`, so the mark tracks what you actually hear.
  const highlightQueueRef = useRef<{ time: number; measure: number; beat: number }[]>([]);
  const rafRef = useRef<number | null>(null);
  const bpmRef = useRef(120);
  const prevStateRef = useRef<string>('stopped');
  const activeRef = useRef(false);

  const {
    playbackState,
    bpm,
    xmlUrl,
    instrument,
    setCurrentMeasure,
    setCurrentBeat,
    setParsedMeasures,
    parts,
    setParts
  } = usePlayerStore();

  useEffect(() => { bpmRef.current = bpm; }, [bpm]);

  useEffect(() => {
    if (!xmlUrl) {
      measuresRef.current = [];
      setParsedMeasures(null);
      setParts(null);
      return;
    }
    fetch(xmlUrl)
      .then((r) => r.text())
      .then((text) => {
        const parsed = parseMusicXml(text);
        measuresRef.current = parsed.measures;
        setParsedMeasures(parsed.measures);
        setParts(parsed.parts);

        // Initialize part volumes to 0.8
        parsed.parts.forEach((p) => {
          usePlayerStore.getState().setPartVolume(p.id, 0.8);
        });

        // Set default instrument based on the first part name found in the score
        if (parsed.parts && parsed.parts.length > 0) {
          const firstPartName = parsed.parts[0].name;
          const detected = mapPartNameToInstrument(firstPartName);
          usePlayerStore.getState().setInstrument(detected);
        }
      })
      .catch(console.error);
  }, [xmlUrl, setParsedMeasures, setParts]);

  useEffect(() => {
    const prevState = prevStateRef.current;
    prevStateRef.current = playbackState;

    const clearTimer = () => {
      if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    };
    const clearNoteTimeouts = () => {
      if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      highlightQueueRef.current = [];
    };

    if (playbackState === 'playing') {
      if (prevState === 'stopped') measureIndexRef.current = 0;
      activeRef.current = true;

      (async () => {
        const Tone = await import('tone');
        await Tone.start();

        const currentParts = parts || [];
        const gInst = instrument;

        // Build synths for each part
        for (const p of currentParts) {
          if (!synthsRef.current.has(p.id)) {
            let instName = 'acoustic_grand_piano';
            if (gInst !== 'piano') {
              // Override all parts with the global selected instrument (clarinet/harmonica)
              instName = gInst;
            } else {
              // Default to mapped instrument based on part name
              instName = mapPartNameToInstrument(p.name);
            }
            const synth = await buildSynth(Tone, instName);
            synthsRef.current.set(p.id, synth);
          }
        }

        if (!activeRef.current) return;

        // How far ahead of the audio clock we queue the next measure. As long as a
        // measure's notes are scheduled before their (absolute) play time, WebAudio
        // plays them exactly on time regardless of setTimeout jitter — so this lead
        // is what eliminates the gaps/choppiness at measure boundaries.
        const LEAD = 0.25;

        // Single visual pump: advance the cursor as the audio clock crosses each
        // queued beat. Driving the highlight off Tone.now() (not setTimeout) keeps
        // the mark locked to what's actually sounding.
        const pump = () => {
          if (!activeRef.current) { rafRef.current = null; return; }
          const t = Tone.now();
          const q = highlightQueueRef.current;
          let applied: { measure: number; beat: number } | null = null;
          while (q.length && q[0].time <= t) applied = q.shift()!;
          if (applied) {
            const store = usePlayerStore.getState();
            store.setCurrentMeasure(applied.measure);
            store.setCurrentBeat({ measure: applied.measure, beat: applied.beat });
          }
          rafRef.current = requestAnimationFrame(pump);
        };

        // Anchor the timeline to the audio clock once, with a short lead-in.
        playheadRef.current = Tone.now() + 0.15;
        highlightQueueRef.current = [];
        if (rafRef.current == null) rafRef.current = requestAnimationFrame(pump);

        const tick = () => {
          if (!activeRef.current) return;

          const measures = measuresRef.current;
          let idx = measureIndexRef.current;

          // --- Loop (반복 재생) wrap ---------------------------------------
          // Read loop state fresh each tick (via getState, NOT effect deps) so
          // toggling/redefining the loop takes effect live without restarting
          // playback. When the next measure to schedule falls outside the loop
          // window, snap the index back to the loop start. The rolling playhead
          // keeps advancing, so the wrap is gapless — the listener hears T_start
          // resume the instant T_end finishes, with no audible latency.
          const { loopEnabled, loopRange } = usePlayerStore.getState();
          if (loopEnabled && loopRange && measures.length > 0) {
            const startIdx = measures.findIndex((m) => m.measureNumber === loopRange.start);
            let endIdx = measures.findIndex((m) => m.measureNumber === loopRange.end);
            if (startIdx !== -1) {
              if (endIdx === -1) endIdx = measures.length - 1;
              if (endIdx < startIdx) endIdx = startIdx;
              if (idx > endIdx || idx < startIdx) {
                idx = startIdx;
                measureIndexRef.current = startIdx;
              }
            }
          }

          if (idx >= measures.length) {
            if (measures.length > 0) {
              // Last measure was scheduled ~LEAD ahead and may still be ringing.
              // Defer the stop (and synth disposal) until the audio actually ends,
              // plus a little for release tails, so we don't cut off the ending.
              const remainMs = Math.max((playheadRef.current - Tone.now()) * 1000, 0) + 250;
              timeoutRef.current = setTimeout(() => {
                usePlayerStore.getState().setPlaybackState('stopped');
                usePlayerStore.getState().setCurrentMeasure(0);
                measureIndexRef.current = 0;
              }, remainMs);
            } else {
              timeoutRef.current = setTimeout(tick, 200);
            }
            return;
          }

          const measure = measures[idx];
          const qnSec = 60 / bpmRef.current;

          // Start this measure where the previous one ended (rolling playhead),
          // NOT at Tone.now(). If we've fallen badly behind (e.g. tab was
          // backgrounded and timers were throttled), resync forward so we never
          // schedule notes in the past.
          let measureStart = playheadRef.current;
          const safeNow = Tone.now() + 0.02;
          if (measureStart < safeNow) measureStart = safeNow;

          if (measure.notes.length > 0) {
            const { partMutes, partSolos, partVolumes } = usePlayerStore.getState();
            const isSoloActive = Object.values(partSolos).some(Boolean);

            measure.notes.forEach((note) => {
              const isMuted = partMutes[note.partId];
              const isSoloed = partSolos[note.partId];

              // Apply mute/solo rules
              if (isMuted || (isSoloActive && !isSoloed)) return;

              const synth = synthsRef.current.get(note.partId);
              if (synth) {
                // Apply volume
                const vol = partVolumes[note.partId] ?? 0.8;
                const db = vol > 0 ? 20 * Math.log10(vol) : -96; // -96dB is essentially silent
                if (synth.volume) {
                  synth.volume.value = db;
                }

                const t = measureStart + note.startBeat * qnSec;
                // Near-legato: release just slightly before the note's full length
                // so phrases sound continuous. The old *0.85 cut up to 15% (a clearly
                // audible hole on long notes); a fixed ~35ms trim only prevents
                // same-pitch retrigger clicks.
                const noteSec = note.durationBeats * qnSec;
                const d = Math.max(noteSec > 0.1 ? noteSec - 0.035 : noteSec * 0.9, 0.05);
                synth.triggerAttackRelease(note.pitch, d, t);
              }
            });

            // Queue cursor updates at each unique beat's ABSOLUTE audio time.
            const uniqueBeats = [...new Set(measure.notes.map((n) => n.startBeat))].sort((a, b) => a - b);
            uniqueBeats.forEach((beat) => {
              highlightQueueRef.current.push({
                time: measureStart + beat * qnSec,
                measure: measure.measureNumber,
                beat,
              });
            });
          } else {
            // Rest-only measure: still advance the cursor to its downbeat.
            highlightQueueRef.current.push({
              time: measureStart,
              measure: measure.measureNumber,
              beat: 0,
            });
          }

          // Advance the rolling playhead by this measure's exact duration, then
          // wake up ~LEAD before the next measure starts to queue it ahead of time.
          playheadRef.current = measureStart + measure.durationBeats * qnSec;
          measureIndexRef.current = idx + 1;
          const delayMs = Math.max((playheadRef.current - Tone.now() - LEAD) * 1000, 0);
          timeoutRef.current = setTimeout(tick, delayMs);
        };

        tick();
      })();
    } else {
      activeRef.current = false;
      clearTimer();
      clearNoteTimeouts();
      if (playbackState === 'stopped') {
        setCurrentMeasure(0);
        setCurrentBeat(null);
        measureIndexRef.current = 0;
      }
    }

    return () => {
      activeRef.current = false;
      clearTimer();
      clearNoteTimeouts();
      // Dispose synths and clear map so they can be rebuilt on instrument/part changes
      synthsRef.current.forEach((synth) => {
        try { synth.dispose(); } catch { /* ignore */ }
      });
      synthsRef.current.clear();
    };
  }, [playbackState, setCurrentMeasure, setCurrentBeat, instrument, parts]);

  useEffect(() => {
    return () => {
      synthsRef.current.forEach((synth) => {
        try { synth.dispose(); } catch { /* ignore */ }
      });
      synthsRef.current.clear();
    };
  }, []);
}
