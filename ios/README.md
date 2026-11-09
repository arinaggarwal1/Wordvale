# Wordvale for iPhone

This is the native iOS port of Wordvale: a SwiftUI interface, AVFoundation audio capture/decoding, and the same Whisper model family running locally through whisper.cpp with Metal acceleration. It targets **iOS 17 or later**, including **iPhone 15 Pro**. The desktop app remains a separate target.

## Install the IPA

The build is `ios/dist/Wordvale-iOS.ipa`. It is **unsigned**, ready for a sideloading tool to sign with your own Apple account. An unsigned IPA cannot be installed merely by opening it in Files, and no signing identity is chosen automatically by the build script.

The simplest Mac route is [Sideloadly](https://sideloadly.io/):

1. Connect and unlock the iPhone, and trust the Mac if prompted.
2. Open Sideloadly, choose the iPhone, and drag `Wordvale-iOS.ipa` into it.
3. Use your own Apple account in Sideloadly and start installation. Keep the bundle identifier consistent when updating if you want to retain your recordings and transcripts.
4. Follow any device trust prompt in Settings → General → VPN & Device Management. Enable Settings → Privacy & Security → Developer Mode if iOS requests it; this can require a restart.
5. Open Wordvale, download **Base** on the Models tab, then import audio or make a recording.

[AltStore Classic](https://faq.altstore.io/altstore-classic/how-to-install-altstore-macos) is another option: install AltServer/AltStore using its official guide, then add this IPA from AltStore's My Apps tab. Free-account installations normally expire after seven days and need refreshing; [AltStore documents the refresh process and three-app restriction](https://faq.altstore.io/altstore-classic/your-altstore). Sideloadly also offers automatic refreshing. Do not delete the app to refresh it: deleting an iOS app deletes its local data.

## First use

- Download a model while online. Base is the default balance of size and quality; Tiny uses less space, and Small costs more time and memory. Downloads are checked against pinned SHA-256 hashes before becoming available.
- Import one or more files from Files, or use the microphone. Apple-supported audio/video formats such as M4A, MP3, WAV, MP4, and MOV are decoded with AVFoundation; a container or codec unsupported by iOS must be converted first.
- Keep Wordvale open during transcription. The app prevents automatic screen locking during active work. iOS may suspend CPU/GPU processing when you leave the app; the audio background permission supports microphone recording, not unlimited background transcription.
- Transcripts and managed recordings stay in the app's local library. Search, playback, copying, and export work offline. The iOS target does not require a Wordvale or Firebase account.
- Initial model downloads contact Hugging Face. Your audio and transcripts are not uploaded for inference. Models are excluded from backups because they can be downloaded again.

## Build again

Requires a Mac with full Xcode 16.2 or later and its iOS SDK. Run from the repository root:

```bash
ios/scripts/build-ipa.sh
```

The script downloads pinned, checksum-verified build dependencies into ignored local folders, generates `ios/Wordvale.xcodeproj`, builds an optimized arm64 device app, embeds the Whisper framework, and creates the IPA plus `Wordvale-iOS.ipa.sha256`. It does not log into an Apple account or register a device. After the first dependency download, rebuilding does not require a model download.

To open and run the source from Xcode:

```bash
ios/scripts/bootstrap.sh
open ios/Wordvale.xcodeproj
```

Select the Wordvale scheme and your simulator or device. To run on your own physical phone from Xcode, choose your team under Signing & Capabilities. A newer iPhone OS may require a newer Xcode for debugging even though the built app's minimum iOS version remains 17.

For an IPA signed using an **already installed, matching** local identity and provisioning profile:

```bash
DEVELOPMENT_TEAM=YOUR_TEAM_ID \
CODE_SIGN_IDENTITY='Apple Development: Your Name (IDENTIFIER)' \
PROVISIONING_PROFILE_SPECIFIER='Your Existing Profile' \
ios/scripts/build-ipa.sh --signed
```

That mode does not create profiles or contact Apple's provisioning service. A development/ad hoc profile must include the device you intend to use. Signing is optional because Sideloadly/AltStore perform it when installing the default IPA.

## Verify changes

```bash
ios/scripts/bootstrap.sh
xcodebuild -project ios/Wordvale.xcodeproj -scheme Wordvale \
  -destination 'platform=iOS Simulator,name=iPhone 15 Pro' \
  -derivedDataPath ios/build/tests \
  CODE_SIGNING_ALLOWED=NO test
```

Use an available simulator name from `xcrun simctl list devices available`. Install a compatible runtime through Xcode Settings → Components if necessary. Unit and UI test targets are included in the project. Simulator results validate application behavior; they are not iPhone thermal, battery, or GPU benchmarks. Check [VALIDATION.md](VALIDATION.md) for the actual verification performed on this port. This Mac needed the filesystem workaround documented in [SIMULATOR-TESTING.md](SIMULATOR-TESTING.md) to install test apps.

The offline core checks run with `ios/scripts/test-core-host.sh`.

The actual inference smoke test runs on this Mac using the same Swift engine and the macOS slice of the pinned Whisper framework:

```bash
ios/scripts/test-engine-host.sh
```

It checks real speech, word timings, a recording longer than five minutes, and cancellation. To also enable the optional full pipeline test in the simulator, prepare the fixtures at its expected host paths before running `xcodebuild test`:

```bash
WORDVALE_ENGINE_TEST_AUDIO=/tmp/wordvale-jfk.wav \
WORDVALE_ENGINE_TEST_MODEL=/tmp/wordvale-ggml-tiny.en.bin \
ios/scripts/test-engine-host.sh
```

The optional test skips when those fixtures are absent. It exercises actual import, audio decoding, Whisper inference, queue completion, exports, persistence, and deletion. These `/tmp` paths are test inputs only and are not used by the iPhone app.

## Why a native port

The desktop program launches Python, ffmpeg, and a command-line transcription sidecar through Tauri 1. That process model does not carry over to an ordinary sandboxed iOS app. The port links Whisper directly into the app and uses system audio APIs.

The iPhone 15 Pro has Apple's A17 Pro with a six-core GPU ([Apple specifications](https://support.apple.com/en-us/111829)). Apple's [Metal feature tables](https://developer.apple.com/metal/Metal-Feature-Set-Tables.pdf) list A17 Pro as Apple GPU family 9, also shared by M3. This makes a Metal-backed Whisper implementation feasible, but does not imply Mac-like sustained speed or memory capacity. The app therefore offers Tiny, Base, and Small variants and processes one recording at a time. No unmeasured speed claim is made.

The integration uses the official [whisper.cpp v1.7.6 XCFramework](https://github.com/ggml-org/whisper.cpp/releases/tag/v1.7.6), pinned for compatibility with the available Xcode 16.2 toolchain. It contains device, simulator, and macOS slices. The iOS app embeds only the device framework when packaged. See `ENGINE-NOTES.md` for implementation details and `Wordvale/ThirdPartyNotices.txt` for the license.

## Scope

The iOS port covers local import/recording, sequential transcription, language selection, translation to English with multilingual models, optional word timestamps, transcript library/search, playback, model management, and text/subtitle/JSON export. iOS does not allow ordinary apps to capture arbitrary system audio or telephone calls. Desktop-only account sign-in, automatic desktop updates, and the Mac recorder helper are not included. This first iOS build should be checked with a short recording on your physical phone before relying on it for a long session.

## Pinned build inputs

| Input | Version | SHA-256 of release archive |
|---|---|---|
| [XcodeGen](https://github.com/yonaskolb/XcodeGen/releases/tag/2.46.0) | 2.46.0 | `4d9e34b62172d645eed6457cac13fc222569974098ef4ee9c3368bedf0196806` |
| [whisper.cpp XCFramework](https://github.com/ggml-org/whisper.cpp/releases/tag/v1.7.6) | 1.7.6 | `9fcb28106d0b94a525e59bec057e35b57033195ac7408d7e1ab8e4b597cdfeb5` |
