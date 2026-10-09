#!/usr/bin/env python3
"""Fail if view code uses raw `.animation(` / `withAnimation` outside Rawkoon/Motion/.

View code goes through `.rawkoonMotion(_:value:)` / `withRawkoonMotion` so Reduce
Motion is honored. A site that already gates on Reduce Motion itself carries a
`// motion-ok: <reason>` comment on the nearest preceding non-blank line; a whole
file opts out with `// motion-ok-file: <reason>`. This replaces a SwiftLint custom
rule, which needs SourceKit and is skipped on Linux CI.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

IOS = Path(__file__).resolve().parent.parent
SOURCES = IOS / "Rawkoon"
KIT = SOURCES / "Motion"
RAW = re.compile(r"(\.animation\(|\bwithAnimation\s*[({])")
SITE_OK = re.compile(r"motion-ok:\s*\S")
FILE_OK = re.compile(r"motion-ok-file:\s*\S")
HINT = (
    "Use .rawkoonMotion(_:value:) or withRawkoonMotion so Reduce Motion is honored, "
    "or mark a self-gated site with `// motion-ok: <reason>`."
)


def violations(path: Path) -> list[tuple[int, str]]:
    lines = path.read_text().splitlines()
    if any(FILE_OK.search(line) for line in lines):
        return []
    found = []
    for i, line in enumerate(lines):
        if line.strip().startswith("//") or not RAW.search(line):
            continue
        prev = next((p.strip() for p in reversed(lines[:i]) if p.strip()), "")
        if prev.startswith("//") and SITE_OK.search(prev):
            continue
        found.append((i + 1, line.strip()))
    return found


def main() -> int:
    files = [p for p in sorted(SOURCES.rglob("*.swift")) if KIT not in p.parents]
    failures = [(p, n, code) for p in files for n, code in violations(p)]
    if failures:
        for path, n, code in failures:
            print(f"{path.relative_to(IOS)}:{n}: {code}", file=sys.stderr)
        print(f"raw-animation: {HINT}", file=sys.stderr)
        return 1
    print(f"raw-animation: ok ({len(files)} files scanned)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
