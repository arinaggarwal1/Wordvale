import Foundation

private enum SmokeFailure: Error { case failed(String) }

private func require(_ condition: @autoclosure () -> Bool, _ message: String) throws {
    guard condition() else { throw SmokeFailure.failed(message) }
}

private final class ProgressProbe: @unchecked Sendable {
    private let lock = NSLock()
    private var values: [Double] = []
    func append(_ value: Double) { lock.lock(); values.append(value); lock.unlock() }
    var snapshot: [Double] { lock.lock(); defer { lock.unlock() }; return values }
}

/// This executable links the same engine + decoder to the macOS slice of the
/// pinned XCFramework. It is an integration check, not an iPhone benchmark.
@main
struct EngineSmoke {
    static func main() async throws {
        guard CommandLine.arguments.count == 4 else {
            throw SmokeFailure.failed("Usage: EngineSmoke <jfk.wav> <tiny.en.bin> <long.wav>")
        }
        let audio = URL(fileURLWithPath: CommandLine.arguments[1])
        let model = URL(fileURLWithPath: CommandLine.arguments[2])
        let longAudio = URL(fileURLWithPath: CommandLine.arguments[3])
        let engine = WhisperEngine()
        let progress = ProgressProbe()
        let result = try await engine.transcribe(audioURL: audio, modelURL: model,
            options: EngineOptions(language: "en", translate: false, wordTimestamps: true)) {
                progress.append($0)
            }
        try require(result.text.localizedCaseInsensitiveContains("country"), "Expected JFK speech")
        try require(result.duration == 11 && result.language == "en", "Duration or language mismatch")
        try require(!result.segments.isEmpty, "No timed segments")
        try require(result.segments.allSatisfy { $0.start >= 0 && $0.end >= $0.start && $0.end <= result.duration },
                    "Invalid segment timestamps")
        try require(result.segments.contains { !$0.words.isEmpty }, "No word timings")
        let values = progress.snapshot
        try require(values.first == 0 && values.last == 1, "Incomplete progress")
        try require(zip(values, values.dropFirst()).allSatisfy { $0 <= $1 }, "Progress went backwards")
        print("SHORT AUDIO PASSED: \(result.duration)s, \(result.segments.count) segments, \(result.segments.flatMap(\.words).count) words")
        print("TRANSCRIPT: \(result.text)")

        do {
            _ = try await engine.transcribe(audioURL: audio,
                modelURL: model.deletingLastPathComponent().appendingPathComponent("missing-\(UUID()).bin")) { _ in }
            throw SmokeFailure.failed("Missing model did not throw")
        } catch EngineError.missingModel {
            print("MISSING MODEL PASSED")
        }

        let longResult = try await engine.transcribe(audioURL: longAudio, modelURL: model,
            options: EngineOptions(language: "en", translate: false, wordTimestamps: true)) { _ in }
        try require(longResult.duration == 352, "Long recording duration mismatch")
        try require(longResult.segments.contains { $0.start > 300 }, "Second chunk missing")
        try require(longResult.segments.allSatisfy { $0.start >= 0 && $0.end >= $0.start && $0.end <= longResult.duration },
                    "Long recording timestamp out of range")
        try require(zip(longResult.segments, longResult.segments.dropFirst()).allSatisfy { $0.start <= $1.start },
                    "Chunk timestamp ordering is invalid")
        print("LONG AUDIO PASSED: \(longResult.duration)s, \(longResult.segments.count) segments, \(longResult.segments.flatMap(\.words).count) words")

        do {
            _ = try await engine.transcribe(audioURL: longAudio, modelURL: model,
                options: EngineOptions(language: "en")) { fraction in
                    if fraction > 0.12 && fraction < 0.99 { engine.cancel() }
                }
            throw SmokeFailure.failed("Mid-inference cancellation did not throw")
        } catch is CancellationError {
            print("MID-INFERENCE CANCELLATION PASSED")
        }
        print("ENGINE SMOKE PASSED")
    }
}
