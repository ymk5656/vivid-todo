// Rule-based MusicXML quality checker for OMR output.
//
// Audiveris is treated as a *draft generator*: it reliably finds notes but can
// misread durations (wrong measure beat sums), octaves (notes far outside a clef's
// range), and key signatures (the cross-part <fifths> divergence the user hit).
// This layer DETECTS and ANNOTATES those — it NEVER mutates the XML. The download
// and renderer always use Audiveris' original output; this report is informational.
//
// It does its own DOM walk rather than reusing parseMusicXml(): that parser merges
// parts and drops rests/voices/clefs/fifths, all of which the checks below need.

export type WarningKind = 'beat' | 'range' | 'key' | 'duplicate';

export interface ValidationWarning {
  measure: number | null;
  kind: WarningKind;
  message: string;
  severity: 'warn' | 'info';
}

export interface ValidationReport {
  ok: boolean;
  warnings: ValidationWarning[];
}

const STEP_SEMITONE: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

// MIDI number where C4 = 60. Returns null for unparseable pitches.
function pitchToMidi(step: string, octave: number, alter: number): number | null {
  const semi = STEP_SEMITONE[step.toUpperCase()];
  if (semi === undefined) return null;
  return 12 * (octave + 1) + semi + alter;
}

function midiToName(midi: number): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const octave = Math.floor(midi / 12) - 1;
  return `${names[((midi % 12) + 12) % 12]}${octave}`;
}

// Generous plausible MIDI ranges per clef sign — wide on purpose so only genuine
// octave misreads (a treble note down in bass territory, etc.) trip a warning.
const CLEF_RANGE: Record<string, { lo: number; hi: number; label: string }> = {
  G: { lo: 52, hi: 93, label: '높은음자리표' }, // ~E3 .. A6
  F: { lo: 28, hi: 72, label: '낮은음자리표' }, // ~E1 .. C5
  C: { lo: 43, hi: 81, label: '가온음자리표' }, // ~G2 .. A5
};

function intText(el: Element | null, fallback: number): number {
  const t = el?.textContent?.trim();
  if (!t) return fallback;
  const n = parseInt(t, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function validateMusicXml(xml: string): ValidationReport {
  const warnings: ValidationWarning[] = [];

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, 'text/xml');
  } catch {
    return { ok: true, warnings: [] };
  }
  if (doc.querySelector('parsererror')) return { ok: true, warnings: [] };

  const parts = Array.from(doc.querySelectorAll('part'));
  if (parts.length === 0) return { ok: true, warnings: [] };

  // measureNumber -> partId -> fifths, for the cross-part key-divergence check.
  const fifthsByMeasure = new Map<number, Map<string, number>>();

  parts.forEach((partEl) => {
    const partId = partEl.getAttribute('id') ?? 'P1';
    let divisions = 1;
    let beats = 4;
    let beatType = 4;
    const clefByStaff = new Map<number, string>();

    const measureEls = Array.from(partEl.querySelectorAll(':scope > measure'));
    measureEls.forEach((measureEl, measureIdx) => {
      const measureNumber = parseInt(measureEl.getAttribute('number') ?? '', 10) || measureIdx + 1;

      divisions = intText(measureEl.querySelector('attributes > divisions'), divisions);
      beats = intText(measureEl.querySelector('attributes > time > beats'), beats);
      beatType = intText(measureEl.querySelector('attributes > time > beat-type'), beatType);

      // Clefs (per staff number) — updated whenever attributes declare them.
      measureEl.querySelectorAll('attributes > clef').forEach((clefEl) => {
        const staffNum = parseInt(clefEl.getAttribute('number') ?? '1', 10) || 1;
        const sign = clefEl.querySelector('sign')?.textContent?.trim().toUpperCase();
        if (sign) clefByStaff.set(staffNum, sign);
      });

      // Key signature (use the first <fifths> in this measure for this part).
      const fifthsEl = measureEl.querySelector('attributes > key > fifths');
      if (fifthsEl?.textContent) {
        const f = parseInt(fifthsEl.textContent, 10);
        if (Number.isFinite(f)) {
          if (!fifthsByMeasure.has(measureNumber)) fifthsByMeasure.set(measureNumber, new Map());
          fifthsByMeasure.get(measureNumber)!.set(partId, f);
        }
      }

      const expectedDiv = (divisions * beats * 4) / beatType;

      // Per-voice duration sums (in divisions). Each voice should fill the measure.
      const voiceSum = new Map<string, number>();
      // Duplicate detection: voice -> "onset|pitch" set.
      const seen = new Map<string, Set<string>>();
      let cursor = 0; // divisions from measure start, shared cursor (backup/forward)
      let prevNoteStart = 0;

      measureEl
        .querySelectorAll(':scope > note, :scope > backup, :scope > forward')
        .forEach((el) => {
          const tag = el.tagName.toLowerCase();
          if (tag === 'backup') {
            cursor -= intText(el.querySelector('duration'), 0);
            if (cursor < 0) cursor = 0;
            return;
          }
          if (tag === 'forward') {
            cursor += intText(el.querySelector('duration'), 0);
            return;
          }

          // note
          const isChord = el.querySelector('chord') !== null;
          const isRest = el.querySelector('rest') !== null;
          const duration = intText(el.querySelector('duration'), 0);
          const voice = el.querySelector('voice')?.textContent?.trim() || '1';

          let startPos: number;
          if (isChord) {
            startPos = prevNoteStart;
          } else {
            startPos = cursor;
            prevNoteStart = cursor;
            cursor += duration;
            voiceSum.set(voice, (voiceSum.get(voice) ?? 0) + duration);
          }

          if (!isRest) {
            const step = el.querySelector('pitch > step')?.textContent?.trim() ?? 'C';
            const octave = parseInt(el.querySelector('pitch > octave')?.textContent ?? '4', 10);
            const alter = parseFloat(el.querySelector('pitch > alter')?.textContent ?? '0') || 0;
            const midi = pitchToMidi(step, octave, alter);

            // Range vs clef (octave-misread suspicion).
            const staffNum = parseInt(el.querySelector('staff')?.textContent ?? '1', 10) || 1;
            const sign = clefByStaff.get(staffNum) ?? clefByStaff.get(1);
            if (midi !== null && sign && CLEF_RANGE[sign]) {
              const { lo, hi, label } = CLEF_RANGE[sign];
              if (midi < lo || midi > hi) {
                warnings.push({
                  measure: measureNumber,
                  kind: 'range',
                  message: `${label}에서 ${midiToName(midi)} 음이 일반 범위를 벗어남 (옥타브 오독 가능)`,
                  severity: 'info',
                });
              }
            }

            // Duplicate (same voice + onset + pitch).
            if (midi !== null) {
              const key = `${startPos}|${midi}`;
              const set = seen.get(voice) ?? new Set<string>();
              if (set.has(key)) {
                warnings.push({
                  measure: measureNumber,
                  kind: 'duplicate',
                  message: `같은 위치에 ${midiToName(midi)} 음이 중복됨 (성부 ${voice})`,
                  severity: 'info',
                });
              } else {
                set.add(key);
                seen.set(voice, set);
              }
            }
          }
        });

      // Beat-sum check. Skip the first (anacrusis/pickup) and last measure, where
      // partial measures are legitimate. Flag the voice that deviates most.
      const isEdge = measureIdx === 0 || measureIdx === measureEls.length - 1;
      if (!isEdge && expectedDiv > 0 && voiceSum.size > 0) {
        // for...of (not forEach): TS control-flow analysis tracks mutations to `worst`
        // in this scope but not inside a callback, so a callback would leave it typed
        // `never` after the loop.
        let worst: { voice: string; sum: number; diff: number } | null = null;
        for (const [voice, sum] of voiceSum) {
          const diff = Math.abs(sum - expectedDiv);
          if (!worst || diff > worst.diff) worst = { voice, sum, diff };
        }
        // Tolerance: 1 division absorbs rounding; below that it's a real mismatch.
        if (worst && worst.diff > 1) {
          const beatsGot = (worst.sum / divisions).toFixed(2);
          const beatsExp = (expectedDiv / divisions).toFixed(2);
          warnings.push({
            measure: measureNumber,
            kind: 'beat',
            message: `박자 합 불일치: ${beatsGot}박 (기대 ${beatsExp}박, ${beats}/${beatType}박자, 성부 ${worst.voice})`,
            severity: 'warn',
          });
        }
      }
    });
  });

  // Cross-part key divergence: at the same measure two parts declare different fifths.
  fifthsByMeasure.forEach((byPart, measureNumber) => {
    const distinct = new Set(byPart.values());
    if (distinct.size > 1) {
      warnings.push({
        measure: measureNumber,
        kind: 'key',
        message: `파트 간 조표(fifths) 불일치: ${[...distinct].join(', ')} — 조성 오독 가능`,
        severity: 'warn',
      });
    }
  });

  // Stable order: by measure, then kind.
  warnings.sort((a, b) => (a.measure ?? 0) - (b.measure ?? 0) || a.kind.localeCompare(b.kind));

  return { ok: warnings.length === 0, warnings };
}
