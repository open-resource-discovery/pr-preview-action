"""Validate a fork preview artifact against the trusted worker configuration."""

import io
import json
import os
import re
import shlex
import shutil
import stat
import sys
import tempfile
import zipfile
from pathlib import Path

JSON_META = "pr-preview-meta.json"
LEGACY_META = "pr-preview-meta.env"
PR_MARKER = "pr_number.txt"
CONTROL_FILES = {JSON_META, LEGACY_META, PR_MARKER}
GIT_FILES = {".git", ".github", ".gitmodules", ".gitattributes", ".gitignore"}
MAX_ARCHIVE = 256 * 1024 * 1024
MAX_TOTAL = 512 * 1024 * 1024
MAX_FILE = 128 * 1024 * 1024
MAX_MEMBERS = 10000
MAX_METADATA = 16384
MAX_INDEX = 4 * 1024 * 1024


class ArchiveReader(io.BufferedReader):
    """Bound ZIP index allocation before ZipFile constructs its member list."""

    def read(self, size=-1):
        requested = os.fstat(self.fileno()).st_size - self.tell() if size < 0 else size
        if requested > MAX_INDEX:
            raise ValueError("Preview archive index exceeds size limit")
        return super().read(size)


def unique_fields(pairs):
    fields = {}
    for key, value in pairs:
        if key in fields:
            raise ValueError("Duplicate field in artifact metadata")
        fields[key] = value
    return fields


def legacy_fields(text):
    pairs = []
    for line in text.splitlines():
        key, sep, value = line.partition("=")
        if not sep or not re.fullmatch(r"[A-Z_]+", key):
            raise ValueError("Malformed legacy artifact metadata")
        if key == "UMBRELLA_DIR":  # The legacy producer used Bash printf %q here.
            words = shlex.split(value)
            if len(words) != 1:
                raise ValueError("Invalid legacy umbrella directory")
            value = words[0]
        pairs.append((key.lower(), value))
    return unique_fields(pairs)


def bounded_text(archive, member):
    if member.file_size > MAX_METADATA:
        raise ValueError("Artifact metadata exceeds size limit")
    with archive.open(member) as stream:
        data = stream.read(MAX_METADATA + 1)
    if len(data) > MAX_METADATA:
        raise ValueError("Artifact metadata exceeds size limit")
    return data.decode("utf-8")


def check_metadata(archive, members, env):
    names = [name for name in (JSON_META, LEGACY_META) if name in members]
    if len(names) != 1:
        raise ValueError("Expected exactly one root artifact metadata file")
    name = names[0]
    raw = bounded_text(archive, members[name])
    data = (json.loads(raw, object_pairs_hook=unique_fields)
            if name == JSON_META else legacy_fields(raw))
    required = {"worker_action", "pr_number", "target_repo", "target_branch",
                "umbrella_dir", "pages_base_url"}
    if not isinstance(data, dict) or not required.issubset(data):
        raise ValueError("Missing required artifact metadata")
    if not all(isinstance(data[key], str) for key in required):
        raise ValueError("Invalid artifact metadata type")
    if data["pr_number"] != env["PR_NUMBER"]:
        raise ValueError("Artifact does not belong to the verified pull request")
    if PR_MARKER in members:
        number = bounded_text(archive, members[PR_MARKER]).rstrip("\n")
        if number != env["PR_NUMBER"]:
            raise ValueError("Artifact pull request marker is inconsistent")
    repo = data["target_repo"] or env["GITHUB_REPOSITORY"]
    target = env["TARGET_REPO"] or env["GITHUB_REPOSITORY"]
    if (repo.casefold() != target.casefold()
            or data["target_branch"] != env["TARGET_BRANCH"]
            or data["umbrella_dir"] != env["UMBRELLA_DIR"]
            or data["pages_base_url"].rstrip("/") != env["PAGES_BASE_URL"].rstrip("/")):
        raise ValueError("Artifact destination disagrees with the trusted worker configuration")
    action = data["worker_action"]
    if action not in {"deploy", "remove"} or env["OPERATION"] not in {"deploy", "remove"}:
        raise ValueError("Invalid preview operation")
    return action if action == env["OPERATION"] else "skip"


def safe_members(archive):
    infos = archive.infolist()
    if len(infos) > MAX_MEMBERS:
        raise ValueError("Too many archive entries")
    members = {}
    spellings = {}
    directories = set()
    files = set()
    total = 0
    for info in infos:
        name = info.orig_filename
        directory = info.is_dir()
        parts = (name[:-1] if directory else name).split("/")
        if ("\\" in name or ":" in name or len(parts) > 64 or len(name) > 4096
                or any(ord(char) < 32 or ord(char) == 127 for char in name)
                or any(not part or part.endswith((".", " ")) for part in parts)
                or any(part.casefold() in GIT_FILES for part in parts)):
            raise ValueError("Unsafe archive path")
        if any(part.casefold() in CONTROL_FILES for part in parts):
            if len(parts) != 1 or directory or name not in CONTROL_FILES:
                raise ValueError("Unexpected artifact control file")
        mode = stat.S_IFMT(info.external_attr >> 16)
        if mode not in {0, stat.S_IFDIR if directory else stat.S_IFREG}:
            raise ValueError("Only regular files and directories are allowed")
        if info.flag_bits & 1 or info.compress_type not in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}:
            raise ValueError("Unsupported archive encoding")
        if directory and info.file_size:
            raise ValueError("Unexpected directory data")
        total += info.file_size
        if info.file_size > MAX_FILE or total > MAX_TOTAL:
            raise ValueError("Unpacked preview exceeds size limit")
        # Track implicit directories as well, independently of archive order.
        for i in range(1, len(parts) + 1):
            path = "/".join(parts[:i])
            normalized = path.casefold()
            if spellings.setdefault(normalized, path) != path:
                raise ValueError("Conflicting capitalization in archive paths")
            if i < len(parts) or directory:
                if normalized in files:
                    raise ValueError("Conflicting directory and file in archive")
                directories.add(normalized)
            else:
                if normalized in directories:
                    raise ValueError("Conflicting directory and file in archive")
                files.add(normalized)
        if name in members:
            raise ValueError("Duplicate archive member")
        members[name] = info
    return members


def unpack(path, destination, env):
    if (destination.is_symlink() or not destination.is_dir()
            or any(destination.iterdir())):
        raise ValueError("Preview staging directory must be fresh and empty")
    if path.stat().st_size > MAX_ARCHIVE:
        raise ValueError("Preview archive exceeds size limit")
    with ArchiveReader(path.open("rb", buffering=0)) as stream, zipfile.ZipFile(stream) as archive:
        members = safe_members(archive)
        action = check_metadata(archive, members, env)
        if action != "deploy":
            return action
        assets = [member for name, member in members.items()
                  if name not in CONTROL_FILES and not member.is_dir()]
        if not assets:
            raise ValueError("Preview contains no static files")
        with tempfile.TemporaryDirectory(dir=destination.parent) as tmp:
            ready = Path(tmp) / "static"
            ready.mkdir()
            for info in assets:
                output = ready / info.filename
                output.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(info) as source, output.open("xb") as target:
                    shutil.copyfileobj(source, target, length=65536)
            os.replace(ready, destination)
    return action


def main():
    if len(sys.argv) != 3:
        sys.exit("Usage: unpack_preview.py ZIP EMPTY_STAGING_DIR")
    try:
        action = unpack(Path(sys.argv[1]), Path(sys.argv[2]), os.environ)
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
            output.write(f"deployment_action={action}\n")
    except (ValueError, OSError, KeyError, zipfile.BadZipFile, RuntimeError) as error:
        sys.exit(f"Invalid preview archive: {error}")


if __name__ == "__main__":
    main()
