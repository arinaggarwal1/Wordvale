# Simulator verification

The iOS project includes application tests and native UI tests. The optional real-inference test uses the JFK sample and Tiny English model prepared by the host smoke test described in `README.md`. Without those two files, only that integration test skips; the other tests do not need a model download.

Normal workflow, from the repository root:

```bash
ios/scripts/bootstrap.sh
xcrun simctl list devices available
xcodebuild test \
  -project ios/Wordvale.xcodeproj -scheme Wordvale \
  -destination 'platform=iOS Simulator,id=YOUR_SIMULATOR_UDID' \
  -parallel-testing-enabled NO \
  -derivedDataPath ios/build/simulator \
  -resultBundlePath ios/build/SimulatorTests.xcresult \
  CODE_SIGNING_ALLOWED=NO
```

Choose a fresh result-bundle path for each run. The UI tests use an English simulator and capture native screenshots as test attachments. They do not record the microphone or download models.

## Workaround for this Mac’s simulator install hang

On the development host (macOS 15.1.1, Xcode 16.2, iOS 18.3.1 simulator), app installation initially stalled before any app code ran. A process sample showed `CoreSimulatorBridge` blocked in `IXCopyItemAtURL → copyfile → clonefileat`. Rebooting the simulator, restarting CoreSimulatorService, and ad-hoc signing a temporary copy did not fix installation. Copying the build products onto a temporary **HFS+ disk image** made installation succeed by avoiding the APFS clone path.

This is a host testing workaround; it does not change the IPA or the app’s filesystem behavior. Use it only if normal installation stalls with that evidence.

First compile the test products normally:

```bash
xcodebuild build-for-testing \
  -project ios/Wordvale.xcodeproj -scheme Wordvale \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath ios/build/simulator \
  CODE_SIGNING_ALLOWED=NO
```

Then create a temporary volume and copy **all** products, including the `.xctestrun` file. Run this block with Bash. If the volume name is already mounted, reuse the existing temporary volume rather than creating another one with the same name.

```bash
SIMULATOR_ID='YOUR_SIMULATOR_UDID'
SIM_TEST_TEMP="$(mktemp -d /tmp/wordvale-sim-tests.XXXXXX)"
hdiutil create -size 256m -fs HFS+ -volname WordvaleSimTests \
  "$SIM_TEST_TEMP/source.dmg"
hdiutil attach -nobrowse "$SIM_TEST_TEMP/source.dmg"
ditto ios/build/simulator/Build/Products /Volumes/WordvaleSimTests/Products

for TEST_RUN in /Volumes/WordvaleSimTests/Products/*.xctestrun; do
  xcodebuild test-without-building \
    -xctestrun "$TEST_RUN" \
    -destination "platform=iOS Simulator,id=$SIMULATOR_ID" \
    -parallel-testing-enabled NO \
    -resultBundlePath ios/build/SimulatorTestsHFS.xcresult
done
```

The generated `.xctestrun` uses `__TESTROOT__` paths, so it remains valid after moving the entire Products directory. Rebuild and recopy Products after any source or test change. Keep the volume mounted until tests finish. Afterwards:

```bash
hdiutil detach /Volumes/WordvaleSimTests
```

The temporary image can then be removed from the `SIM_TEST_TEMP` directory. Do not delete unrelated simulators, reset Xcode settings, or reboot the Mac to apply this workaround.

## Screenshots

The implementation was visually checked on an iPhone 15 Pro simulator in light mode, dark mode, and at the `accessibility-large` Dynamic Type size. Captures live in `.impeccable/review/ios/` at the repository root.

```bash
xcrun simctl ui "$SIMULATOR_ID" appearance dark
xcrun simctl io "$SIMULATOR_ID" screenshot /tmp/wordvale-dark.png
xcrun simctl ui "$SIMULATOR_ID" content_size accessibility-large
xcrun simctl io "$SIMULATOR_ID" screenshot /tmp/wordvale-large-type.png
xcrun simctl ui "$SIMULATOR_ID" content_size large
xcrun simctl ui "$SIMULATOR_ID" appearance light
```

Use a running app and allow the appearance change to settle before each capture. Simulator validation does not establish physical-device Metal performance, battery use, microphone quality, or signing/provisioning compatibility.
