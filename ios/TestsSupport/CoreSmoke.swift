import AVFoundation
import Foundation

private struct CoreFailure: Error, CustomStringConvertible {
    let description: String
}

private func require(_ condition: @autoclosure () throws -> Bool, _ message: String) throws {
    guard try condition() else { throw CoreFailure(description: message) }
}

private func requireThrows(_ message: String, _ body: () throws -> Void) throws {
    do { try body() }
    catch { return }
    throw CoreFailure(description: message)
}

/// Compiles the actual iOS domain/storage/decoder sources on macOS. No mocks or
/// substitute implementation: only UIKit-dependent lifecycle code is excluded.
@MainActor
@main
struct CoreSmoke {
    static func main() async {
        do { try await run() }
        catch {
            FileHandle.standardError.write(Data("CORE SMOKE FAILED: \(error)\n".utf8))
            exit(1)
        }
    }

    private static func run() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("wordvale-core-\(UUID())")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        try subtitleExports()
        try karaokeExports()
        try unicodeFilenames(root)
        try persistenceAndRecovery(root)
        try copyAndReferenceCleanup(root)
        try modelIntegrityAndDeletion(root)
        try stereoDecoder(root)
        if ProcessInfo.processInfo.environment["WORDVALE_TEST_DOWNLOAD"] == "1" {
            try await realModelDownload(root)
        }
        if ["1", "cancel"].contains(ProcessInfo.processInfo.environment["WORDVALE_TEST_DOWNLOAD"] ?? "") {
            try await modelDownloadCancellation(root)
        }
        print("CORE SMOKE PASSED: subtitle formats, JSON, Unicode filenames, persistence, recovery, media lifecycle, model integrity, model deletion, stereo decoding and cancellation")
    }

    private static func fixture() -> Transcript {
        Transcript(title: "A / recording", modelID: "base", language: "en", isTranslation: false,
                   duration: 3662, text: "Hello world. 最後の言葉。", segments: [
                    .init(id: 0, start: 0.125, end: 2.75, text: " Hello world. "),
                    .init(id: 1, start: 3660, end: 3662, text: "最後の言葉。")
                   ], audioFilename: "sample.wav")
    }

    private static func subtitleExports() throws {
        try require(TranscriptExporter.timestamp(59.9996) == "00:01:00,000", "Timestamp millisecond carry failed")
        try require(TranscriptExporter.timestamp(3661.25) == "01:01:01,250", "Hour timestamp failed")
        try require(TranscriptExporter.timestamp(.nan) == "00:00:00,000", "NaN timestamp was unsafe")
        try require(TranscriptExporter.timestamp(-1) == "00:00:00,000", "Negative timestamp was unsafe")
        let original = fixture()
        let plain = try TranscriptExporter.content(original, format: .text)
        try require(String(decoding: plain, as: UTF8.self) == original.text, "Plain text lost Unicode")
        let timed = String(decoding: try TranscriptExporter.content(original, format: .timedText), as: UTF8.self)
        try require(timed.contains("[01:01:00.000 – 01:01:02.000] 最後の言葉。"), "Timed text output failed")
        let srt = String(decoding: try TranscriptExporter.content(original, format: .srt), as: UTF8.self)
        try require(srt.contains("1\n00:00:00,125 --> 00:00:02,750\nHello world."), "SRT first cue failed")
        try require(srt.contains("2\n01:01:00,000 --> 01:01:02,000\n最後の言葉。"), "SRT hour/Unicode cue failed")
        var escaped = original
        escaped.segments[0].text = "<hello> & goodbye"
        let vtt = String(decoding: try TranscriptExporter.content(escaped, format: .vtt), as: UTF8.self)
        try require(vtt.hasPrefix("WEBVTT\n\n") && vtt.contains("&lt;hello&gt; &amp; goodbye"), "WebVTT escaping failed")
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let restored = try decoder.decode(Transcript.self, from: TranscriptExporter.content(original, format: .json))
        try require(restored.id == original.id && restored.text == original.text && restored.segments == original.segments,
                    "JSON transcript round trip failed")
        try require(restored.duration == original.duration && restored.audioFilename == original.audioFilename,
                    "JSON lost recording metadata")
        print("EXPORTS PASSED: TXT, timed TXT, SRT, WebVTT, JSON, hour carry, Unicode and escaping")
    }

    private static func karaokeExports() throws {
        try requireThrows("Karaoke without word timings was accepted") {
            _ = try TranscriptExporter.content(fixture(), format: .ass)
        }
        var value = fixture()
        value.segments = [.init(id: 0, start: 0, end: 2, text: "Hello world.", words: [
            .init(start: 0.2, end: 1, text: "Hello"), .init(start: 1, end: 2, text: "world.")
        ])]
        try require(TranscriptExporter.canExportKaraoke(value), "Valid karaoke was rejected")
        let ass = String(decoding: try TranscriptExporter.content(value, format: .ass), as: UTF8.self)
        try require(ass.contains("{\\k20}{\\kf80}Hello {\\kf100}world."), "Karaoke timing or word spacing failed")
        value.segments[0].words[1].start = 0.8
        try require(!TranscriptExporter.canExportKaraoke(value), "Overlapping words accepted")
        value.segments[0].words[1].start = 2
        try require(!TranscriptExporter.canExportKaraoke(value), "Zero-length word accepted")
        value.segments[0].words[1].start = .nan
        try require(!TranscriptExporter.canExportKaraoke(value), "NaN word timing accepted")
        print("KARAOKE PASSED: timing, spacing and invalid-timing rejection")
    }

    private static func unicodeFilenames(_ root: URL) throws {
        try require(TranscriptExporter.safeFilename("../report\nname/2026") == "..-report-name-2026", "Filename traversal sanitization failed")
        for title in [".", "..", " "] {
            try require(TranscriptExporter.safeFilename(title) == "Transcript", "Empty/traversal filename allowed")
        }
        let titles = [String(repeating: "a", count: 200), String(repeating: "👨‍👩‍👧‍👦", count: 100), String(repeating: "日本語", count: 100)]
        for title in titles {
            let filename = TranscriptExporter.safeFilename(title)
            try require(!filename.isEmpty && filename.utf8.count <= 180 && filename.utf16.count <= 180 && filename.count <= 100,
                        "Filename exceeded character/byte budget")
            let url = root.appendingPathComponent(filename + ".txt")
            try Data("Unicode filename works".utf8).write(to: url)
            try require(FileManager.default.fileExists(atPath: url.path), "Unicode filename could not be written")
        }
        print("FILENAMES PASSED: traversal, empty titles, long Latin, family emoji and Japanese names")
    }

    private static func persistenceAndRecovery(_ root: URL) throws {
        let storage = try LibraryStorage(root: root.appendingPathComponent("Persistence"))
        var item = QueueItem(title: "An interview", audioFilename: "interview.wav")
        item.status = .processing
        item.progress = 0.6
        let original = fixture()
        try storage.save(.init(transcripts: [original], queue: [item]))
        let recovered = try storage.load()
        try require(recovered.transcripts == [original], "Stored transcript was not recovered")
        try require(recovered.queue.count == 1 && recovered.queue[0].status == .cancelled && recovered.queue[0].progress == 0,
                    "Interrupted processing was not reset")
        try require(recovered.queue[0].message != nil, "Interrupted processing lacks recovery explanation")
        try require(storage.mediaURL("../../escape.wav").deletingLastPathComponent() == storage.mediaDirectory,
                    "Stored filename escaped media directory")
        let corrupt = Data("not valid json".utf8)
        try corrupt.write(to: storage.stateURL)
        try requireThrows("Corrupt library was accepted") { _ = try storage.load() }
        try require(try Data(contentsOf: storage.stateURL) == corrupt, "Corrupt library was overwritten")
        print("PERSISTENCE PASSED: transcript recovery, interrupted queue, traversal and corruption preservation")
    }

    private static func copyAndReferenceCleanup(_ root: URL) throws {
        let storage = try LibraryStorage(root: root.appendingPathComponent("Imports"))
        let source = root.appendingPathComponent("Original.wav")
        let data = Data([1, 2, 3, 4])
        try data.write(to: source)
        let imported = try storage.importFile(source)
        let destination = storage.mediaURL(imported.filename)
        try require(destination != source && (try Data(contentsOf: destination)) == data, "Import did not create an independent copy")
        let item = QueueItem(title: imported.title, audioFilename: imported.filename)
        storage.removeMediaIfUnused(imported.filename, state: .init(queue: [item]))
        try require(FileManager.default.fileExists(atPath: destination.path), "Queue-referenced audio was deleted")
        var transcript = fixture()
        transcript.audioFilename = imported.filename
        storage.removeMediaIfUnused(imported.filename, state: .init(transcripts: [transcript]))
        try require(FileManager.default.fileExists(atPath: destination.path), "Transcript-referenced audio was deleted")
        storage.removeMediaIfUnused(imported.filename, state: .init())
        try require(!FileManager.default.fileExists(atPath: destination.path), "Unreferenced audio was retained")
        try require(FileManager.default.fileExists(atPath: source.path), "Original import source was deleted")
        let empty = root.appendingPathComponent("Empty.wav")
        try Data().write(to: empty)
        try requireThrows("Empty import accepted") { _ = try storage.importFile(empty) }
        let unsupported = root.appendingPathComponent("Unsupported.txt")
        try data.write(to: unsupported)
        try requireThrows("Unsupported extension accepted") { _ = try storage.importFile(unsupported) }
        print("MEDIA LIFECYCLE PASSED: copy, source preservation, queue/transcript references, cleanup and invalid imports")
    }

    private static func modelIntegrityAndDeletion(_ root: URL) throws {
        let directory = root.appendingPathComponent("Models")
        let store = try ModelStore(directory: directory)
        let model = WhisperModel(id: "fixture", name: "Fixture", size: 3,
                                 sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
                                 summary: "", isMultilingual: false, recommended: false)
        let url = store.modelURL(model)
        try Data("abc".utf8).write(to: url)
        try ModelIntegrity.verify(url, model: model)
        try Data("abd".utf8).write(to: url)
        try requireThrows("Same-sized model corruption passed SHA256") { try ModelIntegrity.verify(url, model: model) }
        try Data("ab".utf8).write(to: url)
        try requireThrows("Truncated model passed verification") { try ModelIntegrity.verify(url, model: model) }
        store.activeModelID = model.id
        try requireThrows("Active model was deleted") { try store.delete(model) }
        try require(FileManager.default.fileExists(atPath: url.path), "Active model disappeared")
        store.activeModelID = nil
        try store.delete(model)
        try require(!FileManager.default.fileExists(atPath: url.path), "Inactive model was not deleted")
        print("MODELS PASSED: SHA256, same-size corruption, truncation and active-model deletion guard")
    }

    private static func stereoDecoder(_ root: URL) throws {
        let url = root.appendingPathComponent("Stereo48k.wav")
        let format = AVAudioFormat(standardFormatWithSampleRate: 48_000, channels: 2)!
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 48_000)!
        buffer.frameLength = 48_000
        for i in 0..<48_000 {
            let value = Float(sin(Double(i) * 2 * .pi * 440 / 48_000)) * 0.25
            buffer.floatChannelData![0][i] = value
            buffer.floatChannelData![1][i] = value
        }
        do {
            let file = try AVAudioFile(forWriting: url, settings: format.settings)
            try file.write(from: buffer)
        }
        let decoded = try AudioDecoder.decode(url, isCancelled: { false }, progress: { _ in })
        defer { try? FileManager.default.removeItem(at: decoded.url) }
        try require(abs(decoded.duration - 1) < 0.02 && abs(decoded.sampleCount - 16_000) < 320,
                    "48k stereo did not decode to 16k mono")
        let data = try Data(contentsOf: decoded.url)
        try require(data.count == Int(decoded.sampleCount) * 4, "PCM sample size mismatch")
        try requireThrows("Cancelled decode did not throw") {
            _ = try AudioDecoder.decode(url, isCancelled: { true }, progress: { _ in })
        }
        print("AUDIO DECODER PASSED: 48k stereo to 16k mono Float32 and cancellation")
    }

    private static func realModelDownload(_ root: URL) async throws {
        let store = try ModelStore(directory: root.appendingPathComponent("NetworkModels"))
        guard let model = store.catalog.first(where: { $0.id == "tiny.en" }) else {
            throw CoreFailure(description: "Tiny English is missing from the catalog")
        }
        var observedProgress = false
        let subscription = store.$progress.sink { values in
            if let fraction = values[model.id], fraction > 0 { observedProgress = true }
        }
        defer { subscription.cancel() }
        store.download(model)
        let deadline = Date().addingTimeInterval(300)
        while !store.isInstalled(model) && store.errors[model.id] == nil && Date() < deadline {
            try await Task.sleep(nanoseconds: 200_000_000)
        }
        if let error = store.errors[model.id] { throw CoreFailure(description: "Model download failed: \(error)") }
        if !store.isInstalled(model) {
            store.cancelDownload(model.id)
            while store.progress[model.id] != nil { try await Task.sleep(nanoseconds: 100_000_000) }
            throw CoreFailure(description: "Model download exceeded five minutes")
        }
        try require(observedProgress, "Download never reported progress")
        try require(store.progress[model.id] == nil, "Completed download progress was not cleared")
        try ModelIntegrity.verify(store.modelURL(model), model: model)
        let restored = try ModelStore(directory: store.directory)
        try require(restored.isInstalled(model), "Downloaded model was not recognized after reopening")
        try restored.delete(model)
        try require(!FileManager.default.fileExists(atPath: restored.modelURL(model).path), "Downloaded model could not be removed")
        print("NETWORK MODEL DOWNLOAD PASSED: Tiny English, progress delegate, SHA256, install, reopen and delete")
    }

    private static func modelDownloadCancellation(_ root: URL) async throws {
        guard let model = WhisperModel.catalog.first(where: { $0.id == "tiny.en" }) else {
            throw CoreFailure(description: "Tiny English is missing from the catalog")
        }
        let beforeSetup = ModelDownloadProgress(expectedBytes: model.size) { _ in }
        let cancelledTask = Task {
            try await beforeSetup.download(URLRequest(url: model.downloadURL), configuration: .ephemeral)
        }
        cancelledTask.cancel()
        do {
            let file = try await cancelledTask.value
            try? FileManager.default.removeItem(at: file)
            throw CoreFailure(description: "Pre-setup download cancellation returned a file")
        } catch is CancellationError {}

        let store = try ModelStore(directory: root.appendingPathComponent("CancelledModels"))
        var cancelledAfterProgress = false
        let subscription = store.$progress.sink { values in
            if let fraction = values[model.id], fraction > 0, !cancelledAfterProgress {
                cancelledAfterProgress = true
                store.cancelDownload(model.id)
            }
        }
        defer { subscription.cancel() }
        store.download(model)
        let deadline = Date().addingTimeInterval(120)
        while store.progress[model.id] != nil && Date() < deadline {
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        store.cancelDownload(model.id)
        try require(cancelledAfterProgress, "Download produced no cancellable progress")
        try require(store.progress[model.id] == nil && !store.isInstalled(model), "Cancelled download remained active or installed")
        try require(store.errors[model.id] == nil, "User cancellation was displayed as a download failure")
        try require(!FileManager.default.fileExists(atPath: store.modelURL(model).path), "Cancelled download left a model file")
        print("NETWORK CANCELLATION PASSED: before setup and after live progress, with no installed partial file")

        let failure = ModelDownloadProgress(expectedBytes: 100) { _ in }
        let missingURL = model.downloadURL.deletingLastPathComponent()
            .appendingPathComponent("missing-wordvale-test-\(UUID().uuidString).bin")
        do {
            let file = try await failure.download(URLRequest(url: missingURL), configuration: .ephemeral)
            try? FileManager.default.removeItem(at: file)
            throw CoreFailure(description: "HTTP 404 response was returned as a model file")
        } catch is WordvaleError {
            print("NETWORK HTTP FAILURE PASSED: missing model response rejected")
        }
    }
}
