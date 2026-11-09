#!/bin/bash
set -euo pipefail
export LC_ALL=C
IOS_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
XCODEGEN_VERSION=2.46.0
XCODEGEN_SHA256=4d9e34b62172d645eed6457cac13fc222569974098ef4ee9c3368bedf0196806
WHISPER_VERSION=1.7.6
WHISPER_SHA256=9fcb28106d0b94a525e59bec057e35b57033195ac7408d7e1ab8e4b597cdfeb5

verify_sha256() {
  local actual
  actual="$(shasum -a 256 "$1" | cut -d ' ' -f 1)"
  if [[ "$actual" != "$2" ]]; then
    echo "Checksum mismatch for $1. Remove this cached archive and run again." >&2
    exit 1
  fi
}

mkdir -p "$IOS_ROOT/.tools" "$IOS_ROOT/Vendor"
XCODEGEN_BIN="$IOS_ROOT/.tools/xcodegen/xcodegen/bin/xcodegen"
if [[ ! -x "$XCODEGEN_BIN" ]]; then
  curl --fail --location --retry 3 \
    "https://github.com/yonaskolb/XcodeGen/releases/download/$XCODEGEN_VERSION/xcodegen.zip" \
    --output "$IOS_ROOT/.tools/xcodegen.zip"
  verify_sha256 "$IOS_ROOT/.tools/xcodegen.zip" "$XCODEGEN_SHA256"
  unzip -q -o "$IOS_ROOT/.tools/xcodegen.zip" -d "$IOS_ROOT/.tools/xcodegen"
fi
if [[ ! -d "$IOS_ROOT/Vendor/whisper.xcframework" ]]; then
  curl --fail --location --retry 3 \
    "https://github.com/ggml-org/whisper.cpp/releases/download/v$WHISPER_VERSION/whisper-v$WHISPER_VERSION-xcframework.zip" \
    --output "$IOS_ROOT/Vendor/whisper-v$WHISPER_VERSION-xcframework.zip"
  verify_sha256 "$IOS_ROOT/Vendor/whisper-v$WHISPER_VERSION-xcframework.zip" "$WHISPER_SHA256"
  unzip -q -o "$IOS_ROOT/Vendor/whisper-v$WHISPER_VERSION-xcframework.zip" -d "$IOS_ROOT/Vendor"
  mv "$IOS_ROOT/Vendor/build-apple/whisper.xcframework" "$IOS_ROOT/Vendor/whisper.xcframework"
  rmdir "$IOS_ROOT/Vendor/build-apple"
fi

"$XCODEGEN_BIN" generate --spec "$IOS_ROOT/project.yml" --project "$IOS_ROOT"
echo "Ready: $IOS_ROOT/Wordvale.xcodeproj"
