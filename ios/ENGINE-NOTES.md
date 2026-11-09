# iOS transcription engine

The iOS app links the official **whisper.cpp v1.7.6 XCFramework** and invokes its C API in process. It does not launch the desktop Python server, a command-line child process, or FFmpeg. The official archive includes device arm64, simulator, and macOS slices; the app embeds the dynamic iOS framework. Its Metal shader library is embedded in the framework. The dependency is deliberately pinned to a release compatible with the available Xcode 16.2 toolchain rather than following the newest release automatically.

The device build enables Metal and flash attention. Simulator builds use CPU inference because simulator GPU behavior is not a useful iPhone performance measurement. The A17 Pro in iPhone 15 Pro supports Metal, but phone memory limits, battery use, and heat differ from a Mac. Tiny, Base, and Small are sensible initial model options; a Mac's Large-model default should not be copied to the phone without device measurement. No actual iPhone performance or battery claim has been measured by this implementation.

## Implementation

- `Engine/WhisperEngine.swift` owns a serial inference queue. The context is created and destroyed for each job, keeping large model allocations out of idle app memory. A locked job token supports both Swift task cancellation and the engine's explicit `cancel()` method, with abort and encoder callbacks into whisper.cpp.
- `Audio/AudioDecoder.swift` uses AVFoundation to decode the first audio track to 16 kHz mono Float32 PCM. This supports the formats Apple's installed decoders support, including ordinary M4A, MP3, WAV and MP4/MOV audio; it does not promise the full FFmpeg format set.
- Decoded PCM is spooled to a temporary file. Inference reads at most five minutes of PCM per chunk (~19.2 MB), choosing a low-energy split in the final five seconds. Samples are consumed exactly once and timestamps receive the chunk's global offset. Context does not carry between chunks. A cut in continuous speech can still affect a boundary word; this is an intentional memory/reliability tradeoff for long recordings.
- Language detection happens in the first chunk and its result is reused. English-only models reject non-English selection and translation. Optional word timings group whisper token timings; they remain model estimates, especially for languages without spaces.
- `Audio/AudioRecorder.swift` records AAC to an app-private M4A in Application Support/PendingRecordings. It requests microphone permission, meters input, and preserves partial recordings on calls, input disconnection, and audio-service resets. The app observes `recoveredRecordingURL`, imports it into its library, then calls `acknowledgeRecoveredRecording()`. At startup, `AudioRecorder.pendingURLs()` discovers captures left behind by termination or failed saves. Source files are removed only after successful library import.
- The current AVAsset metadata reads use synchronous APIs on the dedicated worker, never the main thread. Xcode emits deprecation warnings for these iOS 16-era APIs; they remain available in the iOS 18.2 SDK used here.

## Sources

- [Official whisper.cpp v1.7.6 release](https://github.com/ggml-org/whisper.cpp/releases/tag/v1.7.6)
- [Official XCFramework artifact](https://github.com/ggml-org/whisper.cpp/releases/download/v1.7.6/whisper-v1.7.6-xcframework.zip): SHA-256 `9fcb28106d0b94a525e59bec057e35b57033195ac7408d7e1ab8e4b597cdfeb5`.
- [Upstream SwiftUI iOS example and model recommendations](https://github.com/ggml-org/whisper.cpp/blob/v1.7.6/examples/whisper.swiftui/README.md)
- [Pinned C API, parameters, progress and cancellation callbacks](https://github.com/ggml-org/whisper.cpp/blob/v1.7.6/include/whisper.h)
- [Apple AVAssetReaderTrackOutput](https://developer.apple.com/documentation/avfoundation/avassetreadertrackoutput)
- [Apple microphone permission requirements](https://developer.apple.com/documentation/avfaudio/avaudiosession/requestrecordpermission(_:))
- [Apple handling audio interruptions](https://developer.apple.com/documentation/avfaudio/handling-audio-interruptions)

## Verification

The three Swift files typecheck against the official iOS arm64 framework using Xcode 16.2 / iOS 18.2 SDK with an iOS 16.4 deployment target. Host inference verification passed using the same Swift engine and AVFoundation decoder linked to the macOS slice of the same XCFramework, plus the upstream 11-second JFK sample and SHA-256-verified Tiny English model. The Metal run produced the expected speech, two timed segments and 22 word timings. A 352-second repeated speech fixture produced 68 segments and 737 word timings with timestamps crossing the five-minute chunk boundary in order. Progress, missing-model errors, and mid-inference cancellation also passed; the latter reached the C encoder abort callback. A host pass exercises the inference path but does not substitute for microphone, thermal, and sideload testing on the physical iPhone.

Run the repeatable integration harness from the repository root:

```sh
ios/scripts/test-engine-host.sh
```

It caches verified input assets and the full engine log under `ios/build/engine-host/`. It downloads approximately 78 MB the first time. To reuse already downloaded fixtures, set `WORDVALE_ENGINE_TEST_AUDIO` and `WORDVALE_ENGINE_TEST_MODEL` to their absolute paths. To prepare the paths used by the optional simulator pipeline test:

```sh
WORDVALE_ENGINE_TEST_AUDIO=/tmp/wordvale-jfk.wav \
WORDVALE_ENGINE_TEST_MODEL=/tmp/wordvale-ggml-tiny.en.bin \
ios/scripts/test-engine-host.sh
```

The test fixture SHA-256 values are `59dfb9a4acb36fe2a2affc14bacbee2920ff435cb13cc314a08c13f66ba7860e` for [the pinned JFK WAV](https://raw.githubusercontent.com/ggml-org/whisper.cpp/v1.7.6/samples/jfk.wav) and `921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f` for [Tiny English](https://huggingface.co/ggerganov/whisper.cpp/blob/main/ggml-tiny.en.bin).

The independent core harness compiles the actual domain, exporter, storage, model manager, and decoder sources on macOS, without UIKit or a simulator:

```sh
ios/scripts/test-core-host.sh
WORDVALE_TEST_DOWNLOAD=1 ios/scripts/test-core-host.sh
```

The first command needs no network. It covers every export format, Unicode filenames, persistence and corruption handling, interrupted queue recovery, recording copy/reference cleanup, model integrity, model deletion safeguards, and stereo resampling. The second additionally downloads Tiny English through the actual model manager, verifies progress, SHA-256, installation/reopening/deletion, and cancellation. Logs are stored separately at `ios/build/core-host/result.log`, `result-network.log`, and, for the cancellation-only `WORDVALE_TEST_DOWNLOAD=cancel` mode, `result-cancel.log`.

The network test uncovered that the OS's async `URLSession.download(for:delegate:)` path did not deliver progress callbacks. The final implementation uses an explicit `URLSessionDownloadTask`, moves the temporary download before the completion delegate returns, resumes its checked continuation exactly once, and cancels/invalidates the session through a locked state machine. [Apple documents the download task callbacks and temporary-file lifetime](https://developer.apple.com/documentation/foundation/urlsessiondownloadtask). The full real download passed after this fix; this check validates the actual app's transport path rather than a separate curl download.
