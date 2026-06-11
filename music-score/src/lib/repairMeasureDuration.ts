// Deterministic measure-duration REPAIR for OMR output — the mutating counterpart
// to musicXmlValidator.ts (which only DETECTS, never mutates).
//
// Why this exists: Audiveris frequently misreads note DURATIONS (eighth<->quarter
// swaps, dropped augmentation dots), so a measure's note/rest <duration> sum does
// NOT equal its declared time signature — some bars come out SHORT, some OVER. The
// <time> and <divisions> themselves are correct. MuseScore strictly enforces the
// time signature, so a SHORT bar locks out the missing beats (you can only enter
// ~5/8 into a 6/8 bar, the rest spills to the next bar) and an OVER bar overflows.
//
// We can't recover the *correct* rhythm — that's lost in OMR. But we CAN make every
// bar sum to exactly its nominal length so it opens as a clean, editable bar:
//   - SHORT  -> append rest(s) at the end of the deficient voice (decomposed into
//               clean note types so MuseScore shows tidy rests).
//   - OVER   -> trim the last note group of the offending voice (clamp its duration;
//               drop trailing notes if clamping alone can't absorb the excess).
//
// The canonical download stays byte-identical; this is only used for the separate,
// opt-in "박자 보정본" download. Rhythms still need manual correction in MuseScore
// (an OMR limitation), but the locking/overflow behavior is gone.

export interface RepairResult {
  xml: string;
  /** Per-measure changes applied, for a short user-facing summary. */
  changes: RepairChange[];
}

export interface RepairChange {
  part: string;
  measure: number;
  voice: string;
  /** Negative = was short (padded), positive = was over (trimmed), in beats. */
  diffBeats: number;
  action: 'padded' | 'trimmed';
}

interface Component {
  units: number; // duration in divisions
  type: string; // MusicXML <type> value
  dots: number; // number of <dot/> elements
}

// Build the note-type component table for a given <divisions> value (where a quarter
// note == `divisions` units). Only integer-unit types are usable; fractional ones
// (e.g. dotted-eighth at divisions=2) are filtered out. Sorted largest-first for a
// greedy decomposition.
function buildComponents(divisions: number): Component[] {
  const base: { type: string; dots: number; mult: number }[] = [
    { type: 'whole', dots: 0, mult: 4 },
    { type: 'half', dots: 1, mult: 3 },
    { type: 'half', dots: 0, mult: 2 },
    { type: 'quarter', dots: 1, mult: 1.5 },
    { type: 'quarter', dots: 0, mult: 1 },
    { type: 'eighth', dots: 1, mult: 0.75 },
    { type: 'eighth', dots: 0, mult: 0.5 },
    { type: '16th', dots: 1, mult: 0.375 },
    { type: '16th', dots: 0, mult: 0.25 },
    { type: '32nd', dots: 0, mult: 0.125 },
  ];
  return base
    .map((b) => ({ units: b.mult * divisions, type: b.type, dots: b.dots }))
    .filter((c) => Number.isInteger(c.units) && c.units > 0)
    .sort((a, b) => b.units - a.units);
}

// Greedily express `gap` (in divisions) as a list of components. Any leftover that
// can't map to a clean note type becomes a duration-only component (type === '',
// dots 0) — still valid MusicXML (<type> is optional) and MuseScore-tolerated.
function decompose(gap: number, components: Component[]): Component[] {
  const out: Component[] = [];
  let remaining = gap;
  for (const c of components) {
    while (remaining >= c.units) {
      out.push(c);
      remaining -= c.units;
    }
  }
  if (remaining > 0) out.push({ units: remaining, type: '', dots: 0 });
  return out;
}

function intText(el: Element | null, fallback: number): number {
  const t = el?.textContent?.trim();
  if (!t) return fallback;
  const n = parseInt(t, 10);
  return Number.isFinite(n) ? n : fallback;
}

// Build a <note><rest/>... element matching the document, for padding short bars.
function makeRestNote(doc: Document, comp: Component, voice: string, staff: number | null): Element {
  const note = doc.createElement('note');
  note.appendChild(doc.createElement('rest'));
  const dur = doc.createElement('duration');
  dur.textContent = String(comp.units);
  note.appendChild(dur);
  const v = doc.createElement('voice');
  v.textContent = voice;
  note.appendChild(v);
  if (comp.type) {
    const t = doc.createElement('type');
    t.textContent = comp.type;
    note.appendChild(t);
    for (let i = 0; i < comp.dots; i++) note.appendChild(doc.createElement('dot'));
  }
  if (staff !== null) {
    const s = doc.createElement('staff');
    s.textContent = String(staff);
    note.appendChild(s);
  }
  return note;
}

interface NoteInfo {
  el: Element;
  isChord: boolean;
  isRest: boolean;
  duration: number;
  voice: string;
  staff: number | null;
}

function readNote(el: Element): NoteInfo {
  return {
    el,
    isChord: el.querySelector('chord') !== null,
    isRest: el.querySelector('rest') !== null,
    duration: intText(el.querySelector('duration'), 0),
    voice: el.querySelector('voice')?.textContent?.trim() || '1',
    staff: el.querySelector('staff') ? intText(el.querySelector('staff'), 1) : null,
  };
}

// Rewrite a note's <duration> and (best-effort) its <type>/<dot> to `units`. If the
// duration maps to a single clean component, the type/dots are made consistent;
// otherwise the type is left as-is (display may be approximate, but timing is exact).
function setNoteDuration(doc: Document, note: Element, units: number, components: Component[]) {
  const durEl = note.querySelector('duration');
  if (durEl) durEl.textContent = String(units);
  const single = components.find((c) => c.units === units);
  const typeEl = note.querySelector('type');
  // Remove existing dots regardless; re-add only if we have a clean single type.
  note.querySelectorAll('dot').forEach((d) => d.remove());
  if (single && single.type) {
    if (typeEl) {
      typeEl.textContent = single.type;
      for (let i = 0; i < single.dots; i++) {
        const dot = doc.createElement('dot');
        typeEl.insertAdjacentElement('afterend', dot);
      }
    }
  }
}

/**
 * Normalize every full measure to exactly its declared time signature so the file
 * opens as clean, editable bars in MuseScore. Conservative: only single-voice
 * measures with no <backup>/<forward> (the common OMR melody case) are touched;
 * multi-voice / multi-staff measures are left untouched to avoid corrupting them.
 */
export function repairMeasureDurations(xml: string): RepairResult {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, 'text/xml');
  } catch {
    return { xml, changes: [] };
  }
  if (doc.querySelector('parsererror')) return { xml, changes: [] };

  const parts = Array.from(doc.querySelectorAll('part'));
  if (parts.length === 0) return { xml, changes: [] };

  const changes: RepairChange[] = [];

  parts.forEach((partEl) => {
    const partId = partEl.getAttribute('id') ?? 'P1';
    let divisions = 1;
    let beats = 4;
    let beatType = 4;

    const measureEls = Array.from(partEl.querySelectorAll(':scope > measure'));
    measureEls.forEach((measureEl) => {
      const measureNumber =
        parseInt(measureEl.getAttribute('number') ?? '', 10) ||
        measureEls.indexOf(measureEl) + 1;

      divisions = intText(measureEl.querySelector('attributes > divisions'), divisions);
      beats = intText(measureEl.querySelector('attributes > time > beats'), beats);
      beatType = intText(measureEl.querySelector('attributes > time > beat-type'), beatType);

      // Bail on anything multi-voice or with explicit cursor moves — too risky to
      // rewrite safely. (The user's OMR files are single-voice per part.)
      if (measureEl.querySelector(':scope > backup, :scope > forward')) return;

      const noteEls = Array.from(measureEl.querySelectorAll(':scope > note'));
      if (noteEls.length === 0) return;
      const notes = noteEls.map(readNote);

      const voices = new Set(notes.map((n) => n.voice));
      if (voices.size > 1) return; // multi-voice — leave alone
      const voice = notes[0].voice;
      const staff = notes[0].staff;

      const expected = (divisions * beats * 4) / beatType;
      if (!Number.isInteger(expected) || expected <= 0) return;

      // Sum only voice-advancing notes (non-chord), exactly like the validator.
      const sum = notes.reduce((acc, n) => (n.isChord ? acc : acc + n.duration), 0);
      const diff = sum - expected;
      if (Math.abs(diff) <= 0) return; // already exact

      const components = buildComponents(divisions);

      if (diff < 0) {
        // SHORT — append decomposed rests at the end of the measure.
        const gap = -diff;
        const lastNote = noteEls[noteEls.length - 1];
        for (const comp of decompose(gap, components)) {
          const rest = makeRestNote(doc, comp, voice, staff);
          lastNote.insertAdjacentElement('afterend', rest);
        }
        changes.push({
          part: partId,
          measure: measureNumber,
          voice,
          diffBeats: diff / divisions,
          action: 'padded',
        });
      } else {
        // OVER — trim from the end. Find the last voice-advancing note group (the
        // last non-chord note plus any chord members that follow it).
        let over = diff;
        // Walk from the end, removing whole note-groups while that doesn't undershoot.
        // A group = a non-chord note and its trailing <chord/> siblings.
        const groups: { mainIdx: number; els: Element[]; dur: number }[] = [];
        for (let i = 0; i < noteEls.length; i++) {
          const info = notes[i];
          if (!info.isChord) {
            groups.push({ mainIdx: i, els: [noteEls[i]], dur: info.duration });
          } else if (groups.length > 0) {
            groups[groups.length - 1].els.push(noteEls[i]);
          }
        }

        // Remove trailing whole groups while their full duration is <= remaining over.
        while (groups.length > 0 && over >= groups[groups.length - 1].dur) {
          const g = groups.pop()!;
          over -= g.dur;
          g.els.forEach((el) => el.remove());
        }
        // Clamp the new last group's duration to absorb the remainder.
        if (over > 0 && groups.length > 0) {
          const g = groups[groups.length - 1];
          const newDur = g.dur - over;
          if (newDur > 0) {
            g.els.forEach((el) => setNoteDuration(doc, el, newDur, components));
            over = 0;
          }
        }
        // If we removed too much (undershot), pad the gap back with rests.
        if (over < 0) {
          const lastNote = measureEl.querySelector(':scope > note:last-of-type');
          if (lastNote) {
            for (const comp of decompose(-over, components)) {
              const rest = makeRestNote(doc, comp, voice, staff);
              lastNote.insertAdjacentElement('afterend', rest);
            }
          }
        }
        changes.push({
          part: partId,
          measure: measureNumber,
          voice,
          diffBeats: diff / divisions,
          action: 'trimmed',
        });
      }
    });
  });

  if (changes.length === 0) return { xml, changes: [] };

  const out = new XMLSerializer().serializeToString(doc);
  return { xml: out, changes };
}
