import { NextRequest, NextResponse } from 'next/server';
import Groq from 'groq-sdk';

// Audiveris OMR can take 10–120s; raise the serverless function ceiling so the
// forward to OMR_API_URL isn't cut off. Vercel Pro honors up to 300; Hobby
// clamps to its own plan max, so this is harmless there.
export const maxDuration = 300;

// Audiveris labels all unlabeled parts "Voice" — replace with empty so OSMD shows nothing
function removeGenericVoiceLabel(xml: string): string {
  return xml.replace(/<part-name>\s*Voice\s*<\/part-name>/g, '<part-name></part-name>');
}

// A recognition is only useful if it produced actual notes. Audiveris returns an
// empty stub (part-list + attributes, no <note>) when it can't read staves from a
// photo/unclear scan; Groq sometimes hallucinates the same empty skeleton. Both
// close as well-formed XML, so an HTTP 200 alone doesn't mean "recognized" — OSMD
// later throws "Cannot read properties of undefined (createStaves)" on this junk.
// Gate on having at least one <note> before treating the result as a success.
function hasNotes(xml: string): boolean {
  return /<note[\s>]/.test(xml);
}

const NO_NOTES_MESSAGE =
  '악보를 인식하지 못했습니다. 더 선명하고 정면에서 찍은(또는 스캔한) 악보 이미지를 사용해 주세요.';

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get('file') as File | null;

  if (!file) {
    return NextResponse.json({ error: '파일이 없습니다.' }, { status: 400 });
  }

  if (file.type === 'application/pdf') {
    return NextResponse.json(
      { error: 'PDF는 클라이언트에서 이미지로 변환 후 전송해야 합니다.' },
      { status: 400 }
    );
  }

  const { searchParams } = req.nextUrl;
  // Groq Vision (a vision LLM) hallucinates pitches/rhythm — its output is barely
  // usable, so it's disabled by default. The client never sets ?groq=1, so the only
  // engine in production is Audiveris; a failure returns an honest "couldn't
  // recognize" error instead of fake notes. Pass ?groq=1 to re-enable it manually.
  const allowGroq = searchParams.get('groq') === '1';

  // Primary (and, by default, only) engine: Audiveris (OMR_API_URL — Railway in
  // prod, local docker in dev). The server retries multiple orientations before
  // giving up, so a failure here means the image is genuinely unreadable.
  const omrApiUrl = process.env.OMR_API_URL;
  if (omrApiUrl) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000); // 120s: server may try grayscale + binarized passes across orientations
    try {
      const forwardForm = new FormData();
      forwardForm.append('file', file);
      const res = await fetch(omrApiUrl, { 
        method: 'POST', 
        body: forwardForm,
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`OMR API error: ${res.status}\n${detail.slice(0, 800)}`);
      }
      const xml = removeGenericVoiceLabel(await res.text());
      // Audiveris returned 200 but read no notes — treat as a miss.
      if (!hasNotes(xml)) {
        throw new Error('Audiveris가 음표를 인식하지 못함 (빈 결과)');
      }
      // Pass through Audiveris' best-effort SCALE/Staff diagnostics (interline,
      // barline/brace notes) so the client can surface them for debugging. Optional —
      // absent on older server builds.
      const headers: Record<string, string> = {
        'Content-Type': 'text/xml',
        'X-OMR-Engine': 'Audiveris',
      };
      const staff = res.headers.get('X-OMR-Staff');
      if (staff) headers['X-OMR-Staff'] = staff;
      return new NextResponse(xml, { headers });
    } catch (e) {
      clearTimeout(timeoutId);
      console.warn(`Audiveris OMR 실패: ${e instanceof Error ? e.message : e}`);
      // Audiveris failed/empty. Only fall back to Groq when explicitly opted in.
      if (!allowGroq) {
        return NextResponse.json({ error: NO_NOTES_MESSAGE }, { status: 422 });
      }
      // fall through to Groq below
    }
  }

  if (!allowGroq) {
    return NextResponse.json({ error: NO_NOTES_MESSAGE }, { status: 422 });
  }
  return recognizeWithGroq(file);
}

async function recognizeWithGroq(file: File): Promise<NextResponse> {
  const groqApiKey = process.env.GROQ_API_KEY;
  if (!groqApiKey) {
    return NextResponse.json({ error: 'GROQ_API_KEY가 설정되지 않았습니다.' }, { status: 500 });
  }

  try {
    const arrayBuffer = await file.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    const mediaType = file.type || 'image/png';

    const groq = new Groq({ apiKey: groqApiKey });

    const completion = await groq.chat.completions.create({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: `data:${mediaType};base64,${base64}` },
            },
            {
              type: 'text',
              text: `You are a music notation expert. Analyze this sheet music image and transcribe it into a highly detailed and valid MusicXML 3.1 document.

Output ONLY the raw MusicXML document starting with <?xml version="1.0" encoding="UTF-8"?> and ending with </score-partwise>. No markdown code blocks (do not wrap in \`\`\`xml or \`\`\`), no conversational text, no explanation.

Core Structure Requirements:
- Use <score-partwise version="3.1"> format.
- Include a complete <part-list> containing <score-part> elements for all instruments/voices found. Do NOT use "Voice" as a part name; if unknown, use clef (e.g., treble -> "Melody", bass -> "Bass") or leave empty.
- For each part, transcribe all measures in order with correct measure number attributes.
- Include key signature (<key><fifths>...</fifths></key>), time signature (<time><beats>...</beats><beat-type>...</beat-type></time>), divisions, and clefs in the <attributes> of the first measure of each part (and whenever they change).
- If piano or organ: use two staves (treble/bass) mapped to <staff>1</staff> and <staff>2</staff> in the XML.

Detailed Notation Transcribing Requirements (CRITICAL):
- Ignore UI Overlays: The sheet music image might contain user interface overlays, such as a colored playback cursor highlight (e.g., a semi-transparent blue/green/yellow vertical bar or box over a note) or gray background boxes around text. You MUST ignore these colored highlights and transcribe the underlying musical notes and staff lines as if the highlights were not present.
- Pitch Accuracy Reference:
  * Treble Clef staff lines: 1st line (bottom) = E4, 2nd line = G4, 3rd line = B4, 4th line = D5, 5th line = F5. Spaces: 1st space = F4, 2nd space = A4, 3rd space = C5, 4th space = E5, space above 5th line = G5, 1st ledger line above = A5, space above 1st ledger line = B5.
  * Bass Clef staff lines: 1st line (bottom) = G2, 2nd line = B2, 3rd line = D3, 4th line = F3, 5th line = A3. Spaces: 1st space = A2, 2nd space = C3, 3rd space = E3, 4th space = G3, space above 5th line = B3, ledger line above top = C4 (Middle C).
  Please examine the vertical position of each note head relative to these staff lines and ledger lines carefully to assign the exact correct pitch step and octave.

1. Pitch & Duration: Transcribe all notes and rests with correct pitch (<step>, <octave>, optional <alter>) and <duration>.
2. Dynamics: Capture all volume and dynamics markings (p, f, mf, mp, ff, pp, sfz, crescendo, decrescendo). Encode them as <direction> elements with <dynamics> or <wedge> tags at the correct beats.
3. Articulations: Transcribe staccato, accent, tenuto, and fermata. Encode them inside <notations><articulations> (e.g., <staccato/>, <accent/>) or <fermata/>.
4. Slurs & Ties: Detect slurs and ties. Encode them as <slur type="start" number="1"/> / <slur type="stop" number="1"/> or <tie type="start"/> / <tie type="stop"/> / <tied type="start"/> / <tied type="stop"/> inside <notations>.
5. Ornaments & Tremolos: Capture trills, turns, and tremolos. Encode them inside <notations><ornaments> (e.g., <trill-mark/>, <tremolo type="single">3</tremolo>).
6. Lyrics: If there is text or lyrics, transcribe them inside <lyric> tags for each note, utilizing <syllabic> and <text> elements.
7. Chord Symbols: If guitar/piano chord symbols are printed above the staves (e.g., C, Am, G7), transcribe them as <harmony> elements with <root> and <kind> tags before the corresponding notes.
8. Tempo: Capture tempo words (e.g., Allegro, Andante) and metronome marks. Encode them as a <direction> with <words> and a <sound tempo="..."/> attribute.`,
            },
          ],
        },
      ],
      max_tokens: 8192,
    });

    const content = completion.choices[0]?.message?.content ?? '';

    // Extract the XML block — strip any surrounding markdown fences
    const xmlMatch = content.match(/<\?xml[\s\S]*<\/score-partwise>/);
    const xml = removeGenericVoiceLabel(xmlMatch ? xmlMatch[0] : content.trim());

    // Reject empty/incomplete results instead of returning junk that crashes the
    // renderer (OSMD "createStaves" on undefined). Without this the client saves a
    // broken score and the failure only surfaces — opaquely — at render time.
    if (!hasNotes(xml)) {
      return NextResponse.json({ error: NO_NOTES_MESSAGE }, { status: 422 });
    }

    return new NextResponse(xml, { 
      headers: { 
        'Content-Type': 'text/xml',
        'X-OMR-Engine': 'Groq'
      } 
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Groq 인식 실패: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 }
    );
  }
}
