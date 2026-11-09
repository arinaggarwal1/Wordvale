#!/bin/bash
set -euo pipefail
export LC_ALL=C
IOS_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEST_ROOT="$IOS_ROOT/build/engine-host"
FRAMEWORK_ROOT="$IOS_ROOT/Vendor/whisper.xcframework/macos-arm64_x86_64"
mkdir -p "$TEST_ROOT"

if [[ ! -d "$FRAMEWORK_ROOT" ]]; then
  "$IOS_ROOT/scripts/bootstrap.sh"
fi

verify_sha256() {
  local actual
  actual="$(shasum -a 256 "$1" | cut -d ' ' -f 1)"
  if [[ "$actual" != "$2" ]]; then
    echo "Checksum mismatch for $1; remove the cached file and retry." >&2
    exit 1
  fi
}

AUDIO_PATH="${WORDVALE_ENGINE_TEST_AUDIO:-$TEST_ROOT/jfk.wav}"
MODEL_PATH="${WORDVALE_ENGINE_TEST_MODEL:-$TEST_ROOT/ggml-tiny.en.bin}"
if [[ ! -f "$AUDIO_PATH" ]]; then
  curl --fail --location --retry 3 \
    'https://raw.githubusercontent.com/ggml-org/whisper.cpp/v1.7.6/samples/jfk.wav' --output "$AUDIO_PATH"
fi
verify_sha256 "$AUDIO_PATH" 59dfb9a4acb36fe2a2affc14bacbee2920ff435cb13cc314a08c13f66ba7860e
if [[ ! -f "$MODEL_PATH" ]]; then
  curl --fail --location --retry 3 \
    'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin?download=true' --output "$MODEL_PATH"
fi
verify_sha256 "$MODEL_PATH" 921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f

python3 - "$AUDIO_PATH" "$TEST_ROOT/long.wav" <<'PY'
import sys, wave
with wave.open(sys.argv[1], 'rb') as source:
    parameters = source.getparams()
    samples = source.readframes(source.getnframes())
with wave.open(sys.argv[2], 'wb') as output:
    output.setparams(parameters)
    output.writeframes(samples * 32)
PY

xcrun swiftc -O -swift-version 5 -target "$(uname -m)-apple-macos13.3" \
  -F "$FRAMEWORK_ROOT" -framework whisper \
  -Xlinker -rpath -Xlinker "$FRAMEWORK_ROOT" \
  "$IOS_ROOT/Wordvale/Audio/AudioDecoder.swift" \
  "$IOS_ROOT/Wordvale/Engine/WhisperEngine.swift" \
  "$IOS_ROOT/TestsSupport/EngineSmoke.swift" \
  -o "$TEST_ROOT/EngineSmoke"

if ! "$TEST_ROOT/EngineSmoke" "$AUDIO_PATH" "$MODEL_PATH" "$TEST_ROOT/long.wav" > "$TEST_ROOT/result.log" 2>&1; then
  cat "$TEST_ROOT/result.log"
  exit 1
fi
tail -7 "$TEST_ROOT/result.log"
echo "Full engine log: $TEST_ROOT/result.log"
