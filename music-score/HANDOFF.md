# HANDOFF — music-platform

_Last updated: 2026-06-11. Branch `master` (item 11 committed locally as `1c37d94`; not yet pushed/deployed). This session added the measure-duration REPAIR feature — a downloadable, time-corrected MusicXML that opens as clean editable bars in MuseScore (item 11). Prior session added `08e641d` (OSMD octave-shift render repair — item 9) and `3befb60` (Phase A server preprocessing: gray/photo deskew + unsharp + `X-OMR-Staff` — item 10), both **pushed + deployed + live-verified**. Item 8 (`8a5464f`, validation report + composer presets + score fallback) is **pushed & deployed**. Earlier OMR-accuracy + loop-playback work (items 2–7) committed/deployed._

## Goal

A web app for displaying and playing along with sheet music. Users upload a
sheet-music image or PDF → it's recognized (OMR) into MusicXML → rendered with
a synced cursor/highlight that follows playback (incl. YouTube sync), tuned to
work well on phones. Recent focus: raising OMR **recognition accuracy** and
fixing **mobile playback/UX** issues.

## Deployment & Repo Constraints (READ FIRST)

- **Git repo is the workspace root `E:\project`** (music-score is a subdir of a
  multi-project workspace), branch `master`. There **IS** a remote now:
  `origin` = `https://github.com/ymk5656/vivid-todo.git`, and `master` tracks
  `origin/master`. The `git push` flow is live and user-approved. (This reverses
  the old "NO git remote" note — that was true in a previous session.) Run git
  commands from `E:\project`; the music-score commits so far are cleanly scoped
  to `music-score/` paths only — keep them that way (don't bundle other projects'
  changes into a music-score commit).
- **Deploy via Vercel CLI** (separate from git push): `vercel deploy --prod --yes`
  from `E:\project\music-score`. Prod alias: **https://music-score-sigma.vercel.app**
  (Vercel project **`music-score`**). The fix→deploy pattern is user-approved;
  briefly confirm each prod deploy. Railway (OMR server) deploys via `railway up`.
- **Next.js 16.2.x (App Router, Turbopack).** This is NOT the Next.js in your
  training data — read `node_modules/next/dist/docs/` before writing Next code
  (per AGENTS.md). `npx next build` does full TS typecheck + static gen.
- Windows / PowerShell shell. **Do NOT pipe python into PowerShell** (parse
  errors) — use the Bash tool with heredocs for python.
- **Secrets:** `.env.local` holds a real `GROQ_API_KEY` (gsk_…) and a Supabase
  anon JWT. **Never echo these into chat.** Don't ask the user to paste tokens.

## Architecture (OMR path)

- Client `src/app/omr/page.tsx` prepares the image/PDF, POSTs FormData to
  `/api/omr`.
- `src/app/api/omr/route.ts` (Vercel serverless, `maxDuration = 300`):
  - **Primary:** forwards FormData to Audiveris on Railway (`OMR_API_URL`).
  - Gate: `hasNotes(xml)` (`/<note[\s>]/`); strips generic voice labels.
  - **Fallback:** Groq vision model
    `meta-llama/llama-4-scout-17b-16e-instruct` (base64 data URL, max_tokens
    8192) when Audiveris fails/returns note-less XML.
  - Rejects `application/pdf` — PDFs must be rendered to images client-side
    first.
- `src/lib/musicXmlParser.ts` parses MusicXML → `ParsedScore` (merges measures
  across parts by measure number; honors `<backup>`/`<forward>`; sorts notes by
  startBeat).
- `src/features/score-view/ScoreRenderer.tsx` renders via OpenSheetMusicDisplay
  (OSMD) with a custom overlay highlight; 0.5 zoom on phones (<768px).

### THE binding constraint

**Vercel serverless functions reject request bodies > 4.5MB with a 413 at the
edge** — before the route (and its Groq fallback) ever runs. This caps how much
image quality you can send through `/api/omr`. The browser→Railway **direct**
upload path (via `NEXT_PUBLIC_OMR_API_URL`) bypasses this 4.5MB wall and is now
**implemented** (CORS `allow_origins=["*"]` on the Railway service). The client
tries the direct path first; on failure it falls back to `/api/omr` (which can
still try Railway server-side for sub-4.5MB files, then Groq).

## Current Progress (done & deployed)

1. **`06bea8e`** — sequential phone playback (parser rewrite in
   `musicXmlParser.ts`) + reliable admin delete button (larger tap targets in
   `admin/page.tsx`).
2. **`c098eab`** — **OMR resolution fix** (latest). Stop over-downscaling
   uploads. In `src/app/omr/page.tsx`:
   - `TARGET_WIDTH = 2480` (~300 DPI for A4/Letter width; Audiveris wants ~300).
   - `UPLOAD_BUDGET = 4.3MB` (headroom under Vercel's 4.5MB).
   - `encodeToFit()` strategy: try **lossless PNG** first → if over budget,
     descend JPEG quality 0.95→0.9→0.85→0.8 → only then step resolution down
     (×0.82 per loop, floor 1200px). Originals already under budget pass
     through untouched.
   - PDFs render at `scale = min(6, max(1, TARGET_WIDTH/baseWidth))` then
     `encodeToFit`. File `type` (png/jpeg) is preserved so the Groq route builds
     the correct data-URL media type.
3. **(uncommitted, this session)** — **OMR accuracy: make real OMR the default
   and stop fighting it.** Root cause of "recognition not working": the default
   engine was Groq (a vision LLM that hallucinates pitches), and even when
   Audiveris ran, the server undid the client's high-res work. Changes:
   - `src/app/omr/page.tsx`: default `enginePreference` `'groq'` → `'audiveris'`
     (Audiveris-first + Groq fallback). UI relabeled — Audiveris = "🎼 정밀 인식
     (권장)", Groq = "🚀 빠른 인식 (대략·실험적)". Direct-Railway timeout
     45s → 90s (matches server subprocess + `/api/omr` ceiling). `/health`
     failure no longer permanently disables the direct path (badge only); a
     direct-upload **timeout** no longer poisons `globalRailwayFailed` for the
     session — only a genuine connectivity/CORS error does. Serverless fallback
     now keeps Railway in the loop unless the user explicitly chose Groq
     (`?skipRailway=1` only when Groq is preferred).
   - `audiveris-omr/server.py`: `MAX_WIDTH` 2000 → **2480** (preserve the
     client's ~300 DPI). Forced adaptive binarization is now **off by default**
     (env `OMR_FORCE_BINARIZE=1` re-enables it for A/B) — hand Audiveris a
     high-res grayscale + autocontrast PNG and let its own binarizer work.
     Colored-overlay removal mask made conservative (`sat>40 & min_val>80` →
     `sat>60 & min_val>120`) so it won't erase note heads under warm lighting.
   - **Deploy status: DEPLOYED to both Railway and Vercel prod.**
     - `server.py` → Railway deployment `7f5f2392`, Online, `/health` ok.
     - `page.tsx` + route → Vercel prod project **`music-score`** (alias
       **https://music-score-sigma.vercel.app**). NOTE: this is a *different*
       Vercel project from the `music-platform-pi.vercel.app` named elsewhere in
       this doc — this folder deploys to `music-score`.
     - **Gotcha hit & fixed:** the `music-score` Vercel project had **zero env
       vars**, so the first prod deploy returned HTTP 500
       `{"error":"GROQ_API_KEY가 설정되지 않았습니다."}` — Railway was skipped (no
       `OMR_API_URL`), the browser-direct path was dead (`NEXT_PUBLIC_OMR_API_URL`
       not baked into the bundle), and the Groq fallback had no key. Fix: pushed
       all 5 keys from `.env.local` into Vercel prod (`NEXT_PUBLIC_SUPABASE_URL`,
       `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `GROQ_API_KEY`, `OMR_API_URL`,
       `NEXT_PUBLIC_OMR_API_URL`) then **redeployed** so the `NEXT_PUBLIC_*` vars
       bake into the client bundle (they're build-time inlined — a redeploy is
       mandatory after adding them).
     - **Prod verified end-to-end (2026-06-01):** client bundle now inlines the
       `railway.app` host (browser-direct path live); prod `/api/omr` returns
       HTTP 200 + `X-OMR-Engine: Audiveris` for all three test PNGs — twinkle 28,
       fur-elise 30, ode-to-joy 46 notes. No 500s, no Groq fallback.
     - Earlier local A/B (old vs new server.py) showed no regression, modest
       gains (fur-elise 26→30, ode-to-joy 45→46). Pitch sequences are stable on
       these synthetic PNGs (accuracy ceiling = source-image quality, not
       preprocessing); the real high-res win should show on actual phone
       photos/scans.

4. **(uncommitted, this session — orientation fix + Groq removed) DEPLOYED.**
   Root cause of "real phone photo fails / 인식이 거의 안됨" found and fixed:
   - **THE error = image orientation.** `ImageOps.exif_transpose` was rotating a
     landscape sheet photo to portrait → staff lines vertical → Audiveris "could
     not export since transcription did not complete successfully". Reproduced
     against live Railway: a rotated image returned the exact error; the same
     image upright (even blurry/low-res) returned notes. Wrong orientations fail
     *cleanly* (Audiveris never invents notes), so the fix is safe.
   - **`audiveris-omr/server.py` rewritten:** `omr()` now tries the image
     **as-is → rot90 → rot270** and returns the first orientation that yields real
     `<note>`s (response header `X-OMR-Orient` says which). `preprocess()` split
     into `load_oriented` / `to_audiveris_png` / `run_audiveris` /
     `extract_musicxml`. Failure logging reports *all* attempts (3000-char window).
   - **Groq menu removed entirely** (`src/app/omr/page.tsx`): deleted the "인식 엔진
     선택" panel + `enginePreference` state; `uploadToOmr(file)` is now Audiveris-only
     (dropped the `skipRailway` param and the dead Groq result badge).
   - **Silent Groq fallback disabled** (`src/app/api/omr/route.ts`): an Audiveris
     miss now returns an honest 422 `NO_NOTES_MESSAGE` instead of hallucinated Groq
     output. Groq code kept but gated behind `?groq=1` (client never sends it).
   - **Deploy + verify (2026-06-01):** Railway `railway up` → Online, `/health` ok.
     Re-sent the previously-failing rotated PNG → **HTTP 200, `X-OMR-Orient: rot90`,
     53 notes**; upright page1.png → `as-is`, 53 notes (no regression). Vercel prod
     `vercel deploy --prod --yes` → READY, alias **music-score-sigma.vercel.app**.

5. **(uncommitted, this session — binarization fallback for real photos).**
   New failure: a real **4000×2252 landscape photo** failed Audiveris in *all*
   orientations (`"could not transcribe in any orientation"`), even though it was
   correctly oriented — so the item-4 orientation retry couldn't help. Root cause:
   item-3 turned forced binarization **off** (hand Audiveris grayscale, let its own
   binarizer work). That's ideal for clean scans, but real phone photos have uneven
   lighting/shadows where Audiveris' own binarization drops faint staff lines.
   - **`audiveris-omr/server.py`:** the `omr()` retry loop now sweeps **two modes**:
     grayscale across as-is/rot90/rot270 first (clean-scan fast path), then a
     **binarized** pass across the same orientations (adaptive local threshold,
     rescues photos). First attempt yielding real `<note>`s wins; response adds
     `X-OMR-Mode` (gray|bin) alongside `X-OMR-Orient`. `OMR_FORCE_BINARIZE=1` now
     skips the grayscale pass (binarize-only). Failure detail window 3000→4000 chars.
   - **`src/app/omr/page.tsx`:** direct-OMR error log was truncated to 100 chars —
     which hid the per-orientation reasons. Now logs 1500 chars. Direct-upload
     client timeout 90s→**120s** (the server may now run up to 6 Audiveris passes).
   - **`src/app/api/omr/route.ts`:** Railway-forward AbortController 90s→**120s** to
     match.
   - **Deploy status: DEPLOYED (2026-06-01).** Railway `railway up` → Online,
     `/health` ok. Vercel `vercel deploy --prod --yes` → READY,
     **music-score-sigma.vercel.app**. Smoke test: clean page1.png → HTTP 200,
     `X-Omr-Mode: gray` / `X-Omr-Orient: as-is`, 53 notes (grayscale fast path
     short-circuits before the binarize pass — no regression). **Still TO VERIFY:**
     the original 4000×2252 photo that failed — re-upload it; success should come
     back with `X-Omr-Mode: bin`. If it still fails, the now-untruncated (1500-char)
     client error log shows the exact per-pass Audiveris reason.

6. **(committed + pushed + deployed, 2026-06-02 session) — Loop playback (반복
   재생) + mixer-hide + clear-region.** Distinct from the OMR work above; this is
   the playback/UX side.
   - **Loop drag-select** (`src/features/score-view/ScoreRenderer.tsx`): a
     **"구간 선택"** toggle puts the score into select mode; the user drags from a
     start measure to an end measure and the range is highlighted as a
     semi-transparent yellow band (one rect per system/line, computed from OSMD
     `GraphicSheet.MeasureList` bounding boxes — screen px = `unit * 10 * zoom`).
     Pointer handlers (touch+mouse) only fire in select mode so they never hijack
     scroll. On pointer-up the range commits via `setLoopRange` (auto-enables
     loop) and select mode turns off. A **"구간 해제"** button (X icon) appears
     next to the toggle whenever a `loopRange` exists → calls `clearLoop()`.
     Region rects recompute on `previewRange`/`loopRange`/layout change and via a
     `ResizeObserver` (OSMD `autoResize` reflows on resize → bump `layoutRev`).
   - **Loop state** in `src/store/playerStore.ts`: `loopRange {start,end}|null`,
     `loopEnabled`, `setLoopRange` (commits + enables), `toggleLoopEnabled`,
     `clearLoop` (nulls range + disables). Toolbar (`src/components/Toolbar.tsx`)
     has a Repeat toggle (disabled until a range exists) + a clear chip showing
     `{start}–{end}마디`.
   - **Audio loop** is handled in `MusicPlayer.tsx`'s single audio-clock engine:
     at the range end the playhead resets to the range start (per-measure timing
     `qnSec = 60/bpm`, so tempo changes time-stretch without pitch shift — the
     sampled-synth design already satisfied the "Time-Stretching 연동" requirement
     for free).
   - **Mixer hidden during playback** (`src/features/score-view/ScoreViewPanel.tsx`):
     `{playbackState !== 'playing' && <PartMixer />}` — when the score is playing,
     show only the score and hide the Mute/Solo panel.
   - **Status: committed (`625430e` is the latest, the clear-region button;
     `65a6578` was the loop+mixer feature), pushed to `origin/master`, and
     deployed to Vercel prod (READY).** Verified locally (`/` and `/omr` → 200,
     typecheck clean).

7. **(this session — OpenCV phone-photo normalization) DEPLOYED & VERIFIED
   2026-06-05 via `railway up` (image rebuilt with opencv, deploy complete,
   `/health` 200). Regression gate PASSED: page1.png 53n/32m, page2.png 74n/32m,
   both via `photo[flat]` at 2480px — no clean-scan regression.** Items 2–5 fixed resolution,
   binarization, orientation, and added a binarize fallback, yet real phone photos
   still mis-read pitch / recognize only partially. Remaining root cause: **photo
   geometry + illumination** — Audiveris assumes a flat, orthogonal, evenly-lit
   page; perspective skew shifts staff-line positions (→ wrong pitch) and shadows/
   curl make it abandon systems (→ partial). Nothing in the pipeline corrected that
   (OpenCV wasn't even a dependency). New work — **all in `audiveris-omr/`, none in
   music-score**:
   - **`requirements.txt`:** added `opencv-python-headless==4.10.0.84` (headless →
     no libGL/X11, and `libglib2.0-0` is already in the Dockerfile, so **no
     Dockerfile change needed** — confirmed: it installed cleanly on `railway up`).
     This forced the Docker rebuild on deploy.
   - **`server.py`:** new `photo_preprocess(img)` → normalized grayscale PIL. Pipeline:
     (1) **4-point page detection + perspective warp** (detect on a ~1500px copy,
     apply to full-res) — Canny→contours→`approxPolyDP`, guarded (convex quad,
     50–99% of frame, aspect 0.4–2.5) or it's rejected; (2) **deskew fallback** when
     no clean quad (Hough median angle, clamp ±15°, dead-zone 0.3°); (3)
     **illumination flatten** (divide by large-σ Gaussian background → removes
     shadows, keeps thin staff lines); (4) **medianBlur(3)** denoise. Contract is
     *"improve or pass through"* — every geometric step falls back to the original
     grayscale on any suspicious detection, so a misfire can't break a clean scan.
   - The `omr()` retry loop is restructured from `modes` into an ordered **renderer
     list**: **`photo` → `gray` → `bin`**, each tried across as-is/rot90/rot270,
     returning on the first `<note>`. `photo` is **first** so a phone photo can't get
     a wrong/partial read from the plain grayscale pass and short-circuit the loop;
     `gray` remains right behind it as the clean-scan safety net. Adds response
     header **`X-OMR-Preprocess`** (e.g. `photo[warp,flat]`). `cv2` import is guarded
     (`HAS_CV2`) — if opencv is somehow missing, the `photo` renderer is skipped, not
     a crash. A render exception now logs + continues instead of 500-ing.
   - **`_omrtest/measure.py`** (new harness): POSTs every image in `_omrtest/` to
     `OMR_TARGET` (Railway URL or `http://localhost:8000`), prints notes/measures/
     seconds + the engine headers, and **regression-gates page1.png ≥ 53 notes / 32
     measures**. Manual step for the user: drop real `photoN.jpg` files into
     `_omrtest/` to measure actual phone photos.
   - **Latency note:** worst case is now 3 renderers × 3 orientations = 9 Audiveris
     passes, but the success path is unaffected — photos win on `photo`/as-is, clean
     scans on `photo` or `gray`/as-is, both returning on the first pass. Only a
     genuinely-unreadable image walks the full grid (same property as before, one
     extra renderer).
   - **Verified after deploy (2026-06-05):** `OMR_TARGET=https://audiveris-omr-
     production-6f4e.up.railway.app python _omrtest/measure.py` → page1.png 53n/32m,
     page2.png 74n/32m, no regressions. Clean scans only exercise the `flat` step
     (`photo[flat]`); to see perspective `warp` fire, the user must drop real phone
     photos as `_omrtest/photoN.jpg` and re-run — watch for `X-OMR-Preprocess:
     photo[warp,flat]` and higher note counts. Audiveris can't run on Windows, so
     verification is Railway- or Linux-container-only. **Phase 2 (later):** tune
     Audiveris CLI options, but only after verifying flag names in-container
     (`Audiveris -help`).

8. **(committed `8a5464f`, this session 2026-06-09 — NOT pushed/deployed yet) —
   MusicXML validation report + composer presets + "score won't render but audio
   plays" fix.** Three user-requested fixes on the result page. **Binding
   constraints (still in effect): validation is RULE-BASED ONLY (no AI review);
   the XML is NEVER mutated — download/render always use Audiveris' original.**
   - **Rule-based validation layer** (new `src/lib/musicXmlValidator.ts`):
     `validateMusicXml(xml) → { ok, warnings[] }`, `WarningKind =
     'beat'|'range'|'key'|'duplicate'`. Does its OWN DOM walk (not
     `parseMusicXml`, which merges parts & drops rests/voices/clefs/fifths).
     Checks: per-voice **beat-sum** vs `divisions×beats×4/beat-type` (skips
     first/last measure for anacrusis; tolerance 1 division); **range vs clef**
     (generous MIDI ranges per G/F/C clef → octave-misread suspicion, info-level);
     **cross-part key divergence** (two parts declare different `<fifths>` at the
     same measure — the bug the user actually hit); **duplicate** (same
     voice+onset+pitch). Read-only, never throws.
   - **Validation report panel** (`src/app/omr/page.tsx`): grouped by kind with a
     fixed header + a scrollable list (`max-h-72 overflow-y-auto`) so many
     warnings don't overflow. Labeled "(자동 수정 안 함 · 다운로드는 원본 그대로)".
   - **Composer presets** (`src/app/admin/page.tsx`): native `<datalist
     id="composer-options">` with 10 famous composers (Beethoven, Mozart, Bach,
     Chopin, Tchaikovsky, Schubert, Brahms, Vivaldi, Handel, Debussy) on the
     composer `<input>`. Free-text entry preserved (controlled value/onChange).
   - **"악보는 안 보이는데 음은 재생됨" root cause + fix** (`ScoreRenderer.tsx`):
     **dual-consumer architecture** — visual render (OSMD, STRICT: throws
     "createStaves on undefined" on incomplete clef/attributes/staff structure)
     and audio (`MusicPlayer`'s `useTonePlayer`, which does its OWN fetch + LENIENT
     `parseMusicXml`) are two independent consumers of the same `xmlUrl`. The
     lenient parser yields playable notes even when OSMD's `render()` throws — so
     audio works while nothing draws. Fix: when `loadError` is set AND
     `parsedMeasures` has notes, render a fallback list (per-measure recognized
     pitch names, `n.pitch` from `ParsedNote`) + an explanation that audio plays
     because the player parses the same XML leniently; advise re-scanning a
     sharper/front-on image. Empty/corrupt XML shows the plain error.
   - `src/app/api/omr/route.ts`: pass through Audiveris `X-OMR-Staff` diagnostic
     header.
   - **Status: `npm run build` PASSED (Next 16.2.6 Turbopack, 7/7 static pages, no
     TS/lint errors). Committed as `8a5464f` (5 files, +359/-12), and now PUSHED to
     `origin/master` + DEPLOYED to Vercel prod (music-score-sigma.vercel.app) this
     session.** A botched first commit (`a29daeb`) had a malformed subject from a
     PowerShell here-string leaking into the Bash tool — fixed via `--amend` with a
     bash heredoc; `8a5464f` is the clean one. **Git gotcha:** repo root is
     `E:\project` (whole monorepo), so `git add -A` stages unrelated projects —
     stage the specific music-score files only.

9. **(committed `08e641d`, pushed + deployed 2026-06-09/10) — OSMD octave-shift
   render repair.** Root cause of "audio plays but score won't draw" in a NEW case:
   Audiveris occasionally emits an `<octave-shift>` "start" with no matching "stop"
   (or vice-versa); OSMD's `calculateOctaveShifts` then dereferences an undefined
   end timestamp and `render()` throws
   `"Cannot read properties of undefined (reading 'realValue')"` → audio but no
   visible score. Fix is **render-only, XML never mutated** (same binding constraint
   as item 8):
   - **`src/lib/sanitizeForOsmd.ts`** (new): `sanitizeForOsmd(xml)` parses to a DOM,
     matches octave-shift starts→stops per `number` (bracket id) in document order,
     removes ONLY unmatched directions (balanced 8va/8vb preserved), drops now-empty
     `<direction-type>`/`<direction>` wrappers, re-serializes and restores the
     `<?xml ?>` prolog (XMLSerializer drops it; OSMD's loader requires it). Operates
     on an in-memory copy used purely for rendering — the downloaded/stored MusicXML
     stays the untouched Audiveris original. Guarded: no-op if no `octave-shift`
     token, on parse error, or on a `<parsererror>` node.
   - **`src/features/score-view/ScoreRenderer.tsx`**: runs the fetched XML through
     `sanitizeForOsmd` before handing it to OSMD; added a scroll wrapper.
   - **`src/app/omr/page.tsx`**: wired the sanitize path into the result render.
   - **Status: build clean, committed `08e641d`, pushed, Vercel prod deployed.**

10. **(committed `3befb60`, pushed + deployed + verified 2026-06-10) — Phase A:
    server preprocessing strengthening** (plan `merry-swimming-cosmos.md`, Phase A).
    Closed the two gaps the plan identified in `audiveris-omr/server.py` — no new
    deps (PIL `ImageFilter`/numpy/cv2 already imported), no new endpoints:
    - **gray-path deskew:** `to_audiveris_png` now runs the existing `_deskew` on the
      grayscale+autocontrast array (cv2-guarded, `HAS_CV2`) BEFORE
      `scale_for_audiveris`, so the most common inputs (scans/screenshots) get tilt
      correction too — not just the photo path. Emits a `deskew±X.X` token in
      `X-OMR-Preprocess`. (Only fires on a genuinely tilted image that falls through
      to the gray renderer; frontal PNGs win on `photo` first, so no deskew expected
      there.)
    - **unsharp mask:** new shared `_sharpen(img)` =
      `UnsharpMask(radius=1.2, percent=80, threshold=3)` (conservative — over-sharpen
      adds noise that hurts Audiveris' binarizer), applied to BOTH the gray
      (`to_audiveris_png`, skipped when `force_binarize`) and photo
      (`render_photo_png`) renderers before scaling; bin renderer excluded. Env
      switch `OMR_UNSHARP` (default on, `=0` disables for A/B). Emits a `sharp` token.
    - **`X-OMR-Staff` diagnostic header:** new `staff_diagnostics(stdout)` scrapes
      Audiveris SCALE/interline/staff/barline/brace lines from stdout (≤200 chars,
      header omitted if empty) so recognition quality can be diagnosed without
      changing pipeline behavior. (`route.ts` already passes this header through —
      item 8.)
    - **Deploy + verify (2026-06-10):** `railway up --service audiveris-omr --detach`
      → deployment `0e753dc1` SUCCESS, `/health` 200. POST `test-ode-to-joy.png` →
      HTTP 200, 23 notes, valid MusicXML 4.0.3,
      `x-omr-preprocess: photo[flat] sharp final=(2480, 1395)` (sharp confirmed),
      `x-omr-staff` populated with Audiveris SCALE/Beam diagnostics (new header
      confirmed). No regression. Phases B (`musicXmlValidator.ts`) and C (result-page
      panel + `route.ts` header passthrough) of the same plan were already landed as
      part of item 8 — **the whole `merry-swimming-cosmos.md` plan is now complete,
      deployed, and verified.**

11. **(committed `1c37d94`, this session 2026-06-11 — NOT pushed/deployed yet) —
    Downloadable measure-duration REPAIR for MuseScore editing.** User report: an
    OMR'd 6/8 score opened in MuseScore only accepts ~5/8 of notes per bar when
    edited — the rest spills into the next bar (and over-full bars overflow). Root
    cause is **Audiveris misreading note DURATIONS** (eighth↔quarter swaps, dropped
    augmentation dots), so each measure's note/rest `<duration>` sum ≠ its declared
    time signature; `<time>` and `<divisions>` themselves are correct. MuseScore
    strictly enforces the meter, so SHORT bars lock out the missing beats and OVER
    bars overflow. The *correct* rhythm is unrecoverable from OMR — but every bar
    can be normalized to exactly its nominal length so it opens clean and editable.
    **Binding constraints honored:** rule-based/deterministic only (no AI, no keys,
    no cost/latency); the canonical "MusicXML 다운로드" stays byte-identical — repair
    is a **separate, opt-in** download only; the in-app validator stays read-only.
    - **`src/lib/repairMeasureDuration.ts`** (new, ~315 lines) — the *mutating*
      counterpart to the read-only `musicXmlValidator.ts`, mirroring its parsing
      conventions (DOMParser, `:scope > measure`, per-part divisions/beats/beat-type,
      `expected = divisions×beats×4/beat-type`, chord = non-voice-advancing).
      `repairMeasureDurations(xml) → { xml, changes: RepairChange[] }` where each
      change is `{part, measure, voice, diffBeats, action:'padded'|'trimmed'}`.
      - `buildComponents(divisions)`: note-type table (whole … 32nd, with dots),
        `units = mult × divisions`, filtered to integer units, sorted largest-first
        — so it's **divisions-aware**, not hardcoded.
      - SHORT bars → append rests decomposed greedily into clean note types after
        the last note (leftover that maps to no clean type becomes a duration-only
        rest — valid MusicXML, `<type>` is optional).
      - OVER bars → pop whole trailing note-groups (a non-chord note + its trailing
        `<chord/>` siblings) while that doesn't undershoot, then clamp the new last
        group's `<duration>`/`<type>`/`<dot>`; pad back with rests if it undershot.
      - **Conservative scope:** skips measures with `<backup>`/`<forward>` (explicit
        cursor moves) and any multi-voice measure — only the common single-voice OMR
        melody case is touched, to avoid corrupting complex bars. Returns the input
        unchanged (`changes: []`) on parse error, `<parsererror>`, or no-op.
    - **`src/app/omr/page.tsx`**: memoized `repaired = repairMeasureDurations(effectiveXml)`
      next to the existing `validation` memo; a new **"박자 보정본 다운로드 (MuseScore
      편집용) · N마디"** secondary button appears **only when `repaired.changes.length > 0`**,
      downloading `{base}_fixed.xml`. The original "MusicXML 다운로드" button is
      untouched (still `effectiveXml`, byte-identical). Validation-panel note updated
      to clarify: canonical download = original; meter-broken bars editable via the
      "박자 보정본".
    - **Verified against the user's real file** (`KakaoTalk_20260611_152339104.xml`:
      2 parts, divisions=4, 6/8, 13 measures) by running the ACTUAL source `.ts` via
      Node v24 native type-stripping + `linkedom` as `globalThis.DOMParser`:
      **22 non-conforming measures → 0** after repair (both short, e.g. m1=9/12 &
      m13=8/12, and over, e.g. m3=14/12 & m9=15/12), 22 changes applied, well-formed
      output. `tsc --noEmit` clean. Test note: @xmldom/xmldom lacks `querySelector`
      (only getElementsByTagName) — the browser and the validator use `querySelector`
      fine, so `linkedom` was injected for the test harness, not a code change.
    - **Honest limitation (told to user):** this fixes bar *lengths* (unlocks
      editing) but cannot recover the correct *rhythm* — padded rests / trimmed
      notes are placeholders the user still corrects by ear in MuseScore.

## What Worked

- **Filling the 4.5MB budget with max quality** instead of a fixed low cap.
  Real sheet music is line art (white bg + thin black lines) → **lossless PNG
  stays ~0.18MB even at 2480px**, so the old 1700px/~150 DPI cap was discarding
  resolution for no reason. Verified in real Chromium (Playwright): sheet-like
  page → PNG @2480px 0.18MB; incompressible-noise worst cases cascade to JPEG +
  shrink, all landing < 4.3MB (3.77MB and 4.05MB).
- Vercel CLI deploy returning `readyState: READY` as the deploy confirmation.

## What Didn't Work / Avoid

- **Old approach:** forcing every upload to 1700px PNG → ~150 DPI → starved
  Audiveris → low recognition rate. (This is what `c098eab` fixed.)
- Don't pipe python through PowerShell (parse errors) — use Bash + heredoc.
- Don't try to raise quality past 4.5MB through `/api/omr` — 413 at the edge.

## Next Steps

_All committed/pushed/deployed work is done; the open items below are
interactive/in-browser VERIFICATION only — nothing is blocked on code._

00. **(items 8–10) Interactive verification on prod (music-score-sigma.vercel.app).**
    Code is live; these were not click-tested this session. (a) **Validation panel**
    (item 8): renders + scrolls with many warnings; clean score shows "이상 없음";
    composer field shows the 10-name dropdown yet accepts free text; on a score that
    fails to render, the recognized-notes fallback list appears and audio still plays.
    (b) **Octave-shift repair** (item 9): upload a score that previously drew nothing
    "but audio played" (unbalanced `<octave-shift>`) → confirm it now renders and the
    downloaded XML is byte-identical to the Audiveris original. (c) **Phase A deskew**
    (item 10): the `photo`/`gray` renderers short-circuit on frontal images, so to see
    the `deskew±X.X` token fire you must upload a deliberately TILTED scan/screenshot
    (one that falls through to the gray renderer) and watch `X-OMR-Preprocess`; also
    spot-check `X-OMR-Staff` shows up in the response for diagnosing recognition
    quality. A/B the unsharp step with `OMR_UNSHARP=0` on Railway if sharpening ever
    looks like it's adding noise.
0. **Loop feature (item 6) — still TO VERIFY interactively in the browser.** Code
   committed/pushed/deployed and serves 200, but the actual drag-select → loop
   playback wasn't click-tested this session. Open the prod app or local dev,
   click 구간 선택, drag across a few measures, press play, and confirm: (a) the
   range highlights, (b) playback loops start→end seamlessly, (c) 구간 해제 clears
   it, (d) the Mute/Solo mixer disappears while playing. Watch for region-rect
   misalignment after resize / phone 0.5 zoom.
1. **(OMR) Verify the binarization fallback (item 5)** — re-upload the original
   4000×2252 landscape photo that failed all orientations; success should return
   `X-Omr-Mode: bin`. If it still fails, the now-untruncated (1500-char) client
   error log shows the exact per-pass Audiveris reason.
2. **Verify on a real phone** with an actual sheet-music photo/scan: with
   Audiveris now the default, does recognition match the original (pitches/key)?
   Check the result engine badge reads **"Audiveris"**, not "Groq".
3. **Preprocessing A/B** (optional): compare `OMR_FORCE_BINARIZE=1` vs default
   (off) on the same sample — confirm grayscale-to-Audiveris reads ≥ as many
   correct notes as the old forced binarization.
4. If a heavy score OOMs at 2480px (JVM heap → 500): set `-Xmx` in
   `JAVA_TOOL_OPTIONS` in `server.py`'s subprocess env (currently unset).
5. Watch for phone rendering/scroll regressions in `ScoreRenderer.tsx` (cursor
   overlay sync, 0.5 zoom).

## Verification Discipline (per /verify)

Verification = run the app at its real surface and capture output; not tests/
typecheck. For OMR changes the surface is the browser upload flow → `/api/omr`
response → rendered score. Client image encoding was validated by porting
`encodeToFit` into a real Chromium context (Playwright), not by unit-importing.
