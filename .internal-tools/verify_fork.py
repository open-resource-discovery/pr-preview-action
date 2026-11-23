#!/usr/bin/env python3
"""Resolve the fork run to its current PR using GitHub's event and REST API."""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import quote, urlencode
from urllib.request import HTTPRedirectHandler, Request, build_opener


def positive_id(value):
    return type(value) is int and value > 0


def resolve(event, repository, get):
    base = event.get("repository") or {}
    run = event.get("workflow_run") or {}
    run_repo = run.get("repository") or {}
    fork = run.get("head_repository") or {}
    branch = run.get("head_branch")
    sha = run.get("head_sha")
    if (
        event.get("action") != "completed"
        or run.get("event") != "pull_request"
        or run.get("status") != "completed"
        or run.get("conclusion") != "success"
        or not positive_id(base.get("id"))
        or not positive_id(run_repo.get("id"))
        or run_repo["id"] != base["id"]
        or repository.lower() != str(base.get("full_name", "")).lower()
        or not positive_id(fork.get("id"))
        or fork["id"] == base["id"]
        or not isinstance(branch, str) or not branch
        or not isinstance(sha, str) or not re.fullmatch(r"[0-9a-f]{40}", sha)
    ):
        return None

    def matches(pr):
        head = pr.get("head") or {}
        base_ref = pr.get("base") or {}
        return (
            positive_id(pr.get("number"))
            and (base_ref.get("repo") or {}).get("id") == base["id"]
            and (head.get("repo") or {}).get("id") == fork["id"]
            and head.get("ref") == branch
            and head.get("sha") == sha
        )

    pulls = "/repos/" + quote(repository, safe="/") + "/pulls"
    associated = run.get("pull_requests", [])
    if not isinstance(associated, list):
        return None
    if associated:
        if len(associated) != 1 or not positive_id(associated[0].get("number")):
            return None
        number = associated[0]["number"]
    else:
        # Fork runs often lack pull_requests. The fully qualified head limits the
        # query, while repository IDs and SHA verify the result independently.
        owner = (fork.get("owner") or {}).get("login")
        if not isinstance(owner, str) or not owner:
            return None
        candidates = set()
        page = 1
        while True:
            query = urlencode({"head": f"{owner}:{branch}", "state": "all", "per_page": 100, "page": page})
            rows = get(f"{pulls}?{query}")
            if not isinstance(rows, list):
                raise ValueError("GitHub returned an invalid pull request list")
            candidates.update(row["number"] for row in rows if matches(row))
            if len(candidates) > 1:
                return None
            if len(rows) < 100:
                break
            page += 1
        if len(candidates) != 1:
            return None
        number = candidates.pop()

    # Re-read after discovery for the latest head and open/closed state.
    pr = get(f"{pulls}/{number}")
    if pr.get("number") != number or not matches(pr):
        return None
    operation = {"open": "deploy", "closed": "remove"}.get(pr.get("state"))
    return (number, operation) if operation else None


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def main():
    event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text(encoding="utf-8"))
    api = os.environ["GITHUB_API_URL"].rstrip("/")
    token = os.environ["GITHUB_TOKEN"]
    if not token:
        raise ValueError("The worker requires a GitHub API token")
    opener = build_opener(NoRedirect())

    def get(path):
        request = Request(api + path, headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "User-Agent": "pr-preview-action",
        })
        with opener.open(request, timeout=30) as response:
            return json.load(response)

    result = resolve(event, os.environ["GITHUB_REPOSITORY"], get)
    if result is None:
        print("Skipping workflow run without a unique, current fork PR.")
        return
    number, operation = result
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
        output.write(f"pr_number={number}\noperation={operation}\n")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError) as exc:
        print(f"Could not verify the fork PR: {exc}", file=sys.stderr)
        sys.exit(1)
