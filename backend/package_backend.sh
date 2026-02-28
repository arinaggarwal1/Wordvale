#!/bin/bash
# package_backend.sh
# Bundles the Python backend into a single executable using PyInstaller
# and moves it to the Tauri binaries folder.

set -e

# Ensure we're in the backend directory
cd "$(dirname "$0")"

# Activate venv
if [ -d "venv" ]; then
    source venv/bin/activate
else
    echo "Virtual environment not found. Please run setup first."
    exit 1
fi

# Install PyInstaller if missing
if ! command -v pyinstaller &> /dev/null; then
    echo "Installing PyInstaller..."
    pip install pyinstaller
fi

echo "Bundling whisper_server.py..."
# --onefile: Create a single executable
# --name: Name of the output binary
# --clean: Clean PyInstaller cache
# --noconfirm: Overwrite existing build folders
pyinstaller --clean --noconfirm --name whisper-backend --onefile whisper_server.py

# Create binaries directory if not exists
mkdir -p ../src-tauri/binaries

# Move binary to Tauri sidecar location
# Format: name-target-triple
# For macOS Apple Silicon: aarch64-apple-darwin
TARGET_TRIPLE="aarch64-apple-darwin"
DEST="../src-tauri/binaries/whisper-backend-$TARGET_TRIPLE"

echo "Moving binary to $DEST..."
mv dist/whisper-backend "$DEST"


# Stage resources for bundling to avoid full repo copy
echo "Staging resources..."
RM_DIR="../backend/bundle_resources"
mkdir -p "$RM_DIR"
# Copy CLI
cp "../backend/whisper.cpp/build/bin/whisper-cli" "$RM_DIR/whisper-cli"
# Copy Metal shader (if exists, fallback to source)
METAL_SRC="../backend/whisper.cpp/ggml/src/ggml-metal/ggml-metal.metal"
if [ -f "$METAL_SRC" ]; then
    cp "$METAL_SRC" "$RM_DIR/ggml-metal.metal"
fi

echo "Backend bundled successfully!"
