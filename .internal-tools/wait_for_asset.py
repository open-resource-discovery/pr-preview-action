#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sys
import time
import urllib.error
import urllib.request

PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


def fetch(url: str) -> tuple[int, str, bytes]:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "pr-preview-action/1.0"},
    )
    with urllib.request.urlopen(request) as response:
        status = getattr(response, "status", response.getcode())
        content_type = response.headers.get("Content-Type", "")
        body = response.read()
        return status, content_type, body


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--attempts", type=int, default=1)
    parser.add_argument("--interval-seconds", type=int, default=5)
    parser.add_argument("--label", default="asset")
    parser.add_argument("--expect", choices=["any", "png"], default="any")
    args = parser.parse_args()

    url = args.url.strip()
    if not url.startswith(("http://", "https://")):
        print(f"{args.label.capitalize()} URL is not absolute. Skipping.")
        return 0

    for attempt in range(1, args.attempts + 1):
        try:
            status, content_type, body = fetch(url)

            is_valid = 200 <= status < 300 and len(body) > 0
            if is_valid and args.expect == "png":
                is_valid = body.startswith(PNG_MAGIC)

            if is_valid:
                extra = " and valid PNG" if args.expect == "png" else ""
                print(
                    f"{args.label.capitalize()} is reachable{extra} "
                    f"(attempt {attempt}/{args.attempts})."
                )
                return 0

            print(
                f"{args.label.capitalize()} check attempt {attempt}/{args.attempts}: "
                f"status={status}, content-type={content_type or 'unknown'}"
            )
        except urllib.error.HTTPError as exc:
            print(
                f"{args.label.capitalize()} check attempt {attempt}/{args.attempts}: "
                f"status={exc.code}"
            )
        except urllib.error.URLError as exc:
            print(
                f"{args.label.capitalize()} check attempt {attempt}/{args.attempts}: "
                f"{exc.reason}"
            )

        if attempt < args.attempts:
            print(
                f"Waiting {args.interval_seconds}s before next {args.label} retry..."
            )
            time.sleep(args.interval_seconds)

    print(f"Timed out waiting for {args.label}: {url}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
