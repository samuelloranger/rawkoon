#!/usr/bin/env python3
"""Fail if `.environment(model)` is not the outermost WindowGroup modifier.

Overlays, sheets, and alerts attached after `.environment(model)` do not inherit
AppModel — NotificationBannerView then traps on tap. `tabViewBottomAccessory` is
a system-hosted tree that never inherits; pass the model in explicitly
(MiniPlayerView). This grep only checks RawkoonApp.swift; a full static walk of
every overlay/sheet closure is impractical.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

APP = Path(__file__).resolve().parent.parent / "Rawkoon" / "RawkoonApp.swift"


def line_numbers(text: str, pattern: str) -> list[int]:
    return [i + 1 for i, line in enumerate(text.splitlines()) if re.search(pattern, line)]


def main() -> int:
    text = APP.read_text()
    env = line_numbers(text, r"\.environment\(model\)")
    overlays = line_numbers(text, r"\.(overlay|sheet)\b")
    if not env:
        print("env-inject: no .environment(model) in RawkoonApp.swift", file=sys.stderr)
        return 1
    last_env = max(env)
    after = [n for n in overlays if n > last_env]
    if after:
        print(
            "env-inject: .overlay/.sheet after the last .environment(model) "
            f"in RawkoonApp.swift (env@{last_env}, later={after}). "
            "Keep .environment(model) outermost so overlays/sheets inherit AppModel.",
            file=sys.stderr,
        )
        return 1
    print(f"env-inject: ok (.environment(model) outermost at line {last_env})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
