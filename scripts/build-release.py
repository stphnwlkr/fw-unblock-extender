#!/usr/bin/env python3
"""Build the WordPress ZIP and the metadata for one stable release."""

import argparse
import json
from pathlib import Path
import re
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[1]
SLUG = "fw-unblock-extender"
REPOSITORY = "https://github.com/stphnwlkr/fw-unblock-extender"
MAIN = f"{SLUG}.php"


def header(source, label):
    match = re.search(rf"^(?: \* )?{re.escape(label)}: (.+)$", source, re.MULTILINE)
    if not match:
        raise SystemExit(f"Missing {label} header")
    return match[1].strip()


def build(version):
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version):
        raise SystemExit("Use a stable release version in X.Y.Z format")

    plugin = (ROOT / MAIN).read_text(encoding="utf-8")
    readme = (ROOT / "readme.txt").read_text(encoding="utf-8")
    if (
        header(plugin, "Version") != version
        or f"const VERSION = '{version}';" not in plugin
        or header(readme, "Stable tag") != version
    ):
        raise SystemExit("The release version must match the plugin header, VERSION, and Stable tag")

    changelog = re.search(
        r"^== Changelog ==\n\n= (\S+) =\n(.+?)(?=\n= |\Z)",
        readme,
        re.MULTILINE | re.DOTALL,
    )
    if not changelog or changelog[1] != version or not changelog[2].strip():
        raise SystemExit("Add the release version and notes at the top of the readme changelog")

    files = [ROOT / name for name in (MAIN, "recipes.php", "updates.php", "readme.txt")]
    files.extend(
        sorted(path for path in (ROOT / "assets").rglob("*") if path.suffix in {".css", ".js"})
    )
    output = ROOT / "dist"
    output.mkdir(exist_ok=True)
    with ZipFile(output / f"{SLUG}.zip", "w", ZIP_DEFLATED) as archive:
        for path in files:
            archive.write(path, f"{SLUG}/{path.relative_to(ROOT).as_posix()}")

    notes = changelog[2].strip()
    manifest = {
        "slug": SLUG,
        "version": version,
        "requires": header(plugin, "Requires at least"),
        "requires_php": header(plugin, "Requires PHP"),
        "tested": header(readme, "Tested up to"),
        "download_url": f"{REPOSITORY}/releases/download/{version}/{SLUG}.zip",
        "changelog": notes,
    }
    (output / "update.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    (output / "release-notes.md").write_text(notes + "\n", encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("version", help="Stable release version (X.Y.Z)")
    build(parser.parse_args().version)
