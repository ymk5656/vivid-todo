export interface ParsedNote {
  pitch: string;
  startBeat: number;    // quarter notes from measure start (0-based)
  durationBeats: number;
  partId: string;       // Added: maps note to its parent part
}

export interface ParsedPart {
  id: string;
  name: string;
}

export interface ParsedMeasure {
  measureNumber: number;    // 1-based
  startBeat: number;        // absolute quarter notes from score start
  durationBeats: number;    // measure length in quarter notes
  notes: ParsedNote[];
}

export interface ParsedScore {
  parts: ParsedPart[];      // Added: all parts/tracks in the score
  measures: ParsedMeasure[];
  totalMeasures: number;
}

export function parseMusicXml(xmlText: string): ParsedScore {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'text/xml');

  // Parse all parts in <part-list>
  const parts: ParsedPart[] = [];
  doc.querySelectorAll('part-list > score-part').forEach((partEl) => {
    const id = partEl.getAttribute('id') ?? '';
    const name = partEl.querySelector('part-name')?.textContent?.trim() ?? 'Unknown Part';
    parts.push({ id, name });
  });

  // Fallback if part-list is empty
  if (parts.length === 0) {
    doc.querySelectorAll('part').forEach((partEl, idx) => {
      const id = partEl.getAttribute('id') ?? `P${idx + 1}`;
      parts.push({ id, name: `Part ${idx + 1}` });
    });
  }

  // Accumulate notes per measure NUMBER, merging across all parts/staves so a
  // piano grand staff (or a multi-instrument score) produces ONE measure entry
  // with every voice's notes — not one duplicate measure per part. Duplicate
  // measure entries are what made the cursor jump down then back up: the sync
  // engine and renderer would step through part 1's notes, then part 2's, etc.
  const byNumber = new Map<number, { durationBeats: number; notes: ParsedNote[] }>();

  // Each <part> gets a fresh divisions/time context. A part normally declares
  // divisions in its first measure's <attributes>; defaults cover the rare omission.
  doc.querySelectorAll('part').forEach((partEl) => {
    const partId = partEl.getAttribute('id') ?? 'P1';
    let divisions = 1;
    let beats = 4;
    let beatType = 4;

    partEl.querySelectorAll(':scope > measure').forEach((measureEl) => {
      const measureNumber = parseInt(measureEl.getAttribute('number') ?? '1');

      const divisionsEl = measureEl.querySelector('attributes > divisions');
      if (divisionsEl?.textContent) divisions = parseInt(divisionsEl.textContent);

      const beatsEl = measureEl.querySelector('attributes > time > beats');
      if (beatsEl?.textContent) beats = parseInt(beatsEl.textContent);

      const beatTypeEl = measureEl.querySelector('attributes > time > beat-type');
      if (beatTypeEl?.textContent) beatType = parseInt(beatTypeEl.textContent);

      const measureLengthQN = (beats * 4) / beatType;

      const entry = byNumber.get(measureNumber) ?? { durationBeats: measureLengthQN, notes: [] };
      entry.durationBeats = Math.max(entry.durationBeats, measureLengthQN);

      // Walk note/backup/forward in document order. <backup> rewinds the cursor
      // (used between voices/staves of one part), <forward> skips it ahead — both
      // measured in divisions, like note durations. Without honoring them, the
      // bass-clef voice's startBeats continued past the measure length instead of
      // restarting at beat 0, scrambling playback order.
      let pos = 0;
      let prevNoteStart = 0;

      measureEl.querySelectorAll(':scope > note, :scope > backup, :scope > forward').forEach((el) => {
        const tag = el.tagName.toLowerCase();

        if (tag === 'backup') {
          pos -= parseInt(el.querySelector('duration')?.textContent ?? '0');
          if (pos < 0) pos = 0;
          return;
        }
        if (tag === 'forward') {
          pos += parseInt(el.querySelector('duration')?.textContent ?? '0');
          return;
        }

        // tag === 'note'
        const noteEl = el;
        const isChord = noteEl.querySelector('chord') !== null;
        const isRest = noteEl.querySelector('rest') !== null;
        const duration = parseInt(noteEl.querySelector('duration')?.textContent ?? '0');

        let startPos: number;
        if (isChord) {
          startPos = prevNoteStart;
        } else {
          startPos = pos;
          prevNoteStart = pos;
          pos += duration;
        }

        if (!isRest) {
          const step = noteEl.querySelector('step')?.textContent ?? 'C';
          const octave = noteEl.querySelector('octave')?.textContent ?? '4';
          const alter = noteEl.querySelector('alter')?.textContent;

          let acc = '';
          if (alter) {
            const a = parseFloat(alter);
            if (a >= 0.5) acc = '#';
            else if (a <= -0.5) acc = 'b';
          }

          entry.notes.push({
            pitch: `${step}${acc}${octave}`,
            startBeat: startPos / divisions,
            durationBeats: duration / divisions,
            partId,
          });
        }
      });

      byNumber.set(measureNumber, entry);
    });
  });

  // Emit measures in measure-number order with cumulative absolute beat offsets.
  const sortedNumbers = [...byNumber.keys()].sort((a, b) => a - b);
  let absoluteBeat = 0;
  const measures: ParsedMeasure[] = sortedNumbers.map((measureNumber) => {
    const entry = byNumber.get(measureNumber)!;
    const m: ParsedMeasure = {
      measureNumber,
      startBeat: absoluteBeat,
      durationBeats: entry.durationBeats,
      notes: entry.notes.sort((a, b) => a.startBeat - b.startBeat),
    };
    absoluteBeat += entry.durationBeats;
    return m;
  });

  return { parts, measures, totalMeasures: measures.length };
}
