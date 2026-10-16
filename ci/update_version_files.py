"""Update the version fields in package.json and package-lock.json.

Adapted from the prose-style release pipeline: the version-bearing file is
package.json instead of pyproject.toml/SKILL.md.

The release pipeline owns the package.json "version" field (and the mirrored
version lines in package-lock.json). Manual edits are rejected by
ci/check_version_immutability.py, which guards package.json — the canonical
field; package-lock.json follows it and is updated in lockstep here so the
lockfile never drifts out of sync with package.json between releases.

Usage:
    python3 -m ci.update_version_files --version 0.2.0

Output (JSON to stdout):
    {"files_updated": ["package.json", "package-lock.json"]}

Exit code 0 on success, 1 on error.
"""

import argparse
import json
import pathlib
import re
import sys

PACKAGE_JSON_VERSION_PATTERN = re.compile(
    r'^(\s*"version"\s*:\s*")[^"]*(")', re.MULTILINE
)

# package-lock.json carries the version twice: once at the top level and once
# in the root packages[""] entry. Both are the first two "version" lines in
# the file (top-level keys precede packages, and "" is the first entry).
PACKAGE_LOCK_EXPECTED_VERSION_LINES = 2


def update_package_json_version(version: str) -> str:
    """Update the version field in package.json.

    Args:
        version: New semver version string (e.g. "0.2.0").

    Returns:
        The file path that was updated.

    Raises:
        SystemExit: If package.json is not found or the version line cannot be located.
    """
    package_path = pathlib.Path("package.json")

    if not package_path.exists():
        sys.stderr.write(f"ERROR: package.json not found at {package_path.resolve()}\n")
        sys.exit(1)

    content = package_path.read_text()
    new_content, count = PACKAGE_JSON_VERSION_PATTERN.subn(
        f"\\g<1>{version}\\g<2>", content, count=1
    )

    if count == 0:
        sys.stderr.write("ERROR: Could not find version field in package.json\n")
        sys.exit(1)

    package_path.write_text(new_content)

    return str(package_path)


def update_package_lock_version(version: str) -> str:
    """Update the version lines in package-lock.json.

    Bumps both the top-level "version" and the root packages[""] entry so the
    lockfile stays in sync with package.json.

    Args:
        version: New semver version string (e.g. "0.2.0").

    Returns:
        The file path that was updated.

    Raises:
        SystemExit: If package-lock.json is not found or its version lines
            cannot be located (unexpected structure must fail fast, not
            partially update).
    """
    lock_path = pathlib.Path("package-lock.json")

    if not lock_path.exists():
        sys.stderr.write(
            f"ERROR: package-lock.json not found at {lock_path.resolve()}\n"
        )
        sys.exit(1)

    content = lock_path.read_text()
    new_content, count = PACKAGE_JSON_VERSION_PATTERN.subn(
        f"\\g<1>{version}\\g<2>", content, count=PACKAGE_LOCK_EXPECTED_VERSION_LINES
    )

    if count != PACKAGE_LOCK_EXPECTED_VERSION_LINES:
        sys.stderr.write(
            "ERROR: Could not find both version fields (top-level and root entry) "
            "in package-lock.json\n"
        )
        sys.exit(1)

    lock_path.write_text(new_content)

    return str(lock_path)


def update_version_files(version: str) -> list[str]:
    """Update every version file owned by the release pipeline.

    Args:
        version: New semver version string (e.g. "0.2.0").

    Returns:
        List of file paths (relative to repo root) that were updated.
    """
    return [
        update_package_json_version(version),
        update_package_lock_version(version),
    ]


def main() -> None:
    """CLI entry point for updating version files.

    Outputs a JSON object with the list of files updated to stdout.
    Exits with code 0 on success, code 1 on error.
    """
    parser = argparse.ArgumentParser(
        description="Update the version fields in package.json and package-lock.json"
    )
    parser.add_argument(
        "--version",
        required=True,
        help="New semver version string (e.g. '0.2.0')",
    )
    args = parser.parse_args()

    files_updated = update_version_files(version=args.version)

    output = json.dumps({"files_updated": files_updated})
    sys.stdout.write(output + "\n")


if __name__ == "__main__":
    main()
