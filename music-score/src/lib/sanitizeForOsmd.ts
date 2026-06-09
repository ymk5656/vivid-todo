/**
 * Render-only MusicXML repair for OpenSheetMusicDisplay.
 *
 * Audiveris occasionally emits an `<octave-shift>` "start" (type="up"/"down")
 * with no matching type="stop" (or a "stop" with no start). OSMD's
 * `calculateOctaveShifts` then dereferences an undefined end timestamp and the
 * whole render() throws "Cannot read properties of undefined (reading 'realValue')",
 * leaving the user with audio but no visible score.
 *
 * This repair removes ONLY unmatched octave-shift directions — balanced 8va/8vb
 * brackets are preserved. It mutates an in-memory copy used purely for rendering;
 * the downloaded / stored MusicXML stays the untouched Audiveris original.
 */
export function sanitizeForOsmd(xml: string): string {
  if (typeof DOMParser === 'undefined') return xml;
  if (xml.indexOf('octave-shift') === -1) return xml;

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, 'application/xml');
  } catch {
    return xml;
  }
  if (doc.getElementsByTagName('parsererror').length > 0) return xml;

  let removedAny = false;
  const parts = Array.from(doc.getElementsByTagName('part'));
  const scopes = parts.length ? parts : [doc.documentElement];

  for (const scope of scopes) {
    const shifts = Array.from(scope.getElementsByTagName('octave-shift'));
    if (shifts.length === 0) continue;

    // Match starts → stops per `number` (octave-shift bracket id) in document order.
    const open = new Map<string, Element[]>();
    const unmatched: Element[] = [];
    for (const sh of shifts) {
      const num = sh.getAttribute('number') || '1';
      const type = sh.getAttribute('type');
      if (type === 'stop') {
        const stack = open.get(num);
        if (stack && stack.length) stack.pop();
        else unmatched.push(sh); // stop with no preceding start
      } else {
        if (!open.has(num)) open.set(num, []);
        open.get(num)!.push(sh); // up / down / continue
      }
    }
    // Any still-open starts never got a stop.
    for (const stack of open.values()) unmatched.push(...stack);

    for (const sh of unmatched) {
      const dirType = sh.parentElement; // <direction-type>
      const dir = dirType?.parentElement ?? null; // <direction>
      sh.remove();
      removedAny = true;
      // Drop now-empty wrappers so OSMD doesn't choke on an empty <direction>.
      if (dirType && dirType.children.length === 0) dirType.remove();
      if (dir && dir.getElementsByTagName('direction-type').length === 0) dir.remove();
    }
  }

  if (!removedAny) return xml;
  try {
    let out = new XMLSerializer().serializeToString(doc);
    // XMLSerializer drops the `<?xml ?>` prolog; OSMD's loader requires it to
    // recognize the string as a MusicXML document. Restore the original prolog.
    if (!out.startsWith('<?xml')) {
      const prolog = xml.match(/^\s*<\?xml[^>]*\?>/);
      out = (prolog ? prolog[0] : '<?xml version="1.0" encoding="UTF-8"?>') + '\n' + out;
    }
    return out;
  } catch {
    return xml;
  }
}
