#!/usr/bin/env python3
"""Fail if user-facing Swift literals are missing from Localizable.xcstrings.

Looks for string literals in Text/Button/Label/navigationTitle/
.searchable(prompt:)/String(localized:)/LocalizedStringKey. Interpolated
strings are matched after rewriting `\\(...)` to %@ and %lld.

Intentional verbatim strings live in scripts/l10n-ignore.txt (one key per
line; # comments). A macbuild Xcode extraction pass should still be run to
confirm nothing else is missing — this grep cannot see every overload.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SWIFT_ROOT = ROOT / "Rawkoon"
CATALOG = ROOT / "Rawkoon" / "Localizable.xcstrings"
IGNORE_FILE = ROOT / "scripts" / "l10n-ignore.txt"

CALL_RE = re.compile(
    r"""(?:
        \bText\(\s*
        | \bButton\(\s*
        | \bLabel\(\s*
        | \.navigationTitle\(\s*
        | \.searchable\([^)]*prompt:\s*
        | String\(\s*localized:\s*
        | LocalizedStringKey\(\s*
        )
        "((?:[^"\\]|\\.)*)"
    """,
    re.VERBOSE | re.DOTALL,
)

INTERP_RE = re.compile(r"\\\([^)]*\)")


SWIFT_UNICODE = re.compile(r"\\u\{([0-9a-fA-F]+)\}")


def unescape(raw: str) -> str:
    def scalar(match: re.Match[str]) -> str:
        return chr(int(match.group(1), 16))

    text = SWIFT_UNICODE.sub(scalar, raw)
    return text.replace(r"\"", '"').replace(r"\\", "\\")


def catalog_keys(path: Path) -> set[str]:
    data = json.loads(path.read_text())
    return set(data.get("strings", {}))


def ignore_keys(path: Path) -> set[str]:
    if not path.exists():
        return set()
    keys: set[str] = set()
    for line in path.read_text().splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        keys.add(stripped)
    return keys


def candidate_keys(literal: str) -> set[str]:
    """Return catalog-shaped keys this Swift literal might extract as."""
    keys = {literal}
    if INTERP_RE.search(literal):
        keys.add(INTERP_RE.sub("%@", literal))
        keys.add(INTERP_RE.sub("%lld", literal))
        keys.add(INTERP_RE.sub("%lld", INTERP_RE.sub("%@", literal, count=1)))
    return keys


def main() -> int:
    keys = catalog_keys(CATALOG)
    ignored = ignore_keys(IGNORE_FILE)
    missing: list[tuple[str, int, str]] = []

    for swift in sorted(SWIFT_ROOT.rglob("*.swift")):
        text = swift.read_text()
        rel = swift.relative_to(ROOT)
        for match in CALL_RE.finditer(text):
            literal = unescape(match.group(1))
            if not literal or literal in ignored:
                continue
            # Interpolations need Xcode's extractor (format specifiers, nested
            # parens). This gate only fails on plain literals the catalog missed.
            if r"\(" in match.group(1):
                continue
            if any(k in keys or k in ignored for k in candidate_keys(literal)):
                continue
            line = text.count("\n", 0, match.start()) + 1
            missing.append((str(rel), line, literal))

    if missing:
        print("l10n: user-facing literals missing from Localizable.xcstrings:", file=sys.stderr)
        for rel, line, literal in missing:
            print(f"  {rel}:{line}: {literal!r}", file=sys.stderr)
        print(
            f"{len(missing)} missing. Add the key to the catalog or scripts/l10n-ignore.txt.",
            file=sys.stderr,
        )
        return 1

    print(f"l10n: ok ({len(keys)} catalog keys)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
