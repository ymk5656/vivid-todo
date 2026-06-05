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

    w, h = img.size
    if w < MIN_WIDTH:
        scale = MIN_WIDTH / w
        img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
        w, h = img.size
    elif w > MAX_WIDTH:
        scale = MAX_WIDTH / w
        img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
        w, h = img.size

    if not force_binarize:
        # Default: hand Audiveris a high-res grayscale image and let its own
        # binarizer do the thresholding. Preserves thin lines/stems best.
        img.save(output_path, format="PNG")
        return f"final={img.size} binarize=off(grayscale)"

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
    return f"final={img_bin.size} binarize=on block={block_size}"


def _resize_for_audiveris(img: Image.Image) -> Image.Image:
    """Clamp width into [MIN_WIDTH, MAX_WIDTH] so Audiveris sees ~300 DPI."""
    w, h = img.size
    if w < MIN_WIDTH:
        scale = MIN_WIDTH / w
        img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    elif w > MAX_WIDTH:
        scale = MAX_WIDTH / w
        img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    return img


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
    proc = _resize_for_audiveris(proc)
    proc.save(output_path, format="PNG")
    return f"{info} final={proc.size}"


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

        for mode_label, render in renderers:
            for orient_label, angle in orientations:
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
                        return PlainTextResponse(
                            xml,
                            headers={
                                "X-OMR-Orient": orient_label,
                                "X-OMR-Mode": mode_label,
                                "X-OMR-Preprocess": render_info[:200],
                            },
                        )
                    tail = (result.stdout + "\n" + result.stderr).strip()[-600:]
                    failures.append(
                        f"[{label} {render_info}] exit 0 but no notes produced. {tail}"
                    )
                else:
                    combined = (result.stdout + "\n" + result.stderr).strip()
                    failures.append(f"[{label} {render_info}] exit {result.returncode}: {combined[-600:]}")

        # Every orientation+mode failed -> genuinely unreadable image. Report all
        # attempts so the failure is diagnosable (not truncated to one log).
        detail = f"[orig={orig_size}] Audiveris could not transcribe in any orientation/mode.\n\n" + "\n\n".join(
            failures
        )
        raise HTTPException(status_code=500, detail=detail[-4000:])
