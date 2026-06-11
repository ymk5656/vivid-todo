import glob
import os
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path

import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from PIL import Image, ImageFilter, ImageOps

# OpenCV powers the phone-photo normalization (perspective + illumination). It's an
# optional import: if the image wasn't rebuilt with opencv yet, the server still
# starts and simply skips the "photo" renderer instead of crashing on import.
try:
    import cv2

    HAS_CV2 = True
except Exception:  # pragma: no cover - only hit when opencv missing
    HAS_CV2 = False

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

AUDIVERIS_BIN = (
    shutil.which("Audiveris")
    or shutil.which("audiveris")
    or "/opt/Audiveris/bin/Audiveris"
)

MIN_WIDTH = 1800
# Audiveris recommends ~300 DPI. The client already encodes to ~2480px (300 DPI);
# downscaling to 2000 here threw that away. Keep the high resolution.
MAX_WIDTH = 2480

# Audiveris has its own (Sauvola-style) binarization. Feeding it an already
# hard-binarized image breaks thin lines/stems and hurts recognition, so by default
# we hand it a high-res grayscale image and let it binarize. Set OMR_FORCE_BINARIZE=1
# to re-enable the legacy adaptive threshold (useful only for A/B comparison).
FORCE_BINARIZE = os.environ.get("OMR_FORCE_BINARIZE", "0") == "1"

# Unsharp masking (Gaussian-blur subtract) crisps faint staff lines and stems before
# Audiveris' own binarizer sees them, which the guide flags as a top recognition win.
# Conservative parameters: over-sharpening amplifies sensor/JPEG speckle and *hurts*
# binarization. On by default; set OMR_UNSHARP=0 for an A/B run without it. Never
# applied on the already-thresholded "bin" renderer (double emphasis is counterproductive).
UNSHARP = os.environ.get("OMR_UNSHARP", "1") == "1"

# Audiveris' SCALE step recognizes a score best when the staff *interline* (the
# vertical distance between two adjacent staff-line centers) is ~20px — the value a
# clean 300-DPI scan produces. Interline is a physical print dimension, so the width
# clamp above only approximates it: a cropped page or phone photo can sit at the same
# pixel width yet a very different interline. We measure the real interline and scale
# to hit this target (still capped by [MIN_WIDTH, MAX_WIDTH] so we never exceed ~300
# DPI, where Audiveris' Grid step exhausts memory and errors out).
TARGET_INTERLINE = 20.0


def estimate_interline(gray: np.ndarray):
    """Estimate the staff interline (px) via vertical run-length statistics.

    Mirrors how Audiveris' SCALE step works: over many columns, the most frequent
    short black vertical run is the staff-line thickness and the most frequent
    interior white run is the within-staff gap; interline = thickness + gap. Returns
    None when the image is too blank/noisy to trust, so the caller falls back to the
    width-based DPI proxy instead of acting on a bad measurement.
    """
    if gray.ndim != 2:
        return None
    h, w = gray.shape
    if h < 80 or w < 80:
        return None
    # Otsu split (ink = foreground). Measurement only — never fed to Audiveris.
    _, binimg = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    ink = binimg > 0
    # Sample up to ~300 evenly spaced columns; a full-width loop is needless here.
    cols = np.linspace(0, w - 1, min(w, 300)).astype(int)
    black_runs = []
    white_runs = []
    for x in cols:
        col = ink[:, x]
        bounds = np.concatenate(([0], np.flatnonzero(np.diff(col)) + 1, [h]))
        runs = np.diff(bounds)
        is_ink = col[bounds[:-1]]
        for i, length in enumerate(runs):
            if is_ink[i]:
                black_runs.append(length)
            elif 0 < i < len(runs) - 1:  # interior gaps only (skip top/bottom margin)
                white_runs.append(length)

    def _mode(values, max_len):
        arr = np.fromiter((v for v in values if 1 <= v <= max_len), dtype=np.int32)
        if arr.size < 50:
            return None
        return int(np.bincount(arr).argmax())

    # Staff lines are thin (≤~12px even upscaled); within-staff gaps are ≤~60px.
    line_thk = _mode(black_runs, 12)
    gap = _mode(white_runs, 60)
    if not line_thk or not gap:
        return None
    interline = float(line_thk + gap)
    if interline < 5 or interline > 80:  # implausible — distrust it
        return None
    return interline


def scale_for_audiveris(img: Image.Image):
    """Resize a grayscale PIL image so its staff interline lands near ~20px.

    Returns (image, info). Measures the real interline and scales toward
    TARGET_INTERLINE, clamping the resulting width into [MIN_WIDTH, MAX_WIDTH] so we
    stay near 300 DPI and never trip Audiveris' Grid step. Falls back to the legacy
    width clamp when the interline can't be measured (blank/near-blank pages).
    """
    w, h = img.size
    interline = estimate_interline(np.asarray(img))
    if interline:
        target_w = w * (TARGET_INTERLINE / interline)
        new_w = int(min(MAX_WIDTH, max(MIN_WIDTH, round(target_w))))
        if new_w != w:
            img = img.resize((new_w, max(1, round(h * new_w / w))), Image.LANCZOS)
        eff = interline * new_w / w
        return img, f"interline {interline:.0f}->{eff:.0f}px w{w}->{new_w}"

    # Unmeasurable: legacy width clamp (approximate ~300 DPI by pixel width).
    if w < MIN_WIDTH:
        scale = MIN_WIDTH / w
        img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    elif w > MAX_WIDTH:
        scale = MAX_WIDTH / w
        img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    return img, f"width-clamp w{w}->{img.size[0]}"


def load_oriented(input_path: str):
    """Open the image and apply EXIF orientation. Returns (PIL image, orig_size)."""
    img = Image.open(input_path)
    orig_size = img.size
    # Respect camera capture flags. NOTE: this can rotate a sheet so its staff
    # lines end up vertical (e.g. a landscape capture flagged for portrait
    # rotation). When that happens Audiveris fails transcription, so the caller
    # retries other orientations - see omr().
    img = ImageOps.exif_transpose(img)
    return img, orig_size


def _sharpen(img: Image.Image) -> Image.Image:
    """Unsharp-mask a grayscale image to crisp faint staff lines/stems.

    No-op when OMR_UNSHARP=0. Conservative radius/percent so we sharpen edges
    without amplifying speckle into Audiveris' binarizer.
    """
    if not UNSHARP:
        return img
    return img.filter(ImageFilter.UnsharpMask(radius=1.2, percent=80, threshold=3))


def to_audiveris_png(img: Image.Image, output_path: str, force_binarize: bool = False) -> str:
    """Render a PIL image into the grayscale (or binarized) PNG Audiveris ingests.

    Returns a short human-readable info string describing what was produced.
    """
    # Remove colored highlights (like blue playback cursor overlays) before grayscaling
    if img.mode in ("RGB", "RGBA"):
        arr = np.array(img)
        rgb = arr[:, :, :3].astype(np.int16)
        r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
        max_val = np.maximum(np.maximum(r, g), b)
        min_val = np.minimum(np.minimum(r, g), b)
        sat = max_val - min_val
        # Only knock out clearly colored, clearly light pixels (e.g. a blue/green
        # playback-cursor overlay). Conservative thresholds so we don't accidentally
        # erase note heads/stems under warm scanner lighting or off-white paper.
        mask = (sat > 60) & (min_val > 120)
        arr[:, :, :3][mask] = 255
        img = Image.fromarray(arr)

    # Convert to grayscale and stretch contrast (improves line/stem extraction)
    img = img.convert("L")
    img = ImageOps.autocontrast(img, cutoff=2)

    # Deskew the most common inputs (scans / screenshots / already-frontal photos)
    # that take this gray path. Until now _deskew ran only on the photo renderer, so a
    # slightly tilted scan lost accuracy at Audiveris' SCALE/Staff stages. Reuse the
    # same guarded routine (0.3 deg dead-zone, <=15 deg cap); skip when cv2 is absent.
    deskew_info = ""
    if HAS_CV2:
        rotated, angle = _deskew(np.asarray(img))
        if angle:
            img = Image.fromarray(rotated)
            deskew_info = f" deskew{angle:+.1f}"

    # Unsharp-mask before scaling so faint staff lines/stems survive binarization.
    # Skip on the force_binarize path: that renderer thresholds the image itself, and
    # sharpening before a hard threshold just amplifies speckle into the binary output.
    sharp_info = ""
    if not force_binarize:
        img = _sharpen(img)
        sharp_info = " sharp" if UNSHARP else ""

    # Scale so the staff interline lands near ~20px (Audiveris' SCALE sweet spot),
    # falling back to the width clamp when the interline can't be measured.
    img, scale_info = scale_for_audiveris(img)
    scale_info = scale_info + deskew_info + sharp_info
    w, h = img.size

    if not force_binarize:
        # Default: hand Audiveris a high-res grayscale image and let its own
        # binarizer do the thresholding. Preserves thin lines/stems best.
        img.save(output_path, format="PNG")
        return f"final={img.size} {scale_info} binarize=off(grayscale)"

    # Legacy adaptive thresholding (OMR_FORCE_BINARIZE=1), kept for A/B comparison.
    # block_size scales dynamically with image width (~1.25% of width, odd number)
    block_size = int(w / 80) | 1
    if block_size < 11:
        block_size = 11

    bg = img.filter(ImageFilter.BoxBlur(block_size // 2))
    arr_img = np.array(img, dtype=np.int16)
    arr_bg = np.array(bg, dtype=np.int16)
    bin_arr = np.where(arr_img < (arr_bg - 9), 0, 255).astype(np.uint8)
    img_bin = Image.fromarray(bin_arr)
    img_bin.save(output_path, format="PNG")
    return f"final={img_bin.size} {scale_info} binarize=on block={block_size}"


def _resize_for_audiveris(img: Image.Image) -> Image.Image:
    """Scale so Audiveris sees a staff interline near ~20px (~300 DPI)."""
    return scale_for_audiveris(img)[0]


def _order_corners(pts: np.ndarray) -> np.ndarray:
    """Order 4 points as top-left, top-right, bottom-right, bottom-left."""
    rect = np.zeros((4, 2), dtype=np.float32)
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]  # top-left has smallest x+y
    rect[2] = pts[np.argmax(s)]  # bottom-right has largest x+y
    diff = (pts[:, 0] - pts[:, 1])
    rect[1] = pts[np.argmax(diff)]  # top-right: largest x-y
    rect[3] = pts[np.argmin(diff)]  # bottom-left: smallest x-y
    return rect


def _find_page_quad(gray_small: np.ndarray, scale: float):
    """Detect the sheet's 4 corners on a downscaled copy.

    Returns full-resolution ordered corners, or None when no trustworthy quad is
    found. Guardrails reject detections that would distort a clean scan: the quad
    must be convex, cover 50-99% of the frame, and have a sane aspect ratio.
    """
    blur = cv2.GaussianBlur(gray_small, (5, 5), 0)
    edges = cv2.Canny(blur, 50, 150)
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=1)
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None

    h, w = gray_small.shape[:2]
    frame_area = float(w * h)
    for c in sorted(contours, key=cv2.contourArea, reverse=True)[:5]:
        area = cv2.contourArea(c)
        if area < 0.5 * frame_area or area > 0.99 * frame_area:
            continue
        peri = cv2.arcLength(c, True)
        approx = cv2.approxPolyDP(c, 0.02 * peri, True)
        if len(approx) != 4 or not cv2.isContourConvex(approx):
            continue
        rect = _order_corners(approx.reshape(4, 2).astype(np.float32))
        (tl, tr, br, bl) = rect
        max_w = max(np.linalg.norm(br - bl), np.linalg.norm(tr - tl))
        max_h = max(np.linalg.norm(tr - br), np.linalg.norm(tl - bl))
        if max_w < 1 or max_h < 1:
            continue
        aspect = max_w / max_h
        if aspect < 0.4 or aspect > 2.5:
            continue
        return rect / scale  # map corners back to full-resolution coordinates
    return None


def _warp_page(full_gray: np.ndarray, rect: np.ndarray) -> np.ndarray:
    """Flatten the page to a front-facing rectangle via perspective transform."""
    (tl, tr, br, bl) = rect
    max_w = int(max(np.linalg.norm(br - bl), np.linalg.norm(tr - tl)))
    max_h = int(max(np.linalg.norm(tr - br), np.linalg.norm(tl - bl)))
    dst = np.array(
        [[0, 0], [max_w - 1, 0], [max_w - 1, max_h - 1], [0, max_h - 1]],
        dtype=np.float32,
    )
    M = cv2.getPerspectiveTransform(rect.astype(np.float32), dst)
    return cv2.warpPerspective(full_gray, M, (max_w, max_h))


def _deskew(gray: np.ndarray):
    """Rotate to make staff lines horizontal. Returns (image, angle_applied).

    Only small skews (|angle| <= 15 deg) are corrected; a dead-zone below 0.3 deg
    leaves already-straight scans untouched. Larger rotations are page-orientation
    problems the omr() orientation retry handles, not skew.
    """
    edges = cv2.Canny(gray, 50, 150)
    lines = cv2.HoughLinesP(
        edges, 1, np.pi / 180, threshold=200,
        minLineLength=gray.shape[1] // 3, maxLineGap=20,
    )
    if lines is None:
        return gray, 0.0
    angles = []
    for x1, y1, x2, y2 in lines[:, 0, :]:
        if x2 == x1:
            continue
        ang = np.degrees(np.arctan2(float(y2 - y1), float(x2 - x1)))
        if -15 <= ang <= 15:
            angles.append(ang)
    if not angles:
        return gray, 0.0
    angle = float(np.median(angles))
    if abs(angle) < 0.3:
        return gray, 0.0
    h, w = gray.shape[:2]
    M = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
    rotated = cv2.warpAffine(
        gray, M, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE
    )
    return rotated, angle


def _flatten_illumination(gray: np.ndarray) -> np.ndarray:
    """Remove shadows/uneven lighting by dividing out a blurred background.

    A large-sigma Gaussian estimates the local paper brightness; dividing the image
    by it normalizes gradients (phone shadows, page curl) while keeping thin staff
    lines, which are too fine to survive into the background estimate.
    """
    sigma = max(11.0, gray.shape[1] / 20.0)
    bg = cv2.GaussianBlur(gray, (0, 0), sigma).astype(np.float32) + 1.0
    flat = np.clip(gray.astype(np.float32) / bg * 255.0, 0, 255).astype(np.uint8)
    return flat


def photo_preprocess(img: Image.Image):
    """Normalize a phone-camera photo before Audiveris. Returns (grayscale PIL, info).

    Pipeline: page detection + perspective warp (deskew fallback) -> illumination
    flattening -> mild denoise. The contract is "improve or pass through": every
    geometric step is guarded and falls back to the original grayscale on any
    suspicious detection, so a misfire can't break a clean scan (which still has the
    plain "gray" renderer behind it in omr()).
    """
    arr = np.array(img.convert("RGB"))
    # Knock out colored playback-cursor overlays (same conservative rule as
    # to_audiveris_png) in case the photo is of a screen rather than paper.
    rgb16 = arr.astype(np.int16)
    r, g, b = rgb16[:, :, 0], rgb16[:, :, 1], rgb16[:, :, 2]
    sat = np.maximum(np.maximum(r, g), b) - np.minimum(np.minimum(r, g), b)
    arr[(sat > 60) & (np.minimum(np.minimum(r, g), b) > 120)] = 255
    full_gray = cv2.cvtColor(arr, cv2.COLOR_RGB2GRAY)

    H, W = full_gray.shape[:2]
    steps = []

    # 1. Perspective correction. Detect on a ~1500px copy (fast, robust), then apply
    #    the resulting geometry to the full-resolution image.
    long_side = max(H, W)
    scale = 1500.0 / long_side if long_side > 1500 else 1.0
    if scale < 1.0:
        small = cv2.resize(full_gray, (int(W * scale), int(H * scale)), interpolation=cv2.INTER_AREA)
    else:
        small = full_gray
    rect = _find_page_quad(small, scale)
    if rect is not None:
        work = _warp_page(full_gray, rect)
        steps.append("warp")
    else:
        work, angle = _deskew(full_gray)
        if angle:
            steps.append(f"deskew{angle:+.1f}")

    # 2. Illumination flattening (shadows / uneven phone lighting).
    work = _flatten_illumination(work)
    steps.append("flat")

    # 3. Mild denoise to suppress JPEG/sensor speckle without eroding stems.
    work = cv2.medianBlur(work, 3)

    return Image.fromarray(work), "photo[" + ",".join(steps) + "]"


def render_photo_png(img: Image.Image, output_path: str) -> str:
    """photo_preprocess -> autocontrast -> resize -> save grayscale PNG for Audiveris."""
    proc, info = photo_preprocess(img)
    proc = ImageOps.autocontrast(proc.convert("L"), cutoff=2)
    proc = _sharpen(proc)
    proc = _resize_for_audiveris(proc)
    proc.save(output_path, format="PNG")
    sharp_info = " sharp" if UNSHARP else ""
    return f"{info}{sharp_info} final={proc.size}"


def run_audiveris(input_path: str, output_dir: str):
    """Run Audiveris in batch/export mode. Returns the CompletedProcess."""
    return subprocess.run(
        [AUDIVERIS_BIN, "-batch", "-export", "-output", output_dir, input_path],
        capture_output=True,
        text=True,
        timeout=120,
        env={**os.environ, "JAVA_TOOL_OPTIONS": "-Djava.awt.headless=true"},
    )


def extract_musicxml(output_dir: str):
    """Pull MusicXML out of Audiveris' export dir. Returns the XML string or None."""
    mxl_files = glob.glob(os.path.join(output_dir, "**/*.mxl"), recursive=True)
    if mxl_files:
        with zipfile.ZipFile(mxl_files[0]) as z:
            for name in z.namelist():
                if name.endswith(".xml") and not name.startswith("META"):
                    return z.read(name).decode("utf-8")

    xml_files = glob.glob(os.path.join(output_dir, "**/*.xml"), recursive=True)
    if xml_files:
        with open(xml_files[0]) as f:
            return f.read()
    return None


def has_notes(xml: str) -> bool:
    return "<note " in xml or "<note>" in xml


def staff_diagnostics(stdout: str) -> str:
    """Pull Audiveris' SCALE/Staff/interline notes from its stdout (best-effort).

    Returns a short ';'-joined digest for the X-OMR-Staff header so the quality of the
    read is diagnosable from the client, or "" when nothing relevant was logged. Never
    affects the pipeline — purely informational.
    """
    keys = ("interline", "scale", "staff", "no staff", "barline", "brace")
    picks = []
    for line in stdout.splitlines():
        low = line.lower()
        if any(k in low for k in keys):
            # Drop the leading timestamp/level/logger prefix; keep the message tail.
            msg = line.split(" - ", 1)[-1].strip() if " - " in line else line.strip()
            if msg and msg not in picks:
                picks.append(msg)
    return "; ".join(picks)[:200]


def score_musicxml(xml: str):
    """Rule-based completeness score for one candidate read.

    Returns (has_time, good_measures, note_units, total_measures). Compared as a
    tuple, higher is better:
      has_time      - 1 if a parseable time signature exists. Ranked first because
                      a read with the time sig is far more useful (the downstream
                      measure-duration repair needs it) -- a renderer that recovers
                      more dots but drops the time sig must NOT outrank one that kept
                      it.
      good_measures - measures whose summed note duration equals the expected
                      divisions*beats*4/beat-type. Correct structure beats raw count.
      note_units    - notes + augmentation dots, the final tiebreak: among equally
                      well-formed reads, prefer the one that captured the most
                      symbols (this is where the dot-friendly 'bin' renderer wins).

    'good_measures == total_measures' (with total>0 and has_time) means a perfect
    read; the caller short-circuits on it so clean scans stay single-pass.
    """
    import re as _re
    import xml.etree.ElementTree as _ET

    try:
        root = _ET.fromstring(_re.sub(r"<!DOCTYPE[^>]*>", "", xml))
    except Exception:
        return (0, 0, 0, 0)

    notes = root.findall(".//note")
    dots = sum(len(n.findall("dot")) for n in notes)
    note_units = len(notes) + dots
    total_measures = len(root.findall(".//measure"))

    has_time = 0
    good = 0
    for part in root.findall(".//part"):
        divisions = None
        beats = beattype = None
        for m in part.findall("measure"):
            attr = m.find("attributes")
            if attr is not None:
                d = attr.find("divisions")
                if d is not None and d.text and d.text.strip().isdigit():
                    divisions = int(d.text)
                t = attr.find("time")
                if t is not None:
                    b, bt = t.find("beats"), t.find("beat-type")
                    if b is not None and bt is not None and b.text and bt.text:
                        beats, beattype = int(b.text), int(bt.text)
                        has_time = 1
            if divisions and beats:
                expected = divisions * beats * 4 // beattype
                total = 0
                for ch in m:
                    if ch.tag == "note":
                        if ch.find("chord") is not None:
                            continue
                        dur = ch.find("duration")
                        total += int(dur.text) if dur is not None and dur.text else 0
                    elif ch.tag == "backup":
                        dur = ch.find("duration")
                        total -= int(dur.text) if dur is not None and dur.text else 0
                    elif ch.tag == "forward":
                        dur = ch.find("duration")
                        total += int(dur.text) if dur is not None and dur.text else 0
                if total == expected:
                    good += 1
    return (has_time, good, note_units, total_measures)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/", response_class=PlainTextResponse)
@app.post("", response_class=PlainTextResponse)
async def omr(file: UploadFile = File(...)):
    with tempfile.TemporaryDirectory() as tmpdir:
        suffix = Path(file.filename or "score.png").suffix or ".png"
        raw_path = os.path.join(tmpdir, f"raw{suffix}")
        with open(raw_path, "wb") as f:
            f.write(await file.read())

        try:
            base_img, orig_size = load_oriented(raw_path)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Image preprocessing failed: {e}")

        # Audiveris only transcribes when staff lines run horizontally. A phone
        # photo can land rotated (wrong/over-applied EXIF orientation), making the
        # staves vertical -> "transcription did not complete successfully". A wrong
        # orientation fails cleanly (it never invents notes), so we try the image
        # as-is first, then rotated 90 deg / 270 deg.
        #
        # A correctly-oriented *real photo* can still fail: uneven lighting, shadows,
        # and perspective leave faint staff lines that Audiveris' own (global-ish)
        # binarizer drops. So after grayscale fails in every orientation, we retry the
        # whole set with our adaptive local-threshold binarization, which recovers the
        # lines on photos. Clean scans succeed on the first grayscale attempt and never
        # reach the binarize pass, so this only adds latency to images that were
        # failing outright anyway.
        orientations = [("as-is", 0), ("rot90", 90), ("rot270", 270)]
        # Renderers, tried in order; we return on the first one that yields notes.
        #   photo  - OpenCV document normalization (perspective + illumination) for
        #            phone-camera photos. FIRST so a photo doesn't get a wrong/partial
        #            read from the plain grayscale pass and short-circuit the loop.
        #   gray   - high-res grayscale, Audiveris does its own binarization. Best for
        #            clean scans; also the safety net if photo-preprocess misdetects.
        #   bin    - legacy adaptive threshold, last-ditch for faint staff lines.
        # Each renderer takes (work_img, output_path) and returns an info string.
        renderers = []
        if HAS_CV2:
            renderers.append(("photo", render_photo_png))
        renderers.append(("gray", lambda w, p: to_audiveris_png(w, p, force_binarize=False)))
        renderers.append(("bin", lambda w, p: to_audiveris_png(w, p, force_binarize=True)))
        # When the deployment is pinned to forced binarization for A/B testing,
        # don't waste runs on the other passes.
        if FORCE_BINARIZE:
            renderers = [("bin", lambda w, p: to_audiveris_png(w, p, force_binarize=True))]

        failures = []
        candidates = []  # successful reads, scored; we keep the most complete one

        # The renderers are complementary: 'photo'/'gray' tend to nail the time
        # signature and overall structure, while 'bin' (adaptive threshold) reads
        # augmentation dots best. Returning on the FIRST renderer that produced any
        # notes used to lock in a partial read and discard a better later one. So we
        # now collect every renderer's read and pick the highest-scoring (see
        # score_musicxml). To keep clean scans single-pass we short-circuit the
        # moment a read is perfect (every measure's duration checks out), and once an
        # orientation is known to work we stop re-trying the wrong orientations for
        # the remaining renderers.
        known_orient = None

        def build_headers(cand):
            h = {
                "X-OMR-Orient": cand["orient"],
                "X-OMR-Mode": cand["mode"],
                "X-OMR-Preprocess": cand["info"][:200],
                "X-OMR-Score": ",".join(str(x) for x in cand["score"]),
            }
            if cand["staff"]:
                h["X-OMR-Staff"] = cand["staff"]
            return h

        for mode_label, render in renderers:
            orients = (
                orientations
                if known_orient is None
                else [o for o in orientations if o[0] == known_orient]
            )
            for orient_label, angle in orients:
                label = f"{orient_label}-{mode_label}"
                work = base_img.rotate(-angle, expand=True) if angle else base_img
                input_path = os.path.join(tmpdir, f"input_{label}.png")
                try:
                    render_info = render(work, input_path)
                except Exception as e:
                    failures.append(f"[{label}] render failed: {e}")
                    continue

                output_dir = os.path.join(tmpdir, f"out_{label}")
                os.makedirs(output_dir, exist_ok=True)

                try:
                    result = run_audiveris(input_path, output_dir)
                except subprocess.TimeoutExpired:
                    failures.append(f"[{label} {render_info}] timed out after 120s")
                    continue

                if result.returncode == 0:
                    xml = extract_musicxml(output_dir)
                    if xml and has_notes(xml):
                        known_orient = orient_label  # lock in the working orientation
                        score = score_musicxml(xml)
                        cand = {
                            "mode": mode_label,
                            "orient": orient_label,
                            "info": render_info,
                            "staff": staff_diagnostics(result.stdout),
                            "score": score,
                            "xml": xml,
                        }
                        candidates.append(cand)
                        has_time, good, _units, total = score
                        # Perfect read -> no later renderer can beat it; return now
                        # so clean scans never pay for the extra passes.
                        if has_time and total > 0 and good == total:
                            return PlainTextResponse(xml, headers=build_headers(cand))
                        break  # this renderer's read is in; move to the next renderer
                    tail = (result.stdout + "\n" + result.stderr).strip()[-600:]
                    failures.append(
                        f"[{label} {render_info}] exit 0 but no notes produced. {tail}"
                    )
                else:
                    combined = (result.stdout + "\n" + result.stderr).strip()
                    failures.append(f"[{label} {render_info}] exit {result.returncode}: {combined[-600:]}")

        # At least one renderer produced notes -> return the most complete read.
        if candidates:
            best = max(candidates, key=lambda c: c["score"])
            headers = build_headers(best)
            # Record the also-rans so the choice is auditable from the response.
            headers["X-OMR-Candidates"] = "; ".join(
                f"{c['mode']}:{','.join(str(x) for x in c['score'])}" for c in candidates
            )
            return PlainTextResponse(best["xml"], headers=headers)

        # Every orientation+mode failed -> genuinely unreadable image. Report all
        # attempts so the failure is diagnosable (not truncated to one log).
        detail = f"[orig={orig_size}] Audiveris could not transcribe in any orientation/mode.\n\n" + "\n\n".join(
            failures
        )
        raise HTTPException(status_code=500, detail=detail[-4000:])
