import Foundation
import Combine
import CryptoKit

final class ModelDownloadProgress: NSObject, URLSessionDownloadDelegate, @unchecked Sendable {
    let expectedBytes: Int64
    let callback: @Sendable (Double) -> Void
    private let lock = NSLock()
    private var continuation: CheckedContinuation<URL, Error>?
    private var session: URLSession?
    private var task: URLSessionDownloadTask?
    private var cancelled = false
    private var finished = false
    private var lastProgress: Double = 0

    init(expectedBytes: Int64, callback: @escaping @Sendable (Double) -> Void) {
        self.expectedBytes = expectedBytes
        self.callback = callback
    }

    /// An explicit delegate download task is necessary for progress callbacks;
    /// URLSession's async download convenience method suppresses them on some OS versions.
    func download(_ request: URLRequest, configuration: URLSessionConfiguration) async throws -> URL {
        try await withTaskCancellationHandler {
            try Task.checkCancellation()
            return try await withCheckedThrowingContinuation { continuation in
                begin(request, configuration: configuration, continuation: continuation)
            }
        } onCancel: {
            self.cancel()
        }
    }

    private func begin(_ request: URLRequest, configuration: URLSessionConfiguration,
                       continuation: CheckedContinuation<URL, Error>) {
        lock.lock()
        guard !cancelled && !finished else {
            lock.unlock()
            continuation.resume(throwing: CancellationError())
            return
        }
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
        let task = session.downloadTask(with: request)
        self.continuation = continuation
        self.session = session
        self.task = task
        lock.unlock()
        // A cancellation between setup and resume cancels this same task.
        task.resume()
    }

    private func cancel() {
        lock.lock()
        cancelled = true
        let task = self.task
        lock.unlock()
        task?.cancel()
        complete(.failure(CancellationError()))
    }

    private func complete(_ incoming: Result<URL, Error>) {
        lock.lock()
        if finished {
            lock.unlock()
            if case .success(let file) = incoming { try? FileManager.default.removeItem(at: file) }
            return
        }
        finished = true
        let continuation = self.continuation
        let session = self.session
        let result: Result<URL, Error> = cancelled ? .failure(CancellationError()) : incoming
        self.continuation = nil
        self.session = nil
        self.task = nil
        lock.unlock()
        if case .success(let file) = incoming, case .failure = result {
            try? FileManager.default.removeItem(at: file)
        }
        session?.invalidateAndCancel()
        continuation?.resume(with: result)
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        lock.lock()
        let shouldStop = cancelled || finished
        lock.unlock()
        guard !shouldStop else { return }
        guard let response = downloadTask.response as? HTTPURLResponse, response.statusCode == 200 else {
            complete(.failure(WordvaleError.message("The model server could not complete the download. Try again when you are online.")))
            return
        }
        do {
            // The delegate's URL is deleted when this callback returns. Move it
            // before resuming Swift so hashing never races that deletion.
            let staged = FileManager.default.temporaryDirectory
                .appendingPathComponent("wordvale-model-\(UUID().uuidString).download")
            try FileManager.default.moveItem(at: location, to: staged)
            complete(.success(staged))
        } catch { complete(.failure(error)) }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error { complete(.failure(error)) }
        else {
            // Normally didFinishDownloadingTo has already completed the result.
            complete(.failure(WordvaleError.message("The model download finished without a file. Please try again.")))
        }
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        // CDN responses may use chunked transfer without Content-Length.
        let total = totalBytesExpectedToWrite > 0 ? totalBytesExpectedToWrite : expectedBytes
        guard total > 0 else { return }
        let fraction = min(0.99, Double(totalBytesWritten) / Double(total))
        lock.lock()
        let shouldReport = !cancelled && !finished && fraction - lastProgress >= 0.001
        if shouldReport { lastProgress = fraction }
        lock.unlock()
        if shouldReport { callback(fraction) }
    }
}

enum ModelIntegrity {
    static func verify(_ url: URL, model: WhisperModel) throws {
        let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize
        guard size == Int(model.size) else { throw WordvaleError.message("The model download is incomplete. Please download it again.") }
        let file = try FileHandle(forReadingFrom: url)
        defer { try? file.close() }
        var hash = SHA256()
        while let data = try file.read(upToCount: 1024 * 1024), !data.isEmpty {
            try Task.checkCancellation()
            hash.update(data: data)
        }
        let actual = hash.finalize().map { String(format: "%02x", $0) }.joined()
        guard actual == model.sha256 else { throw WordvaleError.message("The model failed its integrity check. Please download it again.") }
    }
}

@MainActor
final class ModelStore: ObservableObject {
    @Published private(set) var installed: Set<String> = []
    @Published private(set) var progress: [String: Double] = [:]
    @Published private(set) var errors: [String: String] = [:]
    let catalog = WhisperModel.catalog
    var activeModelID: String?
    let directory: URL
    private var tasks: [String: Task<Void, Never>] = [:]
    private var downloadIDs: [String: UUID] = [:]

    init(directory: URL? = nil) throws {
        self.directory = try directory ?? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true).appendingPathComponent("Models", isDirectory: true)
        try FileManager.default.createDirectory(at: self.directory, withIntermediateDirectories: true)
        var dir = self.directory
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try dir.setResourceValues(values)
        for model in catalog {
            let url = modelURL(model)
            if let values = try? url.resourceValues(forKeys: [.fileSizeKey]), values.fileSize == Int(model.size) { installed.insert(model.id) }
        }
    }

    func modelURL(_ model: WhisperModel) -> URL { directory.appendingPathComponent(model.filename) }
    func isInstalled(_ model: WhisperModel) -> Bool { installed.contains(model.id) }

    func download(_ model: WhisperModel) {
        guard tasks[model.id] == nil, !isInstalled(model) else { return }
        errors[model.id] = nil
        progress[model.id] = 0
        let downloadID = UUID()
        downloadIDs[model.id] = downloadID
        tasks[model.id] = Task { [weak self] in
            guard let self else { return }
            defer { self.tasks[model.id] = nil; self.progress[model.id] = nil; self.downloadIDs[model.id] = nil }
            do {
                let capacity = try? self.directory.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]).volumeAvailableCapacityForImportantUsage
                if let capacity, capacity < model.size + 100_000_000 { throw WordvaleError.message("Free at least \(model.sizeMB + 100) MB on your iPhone before downloading this model.") }
                let observer = ModelDownloadProgress(expectedBytes: model.size) { [weak self] fraction in
                    Task { @MainActor in
                        guard let self, self.downloadIDs[model.id] == downloadID, !self.installed.contains(model.id) else { return }
                        self.progress[model.id] = fraction
                    }
                }
                let config = URLSessionConfiguration.ephemeral
                config.timeoutIntervalForRequest = 60
                config.timeoutIntervalForResource = 7200
                let temporary = try await observer.download(URLRequest(url: model.downloadURL), configuration: config)
                defer { try? FileManager.default.removeItem(at: temporary) }
                try Task.checkCancellation()
                let verification = Task.detached(priority: .utility) { try ModelIntegrity.verify(temporary, model: model) }
                try await withTaskCancellationHandler { try await verification.value } onCancel: { verification.cancel() }
                try Task.checkCancellation()
                let destination = self.modelURL(model)
                if FileManager.default.fileExists(atPath: destination.path) { try FileManager.default.removeItem(at: destination) }
                try FileManager.default.moveItem(at: temporary, to: destination)
                var saved = destination
                var values = URLResourceValues()
                values.isExcludedFromBackup = true
                try saved.setResourceValues(values)
                self.installed.insert(model.id)
            } catch {
                if !Task.isCancelled { self.errors[model.id] = error.localizedDescription }
            }
        }
    }

    func cancelDownload(_ id: String) { tasks[id]?.cancel() }
    func delete(_ model: WhisperModel) throws {
        guard activeModelID != model.id else { throw WordvaleError.message("This model is transcribing a recording. Stop transcription before removing it.") }
        cancelDownload(model.id)
        let url = modelURL(model)
        if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
        installed.remove(model.id)
        errors[model.id] = nil
    }
}
