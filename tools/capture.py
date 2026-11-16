#!/usr/bin/env python3
"""Capture the screenshots in screenshots/ from the running game.

Each shot is a real render of game/index.html driven into a deterministic situation with the
?shot= hook in src/main.js, at 1280x720, then written as a JPEG under the 256 KiB gate cap.

    cd fps01-entry && node serve.ts --port 8125 &
    python3 tools/capture.py

Requires playwright (`pip install playwright`) and a Chromium build; set CHROME to its path if it
is not the default.
"""
import os
import pathlib
import sys

from playwright.sync_api import sync_playwright

CHROME = os.environ.get(
    "CHROME", "/home/ubuntu/.cache/ms-playwright/chromium-1234/chrome-linux/chrome"
)
BASE = os.environ.get("BASE_URL", "http://127.0.0.1:8125/index.html")
OUT = pathlib.Path(__file__).resolve().parent.parent / "screenshots"

SHOTS = [
    ("01-firefight.jpg", "fire", 7),
    ("02-buy.jpg", "buy", 7),
    ("03-plant.jpg", "plant", 7),
    ("04-match-end.jpg", "end", 7),
]


def main() -> int:
    OUT.mkdir(exist_ok=True)
    failures = []
    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path=CHROME,
            args=[
                "--no-sandbox",
                "--use-gl=angle",
                "--use-angle=swiftshader",
                "--enable-unsafe-swiftshader",
                "--hide-scrollbars",
            ],
        )
        page = browser.new_page(viewport={"width": 1280, "height": 720}, device_scale_factor=1)
        page.on("pageerror", lambda e: failures.append(f"pageerror: {e}"))
        page.on("console", lambda m: failures.append(f"console: {m.text}") if m.type == "error" else None)

        for name, shot, seed in SHOTS:
            page.goto(f"{BASE}?shot={shot}&seed={seed}", wait_until="load")
            page.wait_for_function(
                f"window.__CAPTURE_READY__ === {shot!r}", timeout=20000
            )
            page.wait_for_timeout(250)
            error = page.evaluate("window.__IS__ && window.__IS__.stats().error")
            if error:
                failures.append(f"{name}: {error}")
            target = OUT / name
            page.screenshot(path=str(target), type="jpeg", quality=90)
            print(f"{name}: {target.stat().st_size} bytes")
        browser.close()

    if failures:
        print("FAILURES:")
        for f in failures:
            print(" ", f)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
