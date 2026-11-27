#!/usr/bin/env python3
"""Prepare a deployment copy without publishing generated search indexes."""

import fnmatch
from html.parser import HTMLParser
from pathlib import Path
import shutil
import sys

SEARCH_STYLE = (
    '<style id="pr-preview-search-disabled">'
    '.navbar__search,.navbar-sidebar__search{display:none!important}'
    '</style>'
)


class DocusaurusHead(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.is_docusaurus = False
        self.head_end = None
        self.has_search_style = False

    def handle_starttag(self, tag, attrs) -> None:
        attributes = dict(attrs)
        if tag == "meta" and (attributes.get("name") or "").lower() == "generator":
            self.is_docusaurus = (attributes.get("content") or "").lower().startswith("docusaurus")
        if tag == "style" and attributes.get("id") == "pr-preview-search-disabled":
            self.has_search_style = True

    def handle_endtag(self, tag) -> None:
        if tag == "head" and self.head_end is None:
            self.head_end = self.getpos()


def hide_documentation_search(html: str) -> str:
    parser = DocusaurusHead()
    parser.feed(html)
    if not parser.is_docusaurus or parser.head_end is None or parser.has_search_style:
        return html
    line, column = parser.head_end
    offset = sum(len(part) + 1 for part in html.split("\n")[:line - 1]) + column
    return html[:offset] + SEARCH_STYLE + html[offset:]


def is_search_index(name: str) -> bool:
    return any(fnmatch.fnmatchcase(name, pattern) for pattern in (
        "search-index*.json", "search-index*.json.gz", "search-index*.json.br",
    ))


def prepare_preview(source: Path, destination: Path, include_search_indexes: bool = False) -> int:
    source = source.resolve()
    destination = destination.resolve()
    if not source.is_dir():
        raise ValueError("build-dir must be an existing directory")
    if source == destination or source.is_relative_to(destination):
        raise ValueError("the deployment copy must not contain build-dir")

    excluded_count = 0

    def ignore(directory, names):
        nonlocal excluded_count
        ignored = []
        for name in names:
            # Also support build-dir='.' without copying the staging directory into itself.
            if Path(directory, name).resolve() == destination:
                ignored.append(name)
            elif not include_search_indexes and is_search_index(name):
                ignored.append(name)
                excluded_count += 1
        return ignored

    # Preserve symlinks instead of following them into files outside the build.
    shutil.copytree(source, destination, symlinks=True, ignore=ignore, dirs_exist_ok=True)
    if excluded_count:
        for path in destination.rglob("*.html"):
            if path.is_symlink() or not path.is_file():
                continue
            try:
                html = path.read_bytes().decode("utf-8")
            except UnicodeDecodeError:
                continue
            updated = hide_documentation_search(html)
            if updated != html:
                path.write_bytes(updated.encode("utf-8"))
    return excluded_count


def main() -> int:
    if len(sys.argv) != 4 or sys.argv[3].lower() not in ("true", "false"):
        print("usage: prepare_preview.py <build-dir> <output-dir> <include-search-indexes:true|false>", file=sys.stderr)
        return 1
    try:
        count = prepare_preview(Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3].lower() == "true")
    except (OSError, ValueError) as error:
        print(f"Could not prepare preview: {error}", file=sys.stderr)
        return 1
    print(f"Prepared preview; excluded {count} generated search index files.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
