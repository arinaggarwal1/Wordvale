"""Verified, staged updates for the packaged macOS application."""
import hashlib
import certifi
import json
import os
import platform
import plistlib
import re
import shutil
import ssl
import subprocess
import sys
import tempfile
import threading
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import quote, urlparse

REPOSITORY = "arinaggarwal1/Wordvale"
API_URL = f"https://api.github.com/repos/{REPOSITORY}/releases/latest"
MAX_DOWNLOAD = 1024 * 1024 * 1024
ASSET_NAME = "Wordvale-macOS-arm64.dmg"
HELPER = r'''#!/bin/sh
pid="$1"; staged="$2"; target="$3"; backup="$4"
count=0
while kill -0 "$pid" 2>/dev/null; do
  sleep 1; count=$((count + 1))
  if [ "$count" -ge 60 ]; then
    /usr/bin/osascript -e 'display alert "Wordvale update paused" message "Wordvale did not close. The installed app was not changed."'
    exit 1
  fi
done
if /bin/mv "$target" "$backup"; then
  if /bin/mv "$staged" "$target"; then
    if /usr/bin/open "$target"; then exit 0; fi
    /bin/mv "$target" "$staged"
  fi
  /bin/mv "$backup" "$target"
fi
/usr/bin/osascript -e 'display alert "Wordvale update failed" message "The previous app has been kept. Please reopen Wordvale."'
/usr/bin/open "$target"
exit 1
'''


def version_tuple(value):
    match = re.fullmatch(r"v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)", value or "")
    if not match:
        raise ValueError("The release does not have a supported stable version.")
    return tuple(map(int, match.groups()))


def app_target():
    if not getattr(sys, "frozen", False) or sys.platform != "darwin" or platform.machine() != "arm64":
        return None
    executable = Path(sys.executable).resolve()
    app = executable.parent.parent.parent
    if app.suffix != ".app" or not (app / "Contents" / "Info.plist").is_file():
        return None
    if not os.access(app.parent, os.W_OK):
        return None
    try:
        with (app / "Contents" / "Info.plist").open("rb") as handle:
            if plistlib.load(handle).get("CFBundleIdentifier") != "com.wordvale.app":
                return None
    except (OSError, ValueError, plistlib.InvalidFileException):
        return None
    return app


def select_asset(release):
    tag = release.get("tag_name", "")
    version_tuple(tag)
    expected = f"https://github.com/{REPOSITORY}/releases/download/{quote(tag, safe='')}/{ASSET_NAME}"
    for asset in release.get("assets", []):
        if asset.get("name") != ASSET_NAME:
            continue
        if asset.get("browser_download_url") != expected:
            raise ValueError("The installer URL is not from the expected GitHub release.")
        if not re.fullmatch(r"sha256:[0-9a-f]{64}", asset.get("digest") or ""):
            raise ValueError("This release does not provide a SHA-256 checksum.")
        size = asset.get("size")
        if not isinstance(size, int) or isinstance(size, bool) or not 0 < size <= MAX_DOWNLOAD:
            raise ValueError("The installer size is invalid or too large.")
        return asset
    return None


class GitHubRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        parsed = urlparse(newurl)
        allowed = {"api.github.com", "github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"}
        if parsed.scheme != "https" or parsed.hostname not in allowed or parsed.username or parsed.password or parsed.port not in (None, 443):
            raise ValueError("GitHub redirected the download to an untrusted host.")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class AppUpdater:
    def __init__(self):
        self.lock = threading.RLock()
        self.asset = None
        self.folder = None
        self.staged = None
        self.target = None
        self.state = {"status": "idle", "current_version": None, "latest_version": None, "message": "", "progress": 0}

    def snapshot(self):
        with self.lock:
            return {**self.state, "can_install": app_target() is not None}

    def update(self, **values):
        with self.lock:
            self.state.update(values)

    def check(self, current_version):
        with self.lock:
            if self.state["status"] in ("checking", "downloading", "ready", "installing"):
                return self.snapshot()
            self.asset = None
            self.update(status="checking", current_version=current_version, latest_version=None, progress=0, message="Checking GitHub…")
        try:
            if getattr(sys, "frozen", False):
                installed_plist = Path(sys.executable).resolve().parent.parent / "Info.plist"
                with installed_plist.open("rb") as handle:
                    installed = plistlib.load(handle)
                if installed.get("CFBundleIdentifier") != "com.wordvale.app" or installed.get("CFBundleShortVersionString") != current_version:
                    raise ValueError("The installed application version could not be verified.")
            current = version_tuple(current_version)
            request = urllib.request.Request(API_URL, headers={"Accept": "application/vnd.github+json", "User-Agent": "Wordvale-Updater"})
            opener = urllib.request.build_opener(GitHubRedirect(), urllib.request.HTTPSHandler(context=ssl.create_default_context(cafile=certifi.where())))
            with opener.open(request, timeout=20) as response:
                release = json.load(response)
            if release.get("draft") or release.get("prerelease"):
                raise ValueError("No stable release is available yet.")
            tag = release.get("tag_name", "")
            latest = version_tuple(tag)
            self.update(latest_version=tag.lstrip("v"))
            if latest <= current:
                self.update(status="current", message="You're up to date." if latest == current else "This build is newer than the latest published release.")
            else:
                self.asset = select_asset(release)
                if not self.asset:
                    self.update(status="unavailable", message=f"Version {tag} is available, but its macOS installer is not published yet.")
                else:
                    self.update(status="available", message=f"Version {tag} is available.")
        except Exception as exc:
            message = str(exc) if isinstance(exc, ValueError) else "Could not check GitHub. Check your connection and try again."
            self.update(status="error", message=message)
        return self.snapshot()

    def start_download(self):
        with self.lock:
            if self.state["status"] != "available" or not self.asset:
                raise ValueError("Check for an update first.")
            self.target = app_target()
            if self.target is None:
                raise ValueError("Open the installed app from a writable location on an Apple silicon Mac to update.")
            self.update(status="downloading", progress=0, message="Downloading update…")
            threading.Thread(target=self._download, daemon=True).start()
        return self.snapshot()

    def _download(self):
        folder = None
        staging_dir = None
        try:
            asset = self.asset
            if not asset or not self.target:
                raise ValueError("No update selected.")
            folder = Path(tempfile.mkdtemp(prefix="wordvale-update-"))
            dmg = folder / ASSET_NAME
            digest = hashlib.sha256()
            received = 0
            request = urllib.request.Request(asset["browser_download_url"], headers={"User-Agent": "Wordvale-Updater"})
            opener = urllib.request.build_opener(GitHubRedirect(), urllib.request.HTTPSHandler(context=ssl.create_default_context(cafile=certifi.where())))
            with opener.open(request, timeout=60) as response, dmg.open("wb") as output:
                while True:
                    chunk = response.read(256 * 1024)
                    if not chunk:
                        break
                    received += len(chunk)
                    if received > asset["size"] or received > MAX_DOWNLOAD:
                        raise ValueError("The download exceeded the expected size.")
                    output.write(chunk)
                    digest.update(chunk)
                    self.update(progress=min(99, int(received * 100 / asset["size"])))
            if received != asset["size"] or f"sha256:{digest.hexdigest()}" != asset["digest"]:
                raise ValueError("The download failed verification.")
            self.update(message="Preparing update…")
            mount = folder / "mount"
            mount.mkdir()
            subprocess.run(["/usr/bin/hdiutil", "attach", str(dmg), "-mountpoint", str(mount), "-nobrowse", "-readonly", "-quiet"], check=True, timeout=120)
            try:
                app = mount / "Wordvale.app"
                with (app / "Contents" / "Info.plist").open("rb") as handle:
                    info = plistlib.load(handle)
                if info.get("CFBundleIdentifier") != "com.wordvale.app" or version_tuple(info.get("CFBundleShortVersionString")) != version_tuple(self.state["latest_version"]):
                    raise ValueError("The downloaded app does not match the release.")
                subprocess.run(["/usr/bin/lipo", str(app / "Contents" / "MacOS" / "Wordvale"), "-verify_arch", "arm64"], check=True, capture_output=True, timeout=30)
                staging_dir = Path(tempfile.mkdtemp(prefix=".wordvale-update-", dir=self.target.parent))
                staged = staging_dir / "Wordvale.app"
                subprocess.run(["/usr/bin/ditto", str(app), str(staged)], check=True, timeout=180)
            finally:
                subprocess.run(["/usr/bin/hdiutil", "detach", str(mount), "-quiet"], check=True, timeout=30)
            self.folder, self.staged = folder, staged
            self.update(status="ready", progress=100, message="Update ready. Save your work before restarting.")
        except Exception as exc:
            if staging_dir:
                shutil.rmtree(staging_dir, ignore_errors=True)
            if folder:
                shutil.rmtree(folder, ignore_errors=True)
            self.update(status="error", message=f"Could not prepare the update: {exc}")

    def install(self, app_pid):
        with self.lock:
            if self.state["status"] != "ready" or not self.folder or not self.staged or not self.target:
                raise ValueError("Download an update before installing.")
            if not isinstance(app_pid, int) or app_pid <= 1 or app_target() != self.target:
                raise ValueError("The running application could not be verified.")
            helper = self.folder / "install.sh"
            helper.write_text(HELPER)
            backup = self.staged.parent / "Previous-Wordvale.app"
            # A frozen backend carries PyInstaller's private extraction state.
            # The new app and its sidecar must not inherit that state on relaunch.
            clean_env = {key: value for key, value in os.environ.items() if not key.startswith("_PYI_")}
            subprocess.Popen(["/bin/sh", str(helper), str(app_pid), str(self.staged), str(self.target), str(backup)], start_new_session=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=clean_env)
            self.update(status="installing", message="Installing update. Wordvale will reopen.")
            return self.snapshot()
