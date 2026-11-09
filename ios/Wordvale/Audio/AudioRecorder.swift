import AVFoundation
import Combine
import Foundation

#if os(iOS)
/// Microphone capture stays in the app's sandbox. A phone call or disconnected
/// input finishes and preserves the partial recording instead of discarding it.
@MainActor
final class AudioRecorder: NSObject, ObservableObject, AVAudioRecorderDelegate {
    @Published private(set) var isRecording = false
    @Published private(set) var isStarting = false
    @Published private(set) var duration: TimeInterval = 0
    @Published private(set) var level: Float = 0
    @Published var errorMessage: String?
    @Published private(set) var recoveredRecordingURL: URL?

    private var recorder: AVAudioRecorder?
    private var recordingURL: URL?
    private var timer: Timer?
    private var observers: [NSObjectProtocol] = []

    override init() {
        super.init()
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: AVAudioSession.interruptionNotification,
                                             object: nil, queue: .main) { [weak self] notification in
            let type = (notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? NSNumber)?.uintValue
            guard type == AVAudioSession.InterruptionType.began.rawValue else { return }
            Task { @MainActor [weak self] in
                self?.preserveInterruptedRecording(message: "Recording was interrupted. Your audio up to that point was saved.")
            }
        })
        observers.append(center.addObserver(forName: AVAudioSession.routeChangeNotification,
                                             object: nil, queue: .main) { [weak self] notification in
            let reason = (notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? NSNumber)?.uintValue
            guard reason == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue else { return }
            Task { @MainActor [weak self] in
                self?.preserveInterruptedRecording(message: "The audio input disconnected. Your recording was saved.")
            }
        })
        observers.append(center.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification,
                                             object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.preserveInterruptedRecording(message: "The audio service restarted. Your recording was saved where possible.")
            }
        })
    }

    deinit {
        timer?.invalidate()
        for observer in observers { NotificationCenter.default.removeObserver(observer) }
    }

    func start() async throws {
        guard !isRecording && !isStarting else { return }
        isStarting = true
        defer { isStarting = false }
        errorMessage = nil
        let session = AVAudioSession.sharedInstance()
        let granted = await withCheckedContinuation { continuation in
            if #available(iOS 17.0, *) {
                AVAudioApplication.requestRecordPermission { continuation.resume(returning: $0) }
            } else {
                session.requestRecordPermission { continuation.resume(returning: $0) }
            }
        }
        guard granted else { throw AudioError.microphoneDenied }
        try Task.checkCancellation()
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd HH-mm-ss"
        let name = "Recording \(formatter.string(from: Date())) \(UUID().uuidString.prefix(4)).m4a"
        let url = try Self.pendingDirectory().appendingPathComponent(name)
        try session.setCategory(.playAndRecord, mode: .default,
                                options: [.defaultToSpeaker, .allowBluetooth])
        try session.setActive(true)
        do {
            let audioRecorder = try AVAudioRecorder(url: url, settings: [
                AVFormatIDKey: kAudioFormatMPEG4AAC,
                AVSampleRateKey: 44_100,
                AVNumberOfChannelsKey: 1,
                AVEncoderBitRateKey: 96_000,
                AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
            ])
            audioRecorder.delegate = self
            audioRecorder.isMeteringEnabled = true
            guard audioRecorder.prepareToRecord(), audioRecorder.record() else { throw AudioError.cannotRecord }
            recorder = audioRecorder
            recordingURL = url
            duration = 0
            level = 0
            isRecording = true
            timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
                Task { @MainActor [weak self] in self?.updateMeters() }
            }
        } catch {
            try? FileManager.default.removeItem(at: url)
            try? session.setActive(false, options: .notifyOthersOnDeactivation)
            throw error
        }
    }

    @discardableResult
    func stop() throws -> URL {
        guard let url = recordingURL else { throw AudioError.noRecording }
        duration = max(duration, recorder?.currentTime ?? 0)
        recorder?.delegate = nil
        recorder?.stop()
        recorder = nil
        recordingURL = nil
        timer?.invalidate()
        timer = nil
        isRecording = false
        level = 0
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        guard FileManager.default.fileExists(atPath: url.path) else { throw AudioError.noRecording }
        return url
    }

    func cancel() {
        if let url = try? stop() { try? FileManager.default.removeItem(at: url) }
        duration = 0
        errorMessage = nil
    }

    /// Call after the library has imported the interrupted recording.
    func acknowledgeRecoveredRecording() { recoveredRecordingURL = nil }

    /// Recordings stay here until AppStore imports and deletes the source file.
    /// This also discovers audio left behind by an app termination or a failed
    /// library save; call once at launch, before a new capture starts.
    nonisolated static func pendingURLs() -> [URL] {
        guard let directory = try? pendingDirectory(),
              let urls = try? FileManager.default.contentsOfDirectory(
                at: directory, includingPropertiesForKeys: [.creationDateKey],
                options: [.skipsHiddenFiles]) else { return [] }
        return urls.filter { $0.pathExtension.lowercased() == "m4a" }
            .sorted { $0.lastPathComponent < $1.lastPathComponent }
    }

    nonisolated private static func pendingDirectory() throws -> URL {
        let base = try FileManager.default.url(for: .applicationSupportDirectory,
                                              in: .userDomainMask, appropriateFor: nil, create: true)
        let directory = base.appendingPathComponent("PendingRecordings", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        return directory
    }

    private func updateMeters() {
        guard let recorder, isRecording else { return }
        duration = recorder.currentTime
        recorder.updateMeters()
        level = min(1, max(0, pow(10, recorder.averagePower(forChannel: 0) / 40)))
    }

    private func preserveInterruptedRecording(message: String) {
        guard isRecording else { return }
        do {
            recoveredRecordingURL = try stop()
            errorMessage = message
        } catch {
            errorMessage = "Recording stopped: \(error.localizedDescription)"
        }
    }

    nonisolated func audioRecorderDidFinishRecording(_ recorder: AVAudioRecorder, successfully flag: Bool) {
        let finishedURL = recorder.url
        Task { @MainActor [weak self] in
            guard self?.recordingURL == finishedURL else { return }
            self?.preserveInterruptedRecording(message: flag
                ? "Recording finished. Your audio was saved."
                : "Recording stopped unexpectedly. The available audio was saved.")
        }
    }

    nonisolated func audioRecorderEncodeErrorDidOccur(_ recorder: AVAudioRecorder, error: Error?) {
        let message = error?.localizedDescription ?? "An audio encoding error occurred."
        let finishedURL = recorder.url
        Task { @MainActor [weak self] in
            guard self?.recordingURL == finishedURL else { return }
            self?.preserveInterruptedRecording(message: message)
        }
    }
}
#endif
