#!/usr/bin/env bash
# dist-mac.sh
# Builds a release macOS app + DMG and copies the DMG to ~/Downloads.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

if [ "$(uname -s)" != "Darwin" ]; then
    echo "This release script is intended for macOS."
    exit 1
fi

DOWNLOADS_DIR="${HOME}/Downloads"
mkdir -p "$DOWNLOADS_DIR"

echo "Building Wordvale app bundle..."
npm run tauri -- build --bundles app

APP_PATH="$REPO_ROOT/src-tauri/target/release/bundle/macos/Wordvale.app"
if [ ! -d "$APP_PATH" ]; then
    echo "Expected app bundle at $APP_PATH, but it was not created."
    exit 1
fi

if find "$APP_PATH" -type f \( -name 'ggml-*.bin' -o -name '*.gguf' \) | grep -q .; then
    echo "The packaged app contains bundled model files. Refusing to ship a bloated app."
    exit 1
fi

# Seal every embedded executable/library, then the app resources. Ad-hoc
# signing provides integrity for this alpha; it is not Developer ID notarization.
python3 - "$APP_PATH" <<'SIGN_APP'
import pathlib, subprocess, sys
app = pathlib.Path(sys.argv[1])
macho_magic = {b'\xfe\xed\xfa\xce', b'\xce\xfa\xed\xfe', b'\xfe\xed\xfa\xcf', b'\xcf\xfa\xed\xfe', b'\xca\xfe\xba\xbe', b'\xbe\xba\xfe\xca', b'\xca\xfe\xba\xbf', b'\xbf\xba\xfe\xca'}
for path in sorted(app.rglob('*'), key=lambda p: len(p.parts), reverse=True):
    if not path.is_file() or path.is_symlink():
        continue
    with path.open('rb') as handle:
        is_macho = handle.read(4) in macho_magic
    if is_macho:
        subprocess.run(['codesign', '--force', '--sign', '-', '--timestamp=none', str(path)], check=True)
for bundle in sorted((p for p in app.rglob('*') if p.is_dir() and p.suffix in {'.framework', '.xpc', '.appex', '.app'}), key=lambda p: len(p.parts), reverse=True):
    subprocess.run(['codesign', '--force', '--sign', '-', '--timestamp=none', str(bundle)], check=True)
subprocess.run(['codesign', '--force', '--sign', '-', '--timestamp=none', str(app)], check=True)
subprocess.run(['codesign', '--verify', '--deep', '--strict', str(app)], check=True)
SIGN_APP

VERSION="$(python3 -c 'import json; print(json.load(open("package.json"))["version"])')"
ARCH="$(uname -m)"
DMG_DIR="$REPO_ROOT/src-tauri/target/release/bundle/dmg"
DMG_PATH="$DMG_DIR/Wordvale_${VERSION}_${ARCH}.dmg"
mkdir -p "$DMG_DIR"

STAGING_DIR="$(mktemp -d "$DMG_DIR/staging.XXXXXX")"
trap 'rm -rf "$STAGING_DIR"' EXIT
cp -R "$APP_PATH" "$STAGING_DIR/Wordvale.app"
ln -s /Applications "$STAGING_DIR/Applications"

echo "Creating DMG..."
hdiutil create \
    -volname "Wordvale" \
    -srcfolder "$STAGING_DIR" \
    -ov \
    -format UDZO \
    "$DMG_PATH" >/dev/null

rm -rf "$STAGING_DIR"

DMG_NAME="$(basename "$DMG_PATH")"
DEST_DMG="$DOWNLOADS_DIR/$DMG_NAME"
cp -f "$DMG_PATH" "$DEST_DMG"

echo "Release build complete."
echo "App bundle: $APP_PATH"
echo "DMG copied to: $DEST_DMG"
du -sh "$APP_PATH" "$DEST_DMG"
