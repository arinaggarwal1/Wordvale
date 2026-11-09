#!/bin/bash
set -euo pipefail
export LC_ALL=C
IOS_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEST_ROOT="$IOS_ROOT/build/core-host"
mkdir -p "$TEST_ROOT"
LOG_PATH="$TEST_ROOT/result.log"
if [[ "${WORDVALE_TEST_DOWNLOAD:-0}" == "1" ]]; then
  LOG_PATH="$TEST_ROOT/result-network.log"
elif [[ "${WORDVALE_TEST_DOWNLOAD:-0}" == "cancel" ]]; then
  LOG_PATH="$TEST_ROOT/result-cancel.log"
fi

# Tests production sources directly; no simulator, signing, model or download.
xcrun swiftc -O -swift-version 5 -target "$(uname -m)-apple-macos13.3" \
  "$IOS_ROOT/Wordvale/Domain/Models.swift" \
  "$IOS_ROOT/Wordvale/Domain/TranscriptExporter.swift" \
  "$IOS_ROOT/Wordvale/Storage/LibraryStorage.swift" \
  "$IOS_ROOT/Wordvale/Storage/ModelStore.swift" \
  "$IOS_ROOT/Wordvale/Audio/AudioDecoder.swift" \
  "$IOS_ROOT/TestsSupport/CoreSmoke.swift" \
  -o "$TEST_ROOT/CoreSmoke"

if ! "$TEST_ROOT/CoreSmoke" > "$LOG_PATH" 2>&1; then
  cat "$LOG_PATH"
  exit 1
fi
cat "$LOG_PATH"
echo "Core verification log: $LOG_PATH"
