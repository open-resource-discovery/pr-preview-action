#!/usr/bin/env python3
from pathlib import Path
import sys

VENDOR_ROOT = Path(__file__).resolve().parent / "vendor"
sys.path.insert(0, str(VENDOR_ROOT))

import segno  # type: ignore  # noqa: E402


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: generate_qr_svg.py <url> <output-svg>", file=sys.stderr)
        return 1

    url = sys.argv[1].strip()
    output = Path(sys.argv[2])

    output.parent.mkdir(parents=True, exist_ok=True)

    qr = segno.make(url, error="m", micro=False)
    qr.save(output, kind="svg", scale=4, border=2, xmldecl=False)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
