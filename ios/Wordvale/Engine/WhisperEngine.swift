import Foundation
import whisper

struct EngineOptions: Sendable {
    var language: String = "auto"
    var translate: Bool = false
    var wordTimestamps: Bool = false
}

struct EngineWord: Sendable {
    let start: Double
    let end: Double
    let text: String
}

struct EngineSegment: Sendable {
    let id: Int
    let start: Double
    let end: Double
    let text: String
    let words: [EngineWord]
}

struct EngineResult: Sendable {
    let text: String
    let language: String
    let duration: Double
    let segments: [EngineSegment]
}

/// A single serial worker owns every whisper context. Cancellation and progress
/// callbacks can arrive on C worker threads and use a separate locked job token.
final class WhisperEngine: @unchecked Sendable {
    private let queue = DispatchQueue(label: "app.wordvale.whisper", qos: .userInitiated)
    private let lock = NSLock()
    private var activeJob: EngineJob?

    func transcribe(
        audioURL: URL,
        modelURL: URL,
        options: EngineOptions = EngineOptions(),
        progress: @escaping @Sendable (Double) -> Void
    ) async throws -> EngineResult {
        let job = EngineJob(progress: progress)
        guard reserve(job) else { throw EngineError.busy }
        defer { release(job) }
        return try await withTaskCancellationHandler {
            try Task.checkCancellation()
            return try await withCheckedThrowingContinuation { continuation in
                queue.async {
                    do {
                        let result = try self.run(audioURL: audioURL, modelURL: modelURL,
                                                  options: options, job: job)
                        continuation.resume(returning: result)
                    } catch {
                        continuation.resume(throwing: error)
                    }
                }
            }
        } onCancel: {
            job.cancel()
        }
    }

    func cancel() {
        lock.lock()
        let job = activeJob
        lock.unlock()
        job?.cancel()
    }

    private func reserve(_ job: EngineJob) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard activeJob == nil else { return false }
        activeJob = job
        return true
    }

    private func release(_ job: EngineJob) {
        lock.lock()
        defer { lock.unlock() }
        if activeJob === job { activeJob = nil }
    }

    private func run(audioURL: URL, modelURL: URL, options: EngineOptions, job: EngineJob) throws -> EngineResult {
        try job.checkCancellation()
        guard FileManager.default.fileExists(atPath: modelURL.path) else { throw EngineError.missingModel }
        if options.language != "auto" && whisper_lang_id(options.language) < 0 {
            throw EngineError.unsupportedLanguage
        }

        job.report(0)
        let decoded = try AudioDecoder.decode(audioURL, isCancelled: { job.isCancelled }) {
            job.report($0 * 0.06)
        }
        defer { try? FileManager.default.removeItem(at: decoded.url) }
        try job.checkCancellation()

        var contextParameters = whisper_context_default_params()
        #if targetEnvironment(simulator)
        contextParameters.use_gpu = false
        #else
        contextParameters.use_gpu = true
        #endif
        // Flash attention reduces working memory on the A17 Pro Metal backend.
        contextParameters.flash_attn = true
        guard let context = whisper_init_from_file_with_params(modelURL.path, contextParameters) else {
            throw EngineError.modelLoad
        }
        defer { whisper_free(context) }
        try job.checkCancellation()

        let multilingual = whisper_is_multilingual(context) != 0
        if options.translate && !multilingual { throw EngineError.translationNeedsMultilingual }
        if !multilingual && options.language != "auto" && options.language != "en" {
            throw EngineError.languageNeedsMultilingual
        }
        job.report(0.08)
        let file = try FileHandle(forReadingFrom: decoded.url)
        defer { try? file.close() }
        let chunkCapacity = AudioDecoder.sampleRate * 5 * 60
        var position: Int64 = 0
        var segments: [EngineSegment] = []
        var language = multilingual ? options.language : "en"

        while position < decoded.sampleCount {
            try job.checkCancellation()
            let available = Int(min(Int64(chunkCapacity), decoded.sampleCount - position))
            try file.seek(toOffset: UInt64(position) * UInt64(MemoryLayout<Float>.size))
            guard let bytes = try file.read(upToCount: available * MemoryLayout<Float>.size),
                  bytes.count == available * MemoryLayout<Float>.size else { throw AudioError.invalidPCM }
            var samples = [Float](repeating: 0, count: available)
            _ = samples.withUnsafeMutableBytes { bytes.copyBytes(to: $0) }
            let hasMore = position + Int64(available) < decoded.sampleCount
            let consumed = hasMore ? Self.quietBoundary(in: samples) : samples.count
            if consumed < samples.count { samples.removeLast(samples.count - consumed) }
            // Whisper needs a minimum analysis window; do not lose a short last chunk.
            if samples.count < AudioDecoder.sampleRate {
                samples += [Float](repeating: 0, count: AudioDecoder.sampleRate - samples.count)
            }

            let offset = Double(position) / Double(AudioDecoder.sampleRate)
            job.setChunk(start: Double(position) / Double(decoded.sampleCount),
                         fraction: Double(consumed) / Double(decoded.sampleCount))
            var parameters = whisper_full_default_params(WHISPER_SAMPLING_GREEDY)
            parameters.n_threads = Int32(max(1, min(4, ProcessInfo.processInfo.activeProcessorCount - 2)))
            parameters.translate = options.translate
            parameters.no_context = true
            parameters.no_timestamps = false
            parameters.single_segment = false
            parameters.print_special = false
            parameters.print_progress = false
            parameters.print_realtime = false
            parameters.print_timestamps = false
            parameters.token_timestamps = options.wordTimestamps
            parameters.split_on_word = true
            parameters.suppress_blank = true
            parameters.suppress_nst = true
            parameters.greedy.best_of = 1
            parameters.temperature = 0
            parameters.temperature_inc = 0.2
            parameters.progress_callback = { _, _, percent, opaque in
                guard let opaque else { return }
                Unmanaged<EngineJob>.fromOpaque(opaque).takeUnretainedValue().reportChunk(percent)
            }
            parameters.progress_callback_user_data = Unmanaged.passUnretained(job).toOpaque()
            parameters.abort_callback = { opaque in
                guard let opaque else { return false }
                return Unmanaged<EngineJob>.fromOpaque(opaque).takeUnretainedValue().isCancelled
            }
            parameters.abort_callback_user_data = Unmanaged.passUnretained(job).toOpaque()
            parameters.encoder_begin_callback = { _, _, opaque in
                guard let opaque else { return true }
                return !Unmanaged<EngineJob>.fromOpaque(opaque).takeUnretainedValue().isCancelled
            }
            parameters.encoder_begin_callback_user_data = Unmanaged.passUnretained(job).toOpaque()

            // C pointers are valid for the complete synchronous whisper_full call.
            let selectedLanguage = multilingual ? language : "en"
            let status = selectedLanguage.withCString { languagePointer in
                parameters.language = languagePointer
                return samples.withUnsafeBufferPointer { buffer in
                    whisper_full(context, parameters, buffer.baseAddress, Int32(buffer.count))
                }
            }
            try job.checkCancellation()
            guard status == 0 else { throw EngineError.inference(status) }
            if language == "auto", let code = whisper_lang_str(whisper_full_lang_id(context)) {
                language = String(cString: code)
            }
            let count = whisper_full_n_segments(context)
            for index in 0..<count {
                guard let rawText = whisper_full_get_segment_text(context, index) else { continue }
                let text = String(cString: rawText).trimmingCharacters(in: .whitespacesAndNewlines)
                guard !text.isEmpty else { continue }
                let start = min(decoded.duration, max(offset, offset + Double(whisper_full_get_segment_t0(context, index)) / 100))
                let end = max(start, min(decoded.duration, offset + Double(whisper_full_get_segment_t1(context, index)) / 100))
                let words = options.wordTimestamps
                    ? Self.words(context: context, segment: index, offset: offset, duration: decoded.duration)
                    : []
                segments.append(EngineSegment(id: segments.count, start: start, end: end, text: text, words: words))
            }
            position += Int64(consumed)
            job.report(0.08 + 0.92 * Double(position) / Double(decoded.sampleCount))
        }
        try job.checkCancellation()
        job.report(1)
        return EngineResult(text: segments.map(\.text).joined(separator: " "), language: language,
                            duration: decoded.duration, segments: segments)
    }

    /// Split near a quiet 100 ms window in the last five seconds. Every sample
    /// is consumed exactly once, avoiding overlapping duplicate transcript text.
    static func quietBoundary(in samples: [Float]) -> Int {
        let window = AudioDecoder.sampleRate / 10
        let searchStart = max(window, samples.count - AudioDecoder.sampleRate * 5)
        guard samples.count > window * 2 else { return samples.count }
        var best = samples.count
        var lowest = Float.infinity
        for start in stride(from: searchStart, through: samples.count - window, by: window) {
            var power: Float = 0
            for sample in samples[start..<(start + window)] { power += sample * sample }
            if power < lowest { lowest = power; best = start + window / 2 }
        }
        return best
    }

    private static func words(context: OpaquePointer, segment: Int32, offset: Double, duration: Double) -> [EngineWord] {
        var words: [EngineWord] = []
        var pending = Data()
        var start: Double = 0
        var end: Double = 0
        func flush() {
            let text = String(decoding: pending, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
            if !text.isEmpty { words.append(EngineWord(start: start, end: max(start, end), text: text)) }
            pending.removeAll(keepingCapacity: true)
        }
        for index in 0..<whisper_full_n_tokens(context, segment) {
            let token = whisper_full_get_token_data(context, segment, index)
            guard token.id < whisper_token_eot(context), token.t0 >= 0, token.t1 >= token.t0,
                  let pointer = whisper_full_get_token_text(context, segment, index) else { continue }
            let bytes = Data(bytes: pointer, count: strlen(pointer))
            guard !bytes.isEmpty else { continue }
            if let first = bytes.first, first == 32 || first == 10 || first == 9 { flush() }
            if pending.isEmpty { start = min(duration, max(offset, offset + Double(token.t0) / 100)) }
            end = min(duration, max(start, offset + Double(token.t1) / 100))
            pending.append(bytes)
        }
        flush()
        return words
    }
}

private final class EngineJob: @unchecked Sendable {
    private let lock = NSLock()
    private var cancelled = false
    private var lastProgress: Double = -1
    private var chunkStart: Double = 0
    private var chunkFraction: Double = 1
    private let progress: @Sendable (Double) -> Void

    init(progress: @escaping @Sendable (Double) -> Void) { self.progress = progress }

    var isCancelled: Bool {
        lock.lock()
        defer { lock.unlock() }
        return cancelled
    }

    func cancel() { lock.lock(); cancelled = true; lock.unlock() }
    func checkCancellation() throws { if isCancelled { throw CancellationError() } }

    func setChunk(start: Double, fraction: Double) {
        lock.lock()
        chunkStart = start
        chunkFraction = fraction
        lock.unlock()
    }

    func reportChunk(_ percent: Int32) {
        lock.lock()
        let value = 0.08 + 0.92 * (chunkStart + chunkFraction * Double(percent) / 100)
        lock.unlock()
        report(value)
    }

    func report(_ value: Double) {
        let bounded = min(1, max(0, value))
        lock.lock()
        // Decode can generate thousands of buffers; update only at useful steps.
        let shouldReport = !cancelled && ((bounded == 1 && lastProgress < 1) || bounded - lastProgress >= 0.002)
        if shouldReport { lastProgress = bounded }
        lock.unlock()
        if shouldReport { progress(bounded) }
    }
}

enum EngineError: LocalizedError {
    case busy, missingModel, modelLoad, unsupportedLanguage
    case translationNeedsMultilingual, languageNeedsMultilingual
    case inference(Int32)

    var errorDescription: String? {
        switch self {
        case .busy: return "A recording is already being transcribed. Wait for it to finish or cancel it first."
        case .missingModel: return "Download a transcription model before starting."
        case .modelLoad: return "The model could not load. Close other apps, or try deleting and downloading the model again."
        case .unsupportedLanguage: return "This language is not supported by Whisper."
        case .translationNeedsMultilingual: return "Translation needs a multilingual model. Choose Tiny, Base, or Small."
        case .languageNeedsMultilingual: return "This model only supports English. Choose a multilingual model for other languages."
        case .inference(let code): return "Transcription stopped unexpectedly (engine code \(code)). Try a smaller model or another recording."
        }
    }
}
