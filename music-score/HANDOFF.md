# HANDOFF — music-platform

_Last updated: 2026-06-01. Branch `master`. Latest commit `c098eab` (+ uncommitted OMR-accuracy changes, see "Current Progress" items 3–4)._

## Goal

A web app for displaying and playing along with sheet music. Users upload a
sheet-music image or PDF → it's recognized (OMR) into MusicXML → rendered with
a synced cursor/highlight that follows playback (incl. YouTube sync), tuned to
work well on phones. Recent focus: raising OMR **recognition accuracy** and
fixing **mobile playback/UX** issues.

## Deployment & Repo Constraints (READ FIRST)

- **Standalone git repo** at `E:\project\music-platform`, branch `master`,
  **NO git remote**. Do not `git push` — there's nowhere to push.
- **Deploy via Vercel CLI**, not git: `vercel deploy --prod --yes`.
  Prod alias: **https://music-platform-pi.vercel.app**.
  This fix→deploy pattern is user-approved; briefly confirm each prod deploy.
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

1. **Deploy the accuracy changes**: `railway up` (server.py) then
   `vercel deploy --prod --yes` (frontend). Confirm with the user before each.
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
