#!/usr/bin/env python3
from __future__ import annotations

import argparse
import time


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--server-url", required=True)
    parser.add_argument("--current-repo", required=True)
    parser.add_argument("--target-repo", default="")
    parser.add_argument("--target-branch", required=True)
    parser.add_argument("--preview-target-folder", default="")
    parser.add_argument("--preview-url", default="")
    parser.add_argument("--qr-enabled", default="true")
    args = parser.parse_args()

    qr_code_check_url = ""
    qr_code_url = ""
    qr_code_suffix = ""

    preview_url = args.preview_url.strip()
    qr_enabled = args.qr_enabled != "false"

    if preview_url.startswith(("http://", "https://")) and qr_enabled:
        qr_code_check_url = f"{preview_url}pr-preview-qr.png"

        if args.server_url == "https://github.com":
            qr_code_url = f"{qr_code_check_url}?v={int(time.time())}"
        else:
            qr_image_repo = args.target_repo or args.current_repo
            if qr_image_repo == args.current_repo:
                qr_code_url = (
                    f"../blob/{args.target_branch}/"
                    f"{args.preview_target_folder}/pr-preview-qr.png?raw=true"
                )
            else:
                qr_code_url = (
                    f"../../../{qr_image_repo}/blob/{args.target_branch}/"
                    f"{args.preview_target_folder}/pr-preview-qr.png?raw=true"
                )

        qr_code_suffix = (
            f'<p><img src="{qr_code_url}" height="100" align="right" '
            f'alt="QR code for preview link" /></p>'
        )

    print(f"qr_code_check_url={qr_code_check_url}")
    print(f"qr_code_url={qr_code_url}")
    print(f"qr_code_suffix={qr_code_suffix}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
