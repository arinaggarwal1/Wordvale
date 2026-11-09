#!/bin/bash
set -euo pipefail
export LC_ALL=C
IOS_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODE="${1:---unsigned}"
case "$MODE" in
  --help|-h)
    cat <<'USAGE'
Usage: ios/scripts/build-ipa.sh [--unsigned|--signed]

Default: builds an unsigned arm64 IPA for Sideloadly/AltStore to re-sign.
--signed: uses an existing local signing identity and provisioning profile.
          Requires DEVELOPMENT_TEAM and CODE_SIGN_IDENTITY environment variables.
          Optional PROVISIONING_PROFILE_SPECIFIER selects an installed profile.
          No Apple account login or profile registration is performed.

Optional configuration: CONFIGURATION (default Release), OUTPUT_DIR (default ios/dist).
USAGE
    exit 0 ;;
  --unsigned|--signed) ;;
  *) echo "Unknown argument: $MODE" >&2; exit 2 ;;
esac

"$IOS_ROOT/scripts/bootstrap.sh"
CONFIGURATION="${CONFIGURATION:-Release}"
OUTPUT_DIR="${OUTPUT_DIR:-$IOS_ROOT/dist}"
BUILD_ROOT="$IOS_ROOT/build/ipa-$MODE"
mkdir -p "$OUTPUT_DIR" "$BUILD_ROOT"
OUTPUT_DIR="$(cd "$OUTPUT_DIR" && pwd)"
SIGNING_ARGS=()
if [[ "$MODE" == --signed ]]; then
  : "${DEVELOPMENT_TEAM:?Set DEVELOPMENT_TEAM for --signed}"
  : "${CODE_SIGN_IDENTITY:?Set CODE_SIGN_IDENTITY for --signed}"
  SIGNING_ARGS+=("DEVELOPMENT_TEAM=$DEVELOPMENT_TEAM" "CODE_SIGN_IDENTITY=$CODE_SIGN_IDENTITY")
  if [[ -n "${PROVISIONING_PROFILE_SPECIFIER:-}" ]]; then
    SIGNING_ARGS+=("CODE_SIGN_STYLE=Manual" "PROVISIONING_PROFILE_SPECIFIER=$PROVISIONING_PROFILE_SPECIFIER")
  fi
else
  SIGNING_ARGS+=("CODE_SIGNING_ALLOWED=NO" "CODE_SIGNING_REQUIRED=NO" "CODE_SIGN_IDENTITY=")
fi

xcodebuild \
  -project "$IOS_ROOT/Wordvale.xcodeproj" \
  -scheme Wordvale \
  -configuration "$CONFIGURATION" \
  -sdk iphoneos \
  -destination 'generic/platform=iOS' \
  -derivedDataPath "$BUILD_ROOT/DerivedData" \
  ENABLE_CODE_COVERAGE=NO \
  "${SIGNING_ARGS[@]}" \
  build

APP_PATH="$BUILD_ROOT/DerivedData/Build/Products/$CONFIGURATION-iphoneos/Wordvale.app"
[[ -x "$APP_PATH/Wordvale" ]] || { echo "Build produced no app executable" >&2; exit 1; }
[[ -f "$APP_PATH/Frameworks/whisper.framework/whisper" ]] || { echo "Missing embedded Whisper framework" >&2; exit 1; }
lipo "$APP_PATH/Wordvale" -verify_arch arm64
plutil -lint "$APP_PATH/Info.plist"

STAGING="$(mktemp -d "$BUILD_ROOT/payload.XXXXXX")"
PACKAGE_STAGING=""
cleanup() {
  if [[ -d "$STAGING" ]]; then /bin/rm -r "$STAGING"; fi
  if [[ -n "$PACKAGE_STAGING" && -d "$PACKAGE_STAGING" ]]; then /bin/rm -r "$PACKAGE_STAGING"; fi
}
trap cleanup EXIT
mkdir -p "$STAGING/Payload"
ditto "$APP_PATH" "$STAGING/Payload/Wordvale.app"
IPA_NAME=Wordvale-iOS.ipa
if [[ "$MODE" == --signed ]]; then
  IPA_NAME=Wordvale-iOS-signed.ipa
  [[ -f "$STAGING/Payload/Wordvale.app/embedded.mobileprovision" ]] || {
    echo "Signed build has no embedded provisioning profile; it cannot be installed on a device." >&2
    exit 1
  }
  codesign --verify --deep --strict "$STAGING/Payload/Wordvale.app"
fi
IPA_PATH="$OUTPUT_DIR/$IPA_NAME"
# Package on the destination volume, then rename over the old artifact only
# after both ZIP creation and checksum generation have succeeded.
PACKAGE_STAGING="$(mktemp -d "$OUTPUT_DIR/.wordvale-package.XXXXXX")"
(cd "$STAGING" && /usr/bin/zip -qry "$PACKAGE_STAGING/$IPA_NAME" Payload)
(cd "$PACKAGE_STAGING" && shasum -a 256 "$IPA_NAME" > "$IPA_NAME.sha256")
mv -f "$PACKAGE_STAGING/$IPA_NAME" "$IPA_PATH"
mv -f "$PACKAGE_STAGING/$IPA_NAME.sha256" "$OUTPUT_DIR/$IPA_NAME.sha256"
echo "Created $IPA_PATH"
if [[ "$MODE" == --unsigned ]]; then
  echo "This IPA must be re-signed by Sideloadly, AltStore, or your own provisioning workflow before installation."
fi
