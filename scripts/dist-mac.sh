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

VERSION="$(python3 -c 'import json; print(json.load(open("package.json"))["version"])')"
ARCH="$(uname -m)"
DMG_DIR="$REPO_ROOT/src-tauri/target/release/bundle/dmg"
DMG_PATH="$DMG_DIR/Wordvale_${VERSION}_${ARCH}.dmg"
rm -rf "$DMG_DIR"
mkdir -p "$DMG_DIR"

STAGING_DIR="$(mktemp -d "$DMG_DIR/staging.XXXXXX")"
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
