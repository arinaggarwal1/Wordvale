#!/bin/zsh
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$root/src-tauri/binaries"
swiftc -O -target arm64-apple-macosx13.0 -parse-as-library "$root/recorder/Recorder.swift" -o "$root/src-tauri/binaries/wordvale-recorder-aarch64-apple-darwin" -framework AVFoundation -framework ScreenCaptureKit
