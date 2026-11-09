#!/usr/bin/env python3
"""Idempotently attach both platform builds without replacing existing assets.

Manually created drafts stay drafts. Workflow-owned releases use the established
alpha-as-Latest policy: alpha stays explicit in the tag/title, while GitHub's
prerelease flag is false so the website's /releases/latest route stays current.
"""

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile
from urllib.parse import quote


BINARIES = ("Wordvale-macOS-arm64.dmg", "Wordvale-iOS.ipa")
REQUIRED = tuple(name for binary in BINARIES for name in (binary, binary + ".sha256"))
WORKFLOW_MARKER = "<!-- wordvale-release-workflow -->"


def gh(*args, check=True):
    result = subprocess.run(["gh", *args], text=True, capture_output=True)
    if check and result.returncode:
        raise RuntimeError(result.stderr.strip() or "GitHub CLI request failed")
    return result


def release(repo, tag):
    result = gh("api", f"repos/{repo}/releases/tags/{quote(tag, safe='')}", check=False)
    if result.returncode:
        if "(HTTP 404)" in result.stderr:
            return None
        raise RuntimeError(result.stderr.strip() or "Could not inspect GitHub release")
    return json.loads(result.stdout)


def uploaded_assets(value):
    return {asset["name"]: asset for asset in (value or {}).get("assets", [])
            if asset.get("state") == "uploaded" and asset.get("size", 0) > 0}


def complete(value):
    return all(name in uploaded_assets(value) for name in REQUIRED)


def managed_draft(value):
    return bool(value and value.get("draft") and WORKFLOW_MARKER in (value.get("body") or ""))


def inspect(repo, tag, output):
    current = release(repo, tag)
    outputs = {"build_required": not complete(current),
               "publish_required": not complete(current) or managed_draft(current)}
    lines = "".join(f"{key}={str(value).lower()}\n" for key, value in outputs.items())
    if output:
        with output.open("a") as stream:
            stream.write(lines)
    print(lines, end="")


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def remote_digest(repo, tag, asset):
    digest = asset.get("digest") or ""
    if re.fullmatch(r"sha256:[0-9a-f]{64}", digest):
        return digest.split(":", 1)[1]
    # Older assets may lack API digests. Hash the existing release binary, never
    # the newly built local binary, when creating its missing checksum sidecar.
    with tempfile.TemporaryDirectory(prefix="wordvale-release-download-") as directory:
        gh("release", "download", tag, "--repo", repo, "--pattern", asset["name"], "--dir", directory)
        return sha256(Path(directory) / asset["name"])


def upload_missing(repo, tag, path):
    current = release(repo, tag)
    if path.name in uploaded_assets(current):
        return
    if not path.is_file() or path.stat().st_size == 0:
        raise RuntimeError(f"Missing or empty release artifact: {path}")
    # No --clobber: a concurrent manual upload always wins over this build.
    result = gh("release", "upload", tag, str(path), "--repo", repo, check=False)
    if result.returncode and path.name not in uploaded_assets(release(repo, tag)):
        raise RuntimeError(result.stderr.strip() or f"Could not upload {path.name}")


def verify_checksums(repo, tag):
    assets = uploaded_assets(release(repo, tag))
    if not all(name in assets for name in REQUIRED):
        raise RuntimeError("Release is incomplete; leaving its publication state unchanged")
    with tempfile.TemporaryDirectory(prefix="wordvale-release-check-") as directory:
        for binary in BINARIES:
            name = binary + ".sha256"
            gh("release", "download", tag, "--repo", repo, "--pattern", name, "--dir", directory)
            checksum = (Path(directory) / name).read_text().strip().split()
            expected = remote_digest(repo, tag, assets[binary])
            if checksum != [expected, binary]:
                raise RuntimeError(f"Existing {name} does not match the published binary; refusing to overwrite it")


def publish(repo, tag, artifact_dir):
    current = release(repo, tag)
    if complete(current) and not managed_draft(current):
        print("Both platforms and checksums are already attached; release left unchanged.")
        return
    if current is None:
        for binary in BINARIES:
            path = artifact_dir / binary
            if not path.is_file() or path.stat().st_size == 0:
                raise RuntimeError(f"Build both platforms before creating a release: missing {binary}")
        notes = (f"{WORKFLOW_MARKER}\n\n"
                 f"Wordvale {tag}. Alpha status is stated in the version; this release is marked Latest.\n\n"
                 "macOS: download Wordvale-macOS-arm64.dmg for Apple silicon on macOS 15 or later. "
                 "Drag Wordvale to Applications. The app is ad-hoc signed, not notarized.\n\n"
                 "iPhone: Wordvale-iOS.ipa requires iOS 17 or later. This IPA is unsigned; "
                 "install it through Sideloadly or AltStore with your own Apple account. "
                 "Download a transcription model in the app before offline use.\n\n"
                 "SHA-256 checksum files accompany both downloads. See ios/README.md in the repository for sideloading instructions.\n")
        with tempfile.TemporaryDirectory(prefix="wordvale-release-notes-") as directory:
            path = Path(directory) / "notes.md"
            path.write_text(notes)
            result = gh("release", "create", tag, "--repo", repo, "--draft", "--verify-tag",
                        "--title", f"Wordvale {tag}", "--notes-file", str(path), check=False)
        current = release(repo, tag)
        if current is None:
            raise RuntimeError(result.stderr.strip() or "Could not create release draft")
    for binary in BINARIES:
        upload_missing(repo, tag, artifact_dir / binary)
        assets = uploaded_assets(release(repo, tag))
        checksum_name = binary + ".sha256"
        if checksum_name not in assets:
            with tempfile.TemporaryDirectory(prefix="wordvale-release-sha-") as directory:
                path = Path(directory) / checksum_name
                path.write_text(f"{remote_digest(repo, tag, assets[binary])}  {binary}\n")
                upload_missing(repo, tag, path)
    verify_checksums(repo, tag)
    current = release(repo, tag)
    if managed_draft(current):
        # Preserve the project's deliberate alpha-as-Latest release policy.
        gh("release", "edit", tag, "--repo", repo, "--draft=false", "--prerelease=false", "--latest")
        print(f"Published {tag} with both platform builds and checksums.")
    else:
        print("Attached missing assets; existing release publication state and notes left unchanged.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("inspect", "publish"))
    parser.add_argument("--repo", required=True)
    parser.add_argument("--tag", required=True)
    parser.add_argument("--github-output", type=Path)
    parser.add_argument("--artifact-dir", type=Path)
    args = parser.parse_args()
    if args.action == "inspect":
        inspect(args.repo, args.tag, args.github_output)
    else:
        if args.artifact_dir is None:
            parser.error("publish requires --artifact-dir")
        publish(args.repo, args.tag, args.artifact_dir)


if __name__ == "__main__":
    main()
