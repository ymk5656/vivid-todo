#!/usr/bin/env python3
"""OMR recognition harness — measure how many notes/measures each fixture yields.

Posts every image in this directory to a running OMR server and prints a table of
note/measure counts plus the engine headers (orientation, mode, preprocess) the
server reports. Use it to:

  * gate regressions — page1.png must keep producing >= the baseline below, or a
    preprocessing change has hurt clean scans;
  * measure real phone photos — drop your own photoN.jpg files in this folder
    (the only manual step) and watch the note counts.

Usage:
    # Against the deployed Railway server:
    OMR_TARGET=https://<app>.up.railway.app python _omrtest/measure.py
    # Against a local docker container (docker run -p 8000:8000 ...):
    OMR_TARGET=http://localhost:8000 python _omrtest/measure.py

Only depends on `requests`. Audiveris cannot run on Windows, so point OMR_TARGET at
Railway or a Linux container — never expect this to work without a live server.
"""
import os
import re
import sys
import time
from pathlib import Path

try:
    import requests
except ImportError:
    sys.exit("pip install requests")

TARGET = os.environ.get("OMR_TARGET", "http://localhost:8000").rstrip("/")
HERE = Path(__file__).parent

# page1.png is a clean reference scan; its known-good counts are the regression gate.
BASELINE = {"page1.png": (53, 32)}

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"}


def counts(xml: str):
    notes = len(re.findall(r"<note[\s>]", xml))
    measures = len(re.findall(r"<measure[\s>]", xml))
    return notes, measures


def main() -> int:
    images = sorted(p for p in HERE.iterdir() if p.suffix.lower() in IMAGE_EXTS)
    if not images:
        print(f"No images found in {HERE}")
        return 1

    print(f"Target: {TARGET}")
    try:
        h = requests.get(f"{TARGET}/health", timeout=10)
        print(f"Health: {h.status_code} {h.text.strip()}")
    except Exception as e:
        print(f"Health check failed: {e}")
    print()

    header = f"{'file':<22}{'notes':>7}{'meas':>6}{'sec':>7}  engine(orient/mode/preprocess)"
    print(header)
    print("-" * len(header))

    regressions = []
    for img in images:
        t0 = time.time()
        try:
            with open(img, "rb") as f:
                r = requests.post(
                    f"{TARGET}/", files={"file": (img.name, f, "image/png")}, timeout=300
                )
            elapsed = time.time() - t0
        except Exception as e:
            print(f"{img.name:<22}  ERROR: {e}")
            continue

        if r.status_code != 200:
            print(f"{img.name:<22}{'--':>7}{'--':>6}{elapsed:>7.1f}  HTTP {r.status_code}: {r.text[:80]}")
            if img.name in BASELINE:
                regressions.append(f"{img.name}: HTTP {r.status_code}")
            continue

        n, m = counts(r.text)
        orient = r.headers.get("X-OMR-Orient", "?")
        mode = r.headers.get("X-OMR-Mode", "?")
        pre = r.headers.get("X-OMR-Preprocess", "")
        print(f"{img.name:<22}{n:>7}{m:>6}{elapsed:>7.1f}  {orient}/{mode} {pre}")

        if img.name in BASELINE:
            bn, bm = BASELINE[img.name]
            if n < bn or m < bm:
                regressions.append(f"{img.name}: got {n}n/{m}m, baseline {bn}n/{bm}m")

    print()
    if regressions:
        print("REGRESSIONS:")
        for r in regressions:
            print(f"  ! {r}")
        return 2
    print("No regressions against baseline.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
