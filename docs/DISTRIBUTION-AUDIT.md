# Distribution audit

Date: November 3, 2026. Target: published `v0.3.0-alpha.1` Apple silicon DMG, plus the current working tree. This is the historical diagnosis of Alpha 1. The release preparation note below records subsequent changes.

## Findings in priority order

### High: actual minimum macOS version is 15, not 10.15

The released Info.plist declares `LSMinimumSystemVersion=10.15` (`src-tauri/tauri.conf.json:69`). `vtool -show-build` reports `minos 15.0` for the bundled whisper-cli and all six Whisper/ggml dylibs. The recorder itself targets macOS 13. The UI can therefore launch on an older supported Apple silicon system while transcription cannot.

Resolution: either rebuild and test the complete Whisper runtime for an explicitly supported older deployment target, or declare macOS 15 consistently in app metadata, website, README, and release notes. Changing only the plist cannot create older-OS support.

### High: released app fails signature verification

The downloaded app has only a linker/ad-hoc signature, no TeamIdentifier, unbound Info.plist, and no sealed resources. Both `codesign --verify --deep --strict` and `spctl --assess --type execute` reject it with `code has no resources but signature indicates they must be present`. This is stronger evidence than merely observing the absence of a Developer ID certificate. Exact Gatekeeper UI depends on macOS version and download quarantine; it was not reproduced in a fresh GUI login.

Resolution: sign the finished app, nested helpers, and libraries correctly, then notarize and staple for ordinary distribution. Verify the final DMG artifact in CI. Developer ID signing requires the owner's Apple credentials and certificate setup.

### High: disk/write failures are silently ignored during recording

`recorder/Recorder.swift:48` and `:64` use `try?` for captured audio writes. Disk-full or filesystem errors can discard samples while the frontend continues showing a running recorder and elapsed time.

Resolution: report fatal write errors to the parent, stop capture, preserve existing audio, and surface the failure. Test failure handling with a controlled failing writer rather than filling the user's disk.

### High: failed finalization can hide a recoverable draft

`src-tauri/src/main.rs:112` writes FFmpeg output directly to `meeting.wav`. The pending marker is created only after FFmpeg succeeds. If FFmpeg creates the file and then fails or is interrupted, `recording_recoverable` at `:133` excludes the folder because `meeting.wav` exists and there is no pending marker. `recording_recover` at `:154` also treats existence as completion. The frontend then tells the user to restore a draft that may be absent.

Resolution: write a temporary WAV, validate and atomically rename it on success; use an explicit completion/pending state. Preserve raw capture files and ensure failures remain listed for recovery.

### Medium: permission identity differs between builds

The recorder is a separate executable. The supplied System Settings screenshot shows two Wordvale identities with different access grants. Enabling the packaged app may not authorize a development build/helper. CoreGraphics preflight alone also blocked retries in the published frontend.

Status: the working tree now retries with ScreenCaptureKit on explicit selection and preserves a successful result for the session; this is not in the released DMG. Actual granting, revoking, relaunching, and capture still need testing in a clean user session and after an update. Stable signing is relevant to keeping identity consistent.

### Medium: future alpha downloads can diverge between website and app

`.github/workflows/release-dmg.yml:92` marks every hyphenated version as a GitHub prerelease. The website uses GitHub's `/releases/latest` endpoint, which excludes prereleases, while the in-app updater considers both stable and prerelease versions. The existing Alpha 1 release was manually marked Latest, but the next automatic alpha release would revert to the old policy.

Resolution: encode the requested policy in the workflow: alpha in version/title/notes, published as Latest if that remains the chosen release policy. Otherwise explicitly make the website select prereleases too.

### Medium: SSL fix is local, not distributed

The published model downloader relies on Python/OpenSSL default certificate locations. The current fix passes certifi's CA bundle explicitly and packages its data. All five model download tests passed, including missing system certificate paths. A live Hugging Face download through redirects returned a valid GGML header using the bundled CA roots with system paths set to nonexistent directories.

Resolution: build and publish a new version containing the fix. No change to the recipient's certificate verification settings is needed.

## Checks that passed

- Downloaded and mounted the published DMG read-only; checked its contents and actual binary metadata.
- All three executables are arm64. Intel is unsupported by this artifact, consistent with the Apple silicon download label.
- Published backend started with a fresh temporary HOME/TMPDIR, minimal system PATH, and working directory `/`; responded to system-info and shut down cleanly. No Python, Rust, or Homebrew install was needed by that process.
- Bundled whisper-cli `--help` and FFmpeg `-version` succeeded under that same minimal environment.
- Whisper dylibs and Metal source are present in the released resources. The CLI includes `@executable_path` in its runtime search paths, so its additional stale developer-machine rpaths are cleanup debt rather than a demonstrated missing-library failure.
- The released app contains microphone and screen-capture usage descriptions.
- All 28 current Python backend tests passed.

## Limits and next release checks

This Mac runs a newer OS and is an existing development machine. A temporary HOME tests many path assumptions but does not isolate macOS Keychain, TCC permissions, Gatekeeper state, hardware, or system frameworks. No complete recording/transcription GUI flow, full-model network-failure test, low-disk recording test, or update install/rollback was performed on a second Mac. Test the final signed artifact on the oldest claimed macOS version and on a fresh current macOS user account, including Google/email login, model download, microphone/system capture, export, restart, and update. Current tests do not establish those release properties.

## Release preparation update — November 8, 2026

Version `0.4.0-alpha.1` includes the bundled certificate roots and ScreenCaptureKit permission retry fixes, aligns packaged minimum macOS metadata to 15, and seals the complete macOS app with an ad-hoc signature verified during packaging. It does not add Developer ID notarization. The release workflow now publishes the DMG and unsigned iOS IPA together with checksums and preserves the existing alpha-as-Latest policy. The recorder write-error and failed-finalization findings above remain unresolved; this release does not claim to fix them.
