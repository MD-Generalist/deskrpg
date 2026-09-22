#!/usr/bin/env python3
"""npm 릴리스 tarball의 개발 파일과 크기를 검사한다."""

import pathlib
import re
import sys
import tarfile

MAX_UNPACKED_BYTES = 300 * 1024 * 1024
FORBIDDEN_DIRS = {
    "__tests__", "test-setup", "e2e", "scripts", "docs", ".artifacts", "test-results",
    ".superpowers", ".claude", ".codex", ".agents", ".gemini", ".dryforge",
}
FORBIDDEN_ROOT_FILES = {"AGENTS.md", "CLAUDE.md", "GEMINI.md"}
TEST_FILE = re.compile(r"\.(test|spec)\..+$")


def check(path: pathlib.Path) -> int:
    total = 0
    count = 0
    bad = []
    with tarfile.open(path, "r:gz") as archive:
        for member in archive:
            if not member.isfile():
                continue
            parts = pathlib.PurePosixPath(member.name).parts
            if not parts or parts[0] != "package":
                bad.append(member.name)
                continue
            relative = parts[1:]
            project_parts = relative
            if len(project_parts) > 2 and project_parts[:2] == (".next", "standalone"):
                project_parts = project_parts[2:]
            if (
                (project_parts and project_parts[0] in FORBIDDEN_DIRS)
                or (project_parts and project_parts[0] in {"src", "tools"} and any(part in FORBIDDEN_DIRS for part in project_parts[1:-1]))
                or ("node_modules" not in project_parts and any(part in FORBIDDEN_ROOT_FILES for part in project_parts))
                or ("node_modules" not in project_parts and (re.fullmatch(r"playwright.*\.config\..+", relative[-1]) or relative[-1] == "tsconfig.tsbuildinfo"))
                or TEST_FILE.search(relative[-1])
            ):
                bad.append(member.name)
            total += member.size
            count += 1
    print(f"npm tarball: {count} files, {total:,} unpacked bytes, {path.stat().st_size:,} packed bytes")
    if bad:
        print(f"Forbidden development files ({len(bad)}):", file=sys.stderr)
        for name in bad[:20]:
            print(f"  {name}", file=sys.stderr)
    if total > MAX_UNPACKED_BYTES:
        print(f"Unpacked size exceeds {MAX_UNPACKED_BYTES:,} bytes", file=sys.stderr)
    return int(bool(bad) or total > MAX_UNPACKED_BYTES)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("Usage: check-npm-tarball.py <tarball.tgz>")
    sys.exit(check(pathlib.Path(sys.argv[1])))
