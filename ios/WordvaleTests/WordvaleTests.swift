import XCTest
import AVFoundation
@testable import Wordvale

final class WordvaleTests: XCTestCase {
    private func transcript(words: [TranscriptWord] = []) -> Transcript {
        Transcript(title: "A / recording", modelID: "base", language: "en", isTranslation: false,
                   duration: 3662, text: "Hello world.", segments: [
                    TranscriptSegment(id: 0, start: 0.125, end: 2.75, text: " Hello world. ", words: words),
                    TranscriptSegment(id: 1, start: 3660, end: 3662, text: "Last line.")
                   ], audioFilename: "sample.wav")
    }

    func testSubtitleTimingIncludesHoursAndMillisecondCarry() throws {
        XCTAssertEqual(TranscriptExporter.timestamp(59.9996), "00:01:00,000")
        XCTAssertEqual(TranscriptExporter.timestamp(3661.25), "01:01:01,250")
        let srt = String(decoding: try TranscriptExporter.content(transcript(), format: .srt), as: UTF8.self)
        XCTAssertTrue(srt.contains("1\n00:00:00,125 --> 00:00:02,750\nHello world."))
        XCTAssertTrue(srt.contains("2\n01:01:00,000 --> 01:01:02,000\nLast line."))
    }

    func testWebVTTQuotesTextWithoutCreatingMarkup() throws {
        var value = transcript()
        value.segments[0].text = "<hello> & goodbye"
        let vtt = String(decoding: try TranscriptExporter.content(value, format: .vtt), as: UTF8.self)
        XCTAssertTrue(vtt.hasPrefix("WEBVTT\n\n"))
        XCTAssertTrue(vtt.contains("00:00:00.125 --> 00:00:02.750"))
        XCTAssertTrue(vtt.contains("&lt;hello&gt; &amp; goodbye"))
    }

    func testJSONRoundTripsFullTranscript() throws {
        let value = transcript()
        let data = try TranscriptExporter.content(value, format: .json)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let decoded = try decoder.decode(Transcript.self, from: data)
        XCTAssertEqual(decoded.text, value.text)
        XCTAssertEqual(decoded.segments, value.segments)
        XCTAssertEqual(decoded.audioFilename, "sample.wav")
        XCTAssertEqual(decoded.duration, 3662)
    }

    func testKaraokeRequiresEveryWordToHaveOrderedNonzeroTiming() throws {
        XCTAssertThrowsError(try TranscriptExporter.content(transcript(), format: .ass))
        var value = transcript()
        value.segments = [.init(id: 0, start: 0, end: 2, text: "Hello world.", words: [
            .init(start: 0.2, end: 1, text: "Hello"), .init(start: 1, end: 2, text: "world.")
        ])]
        XCTAssertTrue(TranscriptExporter.canExportKaraoke(value))
        let ass = String(decoding: try TranscriptExporter.content(value, format: .ass), as: UTF8.self)
        XCTAssertTrue(ass.contains("{\\k20}{\\kf80}Hello"))
        XCTAssertTrue(ass.contains("{\\kf100}world."))
        XCTAssertTrue(ass.contains("Hello "))
        value.segments[0].words[1].start = 0.8
        XCTAssertFalse(TranscriptExporter.canExportKaraoke(value))
        value.segments[0].words[1].start = 2
        XCTAssertFalse(TranscriptExporter.canExportKaraoke(value))
    }

    func testFilenameCannotEscapeExportDirectory() {
        XCTAssertEqual(TranscriptExporter.safeFilename("../report\nname/2026"), "..-report-name-2026")
        XCTAssertEqual(TranscriptExporter.safeFilename(".."), "Transcript")
        XCTAssertEqual(TranscriptExporter.safeFilename("  "), "Transcript")
        XCTAssertLessThanOrEqual(TranscriptExporter.safeFilename(String(repeating: "a", count: 200)).count, 100)
        let emoji = TranscriptExporter.safeFilename(String(repeating: "👨‍👩‍👧‍👦", count: 100))
        XCTAssertLessThanOrEqual(emoji.utf8.count, 180)
        XCTAssertLessThanOrEqual(emoji.utf16.count, 180)
        XCTAssertFalse(emoji.isEmpty)
    }

    func testLibraryPersistsQueueAndMarksInterruptedWork() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let storage = try LibraryStorage(root: root)
        var item = QueueItem(title: "An interview", audioFilename: "interview.wav")
        item.status = .processing
        item.progress = 0.6
        let original = transcript()
        try storage.save(LibraryState(transcripts: [original], queue: [item]))
        let recovered = try storage.load()
        XCTAssertEqual(recovered.transcripts, [original])
        XCTAssertEqual(recovered.queue.count, 1)
        XCTAssertEqual(recovered.queue[0].status, .cancelled)
        XCTAssertEqual(recovered.queue[0].progress, 0)
        XCTAssertNotNil(recovered.queue[0].message)
        XCTAssertEqual(storage.mediaURL("../../escape.wav").deletingLastPathComponent(), storage.mediaDirectory)
    }

    func testInvalidLibraryIsNotSilentlyOverwritten() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let storage = try LibraryStorage(root: root)
        let original = Data("not valid json".utf8)
        try original.write(to: storage.stateURL)
        XCTAssertThrowsError(try storage.load())
        XCTAssertEqual(try Data(contentsOf: storage.stateURL), original)
    }

    func testAudioImportCopiesAndReferenceCleanupPreservesSharedAudio() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let storage = try LibraryStorage(root: root)
        let source = root.appendingPathComponent("Original.wav")
        try Data([1, 2, 3, 4]).write(to: source)
        let imported = try storage.importFile(source)
        let destination = storage.mediaURL(imported.filename)
        XCTAssertNotEqual(destination, source)
        XCTAssertEqual(try Data(contentsOf: destination), Data([1, 2, 3, 4]))
        let item = QueueItem(title: imported.title, audioFilename: imported.filename)
        storage.removeMediaIfUnused(imported.filename, state: .init(queue: [item]))
        XCTAssertTrue(FileManager.default.fileExists(atPath: destination.path))
        storage.removeMediaIfUnused(imported.filename, state: .init())
        XCTAssertFalse(FileManager.default.fileExists(atPath: destination.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: source.path))
    }

    func testRejectsIncompleteModelBeforeLoadingEngine() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: url) }
        try Data("<html>server error</html>".utf8).write(to: url)
        XCTAssertThrowsError(try ModelIntegrity.verify(url, model: WhisperModel.catalog[0]))
    }

    func testModelHashValidationRejectsSameSizeCorruption() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: url) }
        let model = WhisperModel(id: "fixture", name: "Fixture", size: 3,
                                 sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
                                 summary: "", isMultilingual: false, recommended: false)
        try Data("abc".utf8).write(to: url)
        XCTAssertNoThrow(try ModelIntegrity.verify(url, model: model))
        try Data("abd".utf8).write(to: url)
        XCTAssertThrowsError(try ModelIntegrity.verify(url, model: model))
    }

    func testDecoderResamplesStereoTo16kMono() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".wav")
        defer { try? FileManager.default.removeItem(at: url) }
        let format = AVAudioFormat(standardFormatWithSampleRate: 48000, channels: 2)!
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 48000)!
        buffer.frameLength = 48000
        for i in 0..<48000 {
            let value = Float(sin(Double(i) * 2 * .pi * 440 / 48000)) * 0.25
            buffer.floatChannelData![0][i] = value
            buffer.floatChannelData![1][i] = value
        }
        do {
            let file = try AVAudioFile(forWriting: url, settings: format.settings)
            try file.write(from: buffer)
        }
        let decoded = try AudioDecoder.decode(url, isCancelled: { false }, progress: { _ in })
        defer { try? FileManager.default.removeItem(at: decoded.url) }
        XCTAssertEqual(decoded.duration, 1, accuracy: 0.02)
        XCTAssertEqual(decoded.sampleCount, 16000, accuracy: 320)
        XCTAssertEqual(try Data(contentsOf: decoded.url).count, Int(decoded.sampleCount) * 4)
        XCTAssertThrowsError(try AudioDecoder.decode(url, isCancelled: { true }, progress: { _ in }))
    }

    @MainActor
    func testRealPipelineWithPreparedFixtures() async throws {
        // Optional integration: the host smoke script prepares these verified fixtures.
        // All ordinary unit tests work without a network or model download.
        let modelSource = URL(fileURLWithPath: "/tmp/wordvale-ggml-tiny.en.bin")
        let audioSource = URL(fileURLWithPath: "/tmp/wordvale-jfk.wav")
        try XCTSkipUnless(FileManager.default.fileExists(atPath: modelSource.path) && FileManager.default.fileExists(atPath: audioSource.path), "Prepare /tmp/wordvale-jfk.wav and /tmp/wordvale-ggml-tiny.en.bin using the host smoke script overrides documented in ios/README.md.")
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let modelDirectory = root.appendingPathComponent("Models")
        try FileManager.default.createDirectory(at: modelDirectory, withIntermediateDirectories: true)
        let model = try XCTUnwrap(WhisperModel.catalog.first(where: { $0.id == "tiny.en" }))
        let localModel = modelDirectory.appendingPathComponent(model.filename)
        try FileManager.default.copyItem(at: modelSource, to: localModel)
        try ModelIntegrity.verify(localModel, model: model)
        let storage = try LibraryStorage(root: root.appendingPathComponent("Library"))
        let models = try ModelStore(directory: modelDirectory)
        let oldModel = UserDefaults.standard.object(forKey: "ios.selectedModel")
        let oldWords = UserDefaults.standard.object(forKey: "ios.wordTimestamps")
        defer {
            UserDefaults.standard.set(oldModel, forKey: "ios.selectedModel")
            UserDefaults.standard.set(oldWords, forKey: "ios.wordTimestamps")
        }
        let store = try AppStore(storage: storage, models: models)
        store.selectedModelID = model.id
        store.wordTimestamps = true
        let imported = await store.importFiles([audioSource])
        XCTAssertTrue(imported)
        XCTAssertEqual(store.queue.count, 1)
        store.startQueue()
        let deadline = Date().addingTimeInterval(120)
        while store.isProcessing && Date() < deadline { try await Task.sleep(nanoseconds: 100_000_000) }
        if store.isProcessing { store.cancelProcessing(); XCTFail("Transcription did not complete in 120 seconds"); return }
        XCTAssertEqual(store.queue.first?.status, .completed, store.queue.first?.message ?? "")
        let result = try XCTUnwrap(store.transcripts.first)
        XCTAssertTrue(result.text.lowercased().contains("country"), result.text)
        XCTAssertGreaterThan(result.duration, 10)
        XCTAssertFalse(result.segments.isEmpty)
        XCTAssertTrue(result.segments.contains(where: { !$0.words.isEmpty }))
        XCTAssertNotNil(store.audioURL(for: result))
        XCTAssertTrue(FileManager.default.fileExists(atPath: try store.export(result, format: .srt).path))
        let restored = try storage.load()
        XCTAssertEqual(restored.transcripts.first?.text, result.text)
        XCTAssertEqual(restored.queue.first?.status, .completed)
        store.deleteTranscript(result.id)
        XCTAssertTrue(try storage.load().transcripts.isEmpty)
        XCTAssertFalse(FileManager.default.fileExists(atPath: storage.mediaURL(result.audioFilename).path))
    }

    func testEngineRejectsMissingModelWithoutCrashing() async {
        let engine = WhisperEngine()
        do {
            _ = try await engine.transcribe(audioURL: URL(fileURLWithPath: "/missing.wav"), modelURL: URL(fileURLWithPath: "/missing-model.bin")) { _ in }
            XCTFail("Expected missing model failure")
        } catch { XCTAssertFalse(error.localizedDescription.isEmpty) }
    }
}
