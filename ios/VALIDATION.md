# iPhone port verification

Original port verified on November 5, 2026; release package rebuilt on November 8, 2026 as version 0.4.0 (build 2) using Xcode 16.2 and the iOS 18.2 SDK. The release rebuild changes version metadata only; prior behavioral verification is recorded below. The target is arm64 iPhone, minimum iOS 17. This records observed results, not a claim of physical-device certification.

## Deliverable

- `dist/Wordvale-iOS.ipa`, also copied to `~/Downloads/Wordvale-iOS.ipa`.
- Unsigned application for Sideloadly/AltStore to re-sign. No Apple account or installed signing identity was used.
- Optimized Release build succeeded. The IPA has the expected `Payload/Wordvale.app`, arm64 iOS executable and embedded Whisper framework, icon, privacy manifest, and third-party license.
- Verified archive CRC, embedded-library dependencies, iOS platform load commands, minimum OS version, iPhone device family, absence of encryption/provisioning profiles, and absence of coverage instrumentation.
- Release SHA-256: `a69480797845be7ead9d54b439f9e759953a78e9c9ab1d8ffc6af5f046aff79f` (1,160,955 bytes).

## Real inference on this Mac

`ios/scripts/test-engine-host.sh` compiles the production Swift engine and audio decoder against the macOS slice of the same pinned Whisper XCFramework. It uses a checksum-verified upstream speech sample and Tiny English model.

Observed passes:

- 11-second speech recording: expected transcript, 2 segments, 22 word timings.
- 352-second speech recording: 68 segments and 737 word timings, exercising a five-minute chunk boundary with ordered, in-range global timestamps.
- Progress reporting, missing-model handling, and cancellation during actual inference.
- Metal initialization and the engine's abort callback are present in the log.

Evidence: `build/engine-host/result.log`. This validates the shared code and Metal inference path on the Mac; it does not measure A17 Pro speed, memory limits, heat, or battery use.

## Core behavior on this Mac

`ios/scripts/test-core-host.sh` compiles the production domain, storage, model management, and audio decoder sources into an independent executable.

Observed passes:

- Plain text, timed text, SRT, WebVTT, JSON, and karaoke ASS output.
- Timestamp hour rollover, WebVTT escaping, reliable karaoke timing checks, Unicode filename limits, and path sanitization.
- Persistent transcript and queue recovery; interrupted jobs become retryable.
- Invalid library JSON is preserved rather than replaced silently.
- Audio import copies, reference-aware deletion, source preservation, and invalid/empty import errors.
- SHA-256 verification, same-size corruption rejection, incomplete-file rejection, and refusal to delete an active model.
- 48 kHz stereo audio decoding to 16 kHz mono Float32 and decoding cancellation.

Evidence: `build/core-host/result.log`.

The optional real network checks also passed (`WORDVALE_TEST_DOWNLOAD=1 ios/scripts/test-core-host.sh` and `WORDVALE_TEST_DOWNLOAD=cancel ios/scripts/test-core-host.sh`): Tiny English download, observed progress, SHA-256 verification, install/reopen/delete, cancellation before setup and during transfer, and rejection of an HTTP error. Evidence: `build/core-host/result-network.log` and `build/core-host/result-cancel.log`. These tests caught and fixed an OS-dependent issue in the async URLSession convenience API; production now uses an explicit delegate download task with safe staging and cancellation.

## Simulator and physical-device status

The native app launches on an iPhone 15 Pro simulator running iOS 18.3.1. The final suite passed **15 tests with zero failures**: 13 unit/integration tests and 2 native UI tests. The real full import → decode → Whisper → queue → export → save/reopen → delete flow was executed, not skipped. UI checks cover file-importer cancellation, navigation across all three tabs, transcription settings, and switching word timestamps on and off.

Evidence: `build/SimulatorTestsFinalHFS.xcresult`; `xcodebuild` completed with `TEST EXECUTE SUCCEEDED`. The final test build includes the updated model downloader.

Actual screenshots were inspected in light mode, dark mode, and accessibility large text, with no horizontal clipping and readable primary controls. A final contrast pass corrected supporting copy; the updated text measured 5.67:1 on white and 5.34:1 on warm paper. Both UI tests passed again after this style-only pass (`build/SimulatorUITestsContrast.xcresult`). Seven final screenshots are in `.impeccable/review/ios/` at the repository root.

Initial simulator installation stalled in a host filesystem `clonefileat` operation. Copying test products to a temporary HFS+ volume avoided the APFS cloning problem and allowed installation and test execution. This was a host test-environment issue. See `SIMULATOR-TESTING.md` for the repeatable workaround.

Physical iPhone sideload installation, microphone input/interruptions, actual background transitions, and sustained device inference remain unverified. The phone was not modified. The first physical-device check should be a short recording with Base or Tiny, followed by playback/export and a foreground/background interruption.

## Known scope differences

- Transcription runs in the foreground. Leaving the foreground stops the current attempt; the recording is retained and can be retried from the beginning.
- Microphone recording uses the iOS audio background mode. iOS does not permit ordinary apps to record arbitrary other-app audio or telephone calls.
- AVFoundation supports Apple's media decoders, not every format supported by desktop FFmpeg.
- Translation produces an English transcript. The desktop app's paired original-plus-English view is not duplicated automatically.
- Tiny, Base, Small, and compact Small variants are offered. Larger desktop models are omitted pending physical-device memory and thermal testing.
- Model downloads require a connection and are excluded from backups. Audio is not uploaded for transcription; normal user-configured iOS backups may include the library.
- Synchronous AVAsset metadata methods produce deprecation warnings; they run on the engine's worker thread and remain supported by the build SDK.
