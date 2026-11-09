import Foundation
import SwiftUI
import Combine

@MainActor
final class AppStore: ObservableObject {
    @Published var queue: [QueueItem]
    @Published var transcripts: [Transcript]
    @Published var selectedModelID: String {
        didSet {
            UserDefaults.standard.set(selectedModelID, forKey: "ios.selectedModel")
            if !selectedModel.isMultilingual { translate = false }
        }
    }
    @Published var language: String { didSet { UserDefaults.standard.set(language, forKey: "ios.language") } }
    @Published var translate = false
    @Published var wordTimestamps: Bool { didSet { UserDefaults.standard.set(wordTimestamps, forKey: "ios.wordTimestamps") } }
    @Published private(set) var isProcessing = false
    @Published private(set) var isImporting = false
    @Published private(set) var isStartingRecording = false
    @Published var errorMessage: String?
    @Published var statusMessage: String?
    let models: ModelStore
    let recorder: AudioRecorder
    private let storage: LibraryStorage
    private let engine = WhisperEngine()
    private var work: Task<Void, Never>?
    private var recordingWork: Task<Void, Never>?
    private var subscriptions: Set<AnyCancellable> = []
    private var interruptionMessage: String?

    var selectedModel: WhisperModel { models.catalog.first(where: { $0.id == selectedModelID }) ?? models.catalog[0] }
    var hasPendingItems: Bool { queue.contains { $0.status == .queued } }

    init(storage: LibraryStorage? = nil, models: ModelStore? = nil) throws {
        self.storage = try storage ?? LibraryStorage()
        let state = try self.storage.load()
        self.models = try models ?? ModelStore()
        recorder = AudioRecorder()
        queue = state.queue
        transcripts = state.transcripts
        let savedModel = UserDefaults.standard.string(forKey: "ios.selectedModel") ?? "base"
        selectedModelID = WhisperModel.catalog.contains(where: { $0.id == savedModel }) ? savedModel : "base"
        language = UserDefaults.standard.string(forKey: "ios.language") ?? "auto"
        wordTimestamps = UserDefaults.standard.bool(forKey: "ios.wordTimestamps")
        self.models.objectWillChange.sink { [weak self] _ in self?.objectWillChange.send() }.store(in: &subscriptions)
        recorder.objectWillChange.sink { [weak self] _ in self?.objectWillChange.send() }.store(in: &subscriptions)
        recorder.$recoveredRecordingURL.compactMap { $0 }.sink { [weak self] url in
            Task { @MainActor [weak self] in
                guard let self else { return }
                if await self.recoverRecording(url) { self.recorder.acknowledgeRecoveredRecording() }
            }
        }.store(in: &subscriptions)
        recordingWork = Task { [weak self] in
            guard let self else { return }
            defer { self.recordingWork = nil }
            for url in AudioRecorder.pendingURLs() {
                _ = await self.recoverRecording(url)
            }
        }
        NotificationCenter.default.publisher(for: UIApplication.didReceiveMemoryWarningNotification)
            .sink { [weak self] _ in
                Task { @MainActor in
                    guard let self, self.isProcessing else { return }
                    self.interruptionMessage = "Stopped because iOS needs more memory. Retry with Base or Tiny."
                    self.cancelProcessing()
                }
            }.store(in: &subscriptions)
    }

    @discardableResult
    func importFiles(_ urls: [URL]) async -> Bool {
        guard !isImporting else { errorMessage = "Wait for the current import to finish, then add more recordings."; return false }
        isImporting = true
        defer { isImporting = false }
        let storage = self.storage
        var errors: [String] = []
        var saved = true
        for source in urls {
            do {
                let imported = try await Task.detached(priority: .userInitiated) { try storage.importFile(source) }.value
                queue.append(QueueItem(title: imported.title, audioFilename: imported.filename))
                saved = persist() && saved
            } catch { errors.append(error.localizedDescription) }
        }
        if !errors.isEmpty { errorMessage = errors.joined(separator: "\n\n") }
        return saved && errors.isEmpty
    }

    func startQueue() {
        guard !isProcessing, !isStartingRecording, !recorder.isRecording, hasPendingItems else { return }
        let model = selectedModel
        guard models.isInstalled(model) else {
            models.download(model)
            statusMessage = "Downloading \(model.name). When it is ready, tap Transcribe to begin."
            return
        }
        guard ProcessInfo.processInfo.thermalState != .critical else {
            errorMessage = "Your iPhone needs to cool down before transcription can start. Try again in a few minutes."
            return
        }
        let options = EngineOptions(language: model.isMultilingual ? language : "en", translate: translate && model.isMultilingual, wordTimestamps: wordTimestamps)
        isProcessing = true
        interruptionMessage = nil
        statusMessage = "Keep Wordvale open while transcribing."
        models.activeModelID = model.id
        UIApplication.shared.isIdleTimerDisabled = true
        work = Task { [weak self] in
            guard let self else { return }
            defer {
                self.isProcessing = false
                self.models.activeModelID = nil
                self.work = nil
                UIApplication.shared.isIdleTimerDisabled = false
                self.persist()
            }
            var completedCount = 0
            var failedCount = 0
            while !Task.isCancelled, let index = self.queue.firstIndex(where: { $0.status == .queued }) {
                let item = self.queue[index]
                self.queue[index].status = .processing
                self.queue[index].progress = 0
                self.queue[index].message = "Preparing audio…"
                self.persist()
                do {
                    let result = try await self.engine.transcribe(audioURL: self.storage.mediaURL(item.audioFilename), modelURL: self.models.modelURL(model), options: options) { [weak self] fraction in
                        Task { @MainActor in
                            guard let self, let current = self.queue.firstIndex(where: { $0.id == item.id }), self.queue[current].status == .processing else { return }
                            self.queue[current].progress = min(1, max(0, fraction))
                            self.queue[current].message = "Transcribing on your iPhone…"
                        }
                    }
                    try Task.checkCancellation()
                    let transcript = Transcript(title: item.title, modelID: model.id, language: result.language, isTranslation: options.translate, duration: result.duration, text: result.text, segments: result.segments.map { segment in
                        TranscriptSegment(id: segment.id, start: segment.start, end: segment.end, text: segment.text, words: segment.words.map { TranscriptWord(start: $0.start, end: $0.end, text: $0.text) })
                    }, audioFilename: item.audioFilename)
                    self.transcripts.insert(transcript, at: 0)
                    completedCount += 1
                    if let current = self.queue.firstIndex(where: { $0.id == item.id }) {
                        self.queue[current].status = .completed
                        self.queue[current].progress = 1
                        self.queue[current].message = result.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "No speech detected." : "Saved to your library."
                        self.queue[current].transcriptID = transcript.id
                    }
                } catch {
                    if !Task.isCancelled { failedCount += 1 }
                    if let current = self.queue.firstIndex(where: { $0.id == item.id }) {
                        self.queue[current].status = Task.isCancelled ? .cancelled : .failed
                        self.queue[current].message = Task.isCancelled ? self.interruptionMessage ?? "Stopped. Tap Retry to start this recording again." : error.localizedDescription
                    }
                }
                self.persist()
            }
            if let interruption = self.interruptionMessage { self.statusMessage = interruption }
            else if Task.isCancelled { self.statusMessage = "Transcription stopped. Your recordings are saved." }
            else if failedCount > 0 { self.statusMessage = "\(completedCount) completed. \(failedCount) \(failedCount == 1 ? "recording needs" : "recordings need") attention in the queue." }
            else { self.statusMessage = "Your transcripts are ready in the library." }
        }
    }

    func cancelProcessing() {
        guard isProcessing else { return }
        work?.cancel()
        engine.cancel()
        statusMessage = interruptionMessage ?? "Stopping transcription…"
    }

    func removeQueueItem(_ id: UUID) {
        guard let item = queue.first(where: { $0.id == id }), item.status != .processing else { return }
        queue.removeAll { $0.id == id }
        if persist() { storage.removeMediaIfUnused(item.audioFilename, state: state) }
    }

    func retryQueueItem(_ id: UUID) {
        guard let index = queue.firstIndex(where: { $0.id == id }), [.failed, .cancelled].contains(queue[index].status) else { return }
        queue[index].status = .queued
        queue[index].progress = 0
        queue[index].message = nil
        persist()
    }

    func clearFinished() {
        for item in queue where item.status == .completed { removeQueueItem(item.id) }
    }

    func startRecording() async {
        guard !isProcessing, !isImporting, !isStartingRecording, !recorder.isRecording, recordingWork == nil else { return }
        isStartingRecording = true
        defer { isStartingRecording = false }
        do {
            try await recorder.start()
            statusMessage = nil
        } catch { errorMessage = error.localizedDescription }
    }

    func stopRecording() {
        guard recorder.isRecording else { return }
        do {
            let url = try recorder.stop()
            recordingWork = Task { [weak self] in
                guard let self else { return }
                defer { self.recordingWork = nil }
                // Remove the recoverable capture only after the library has a durable copy.
                _ = await self.recoverRecording(url)
            }
        } catch { errorMessage = error.localizedDescription }
    }

    private func recoverRecording(_ url: URL) async -> Bool {
        while isImporting {
            do { try await Task.sleep(nanoseconds: 100_000_000) }
            catch { return false }
        }
        guard await importFiles([url]) else { return false }
        try? FileManager.default.removeItem(at: url)
        return true
    }

    func deleteTranscript(_ id: UUID) {
        guard let transcript = transcripts.first(where: { $0.id == id }) else { return }
        transcripts.removeAll { $0.id == id }
        queue.removeAll { $0.transcriptID == id && $0.status != .processing }
        if persist() { storage.removeMediaIfUnused(transcript.audioFilename, state: state) }
    }

    func renameTranscript(_ id: UUID, title: String) {
        let clean = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty, let index = transcripts.firstIndex(where: { $0.id == id }) else { return }
        transcripts[index].title = String(clean.prefix(200))
        persist()
    }

    func audioURL(for transcript: Transcript) -> URL? {
        let url = storage.mediaURL(transcript.audioFilename)
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    func export(_ transcript: Transcript, format: ExportFormat) throws -> URL {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("Exports", isDirectory: true).appendingPathComponent(transcript.id.uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let url = directory.appendingPathComponent(TranscriptExporter.safeFilename(transcript.title) + "." + format.fileExtension)
        try TranscriptExporter.content(transcript, format: format).write(to: url, options: .atomic)
        return url
    }

    func handleScenePhase(_ phase: ScenePhase) {
        if phase != .active && isProcessing {
            interruptionMessage = "Transcription paused when Wordvale left the foreground. Tap Retry, then Transcribe, to restart this recording."
            cancelProcessing()
        }
    }

    private var state: LibraryState { LibraryState(transcripts: transcripts, queue: queue) }
    @discardableResult
    private func persist() -> Bool {
        do { try storage.save(state); return true }
        catch { errorMessage = "Could not save the library: \(error.localizedDescription). Keep Wordvale open and free some storage."; return false }
    }
}
