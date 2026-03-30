#!/usr/bin/env bash
# package_backend.sh
# Bundles the Python backend into a single executable using PyInstaller
# and stages only the minimal runtime resources needed by the Tauri app.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$SCRIPT_DIR"

VENV_DIR="$SCRIPT_DIR/venv"
if [ -d "$VENV_DIR" ]; then
    # shellcheck disable=SC1091
    source "$VENV_DIR/bin/activate"
else
    echo "Virtual environment not found at $VENV_DIR. Please run setup first."
    exit 1
fi

echo "Ensuring backend Python dependencies are installed..."
pip install --disable-pip-version-check -r "$SCRIPT_DIR/requirements.txt" >/dev/null

if ! python -m PyInstaller --version >/dev/null 2>&1; then
    echo "Installing PyInstaller..."
    pip install pyinstaller
fi

if ! command -v rustc >/dev/null 2>&1; then
    echo "rustc is required so the package step can name the sidecar correctly."
    exit 1
fi

WHISPER_CLI_SRC="$SCRIPT_DIR/whisper.cpp/build/bin/whisper-cli"
if [ ! -x "$WHISPER_CLI_SRC" ]; then
    echo "Expected whisper-cli at $WHISPER_CLI_SRC. Build whisper.cpp before packaging."
    exit 1
fi

TARGET_TRIPLE="$(rustc -vV | awk '/host:/ {print $2}')"
if [ -z "$TARGET_TRIPLE" ]; then
    echo "Could not determine Rust host target triple."
    exit 1
fi

DIST_DIR="$SCRIPT_DIR/dist"
BUILD_DIR="$SCRIPT_DIR/build"
SPEC_FILE="$SCRIPT_DIR/whisper-backend.spec"
TAURI_BIN_DIR="$REPO_ROOT/src-tauri/binaries"
RESOURCE_DIR="$SCRIPT_DIR/bundle_resources"
DEST_BINARY="$TAURI_BIN_DIR/whisper-backend-$TARGET_TRIPLE"

echo "Cleaning old backend packaging artifacts..."
rm -rf "$DIST_DIR" "$BUILD_DIR" "$SPEC_FILE"
rm -rf "$RESOURCE_DIR"
mkdir -p "$TAURI_BIN_DIR" "$RESOURCE_DIR"
rm -f "$TAURI_BIN_DIR"/whisper-backend-*

echo "Bundling whisper_server.py with PyInstaller..."
python -m PyInstaller \
    --clean \
    --noconfirm \
    --onefile \
    --name whisper-backend \
    --distpath "$DIST_DIR" \
    --workpath "$BUILD_DIR" \
    whisper_server.py

echo "Staging sidecar binary at $DEST_BINARY..."
mv "$DIST_DIR/whisper-backend" "$DEST_BINARY"

echo "Staging minimal runtime resources..."
cp "$WHISPER_CLI_SRC" "$RESOURCE_DIR/whisper-cli"

METAL_SRC="$SCRIPT_DIR/whisper.cpp/ggml/src/ggml-metal/ggml-metal.metal"
if [ -f "$METAL_SRC" ]; then
    cp "$METAL_SRC" "$RESOURCE_DIR/ggml-metal.metal"
fi

if find "$RESOURCE_DIR" -type f \( -name 'ggml-*.bin' -o -name '*.gguf' \) | grep -q .; then
    echo "Refusing to package model files inside bundle_resources."
    exit 1
fi

echo "Backend bundle is ready."
du -sh "$DEST_BINARY" "$RESOURCE_DIR"
