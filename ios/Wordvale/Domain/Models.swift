import Foundation

struct WhisperModel: Identifiable, Hashable, Sendable {
    let id: String
    let name: String
    let size: Int64
    let sha256: String
    let summary: String
    let isMultilingual: Bool
    let recommended: Bool
    var sizeMB: Int { Int((Double(size) / 1_000_000).rounded()) }
    var filename: String { "ggml-\(id).bin" }
    var downloadURL: URL {
        URL(string: "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/\(filename)")!
    }
    static let catalog: [WhisperModel] = [
        .init(id: "base", name: "Base", size: 147951465, sha256: "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe", summary: "A balanced starting point. Transcribe and translate across languages.", isMultilingual: true, recommended: true),
        .init(id: "base.en", name: "Base · English", size: 147964211, sha256: "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002", summary: "A focused choice for English recordings.", isMultilingual: false, recommended: false),
        .init(id: "tiny", name: "Tiny", size: 77691713, sha256: "be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21", summary: "Quick drafts with the smallest download.", isMultilingual: true, recommended: false),
        .init(id: "tiny.en", name: "Tiny · English", size: 77704715, sha256: "921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f", summary: "Lightweight English transcription for short notes.", isMultilingual: false, recommended: false),
        .init(id: "small-q5_1", name: "Small · Compact", size: 190085487, sha256: "ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb", summary: "A compressed Small model. More detail with less storage.", isMultilingual: true, recommended: false),
        .init(id: "small", name: "Small", size: 487601967, sha256: "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b", summary: "More accuracy, with longer processing and higher memory use.", isMultilingual: true, recommended: false),
        .init(id: "small.en", name: "Small · English", size: 487614201, sha256: "c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d", summary: "The most detailed English model offered on iPhone.", isMultilingual: false, recommended: false)
    ]
}

enum QueueStatus: String, Codable, Sendable { case queued, processing, completed, failed, cancelled }

struct QueueItem: Identifiable, Codable, Sendable {
    var id = UUID()
    var title: String
    var audioFilename: String
    var status: QueueStatus = .queued
    var progress: Double = 0
    var message: String?
    var transcriptID: UUID?
}

struct TranscriptWord: Codable, Hashable, Sendable {
    var start: Double
    var end: Double
    var text: String
}

struct TranscriptSegment: Identifiable, Codable, Hashable, Sendable {
    var id: Int
    var start: Double
    var end: Double
    var text: String
    var words: [TranscriptWord] = []
}

struct Transcript: Identifiable, Codable, Hashable, Sendable {
    var id = UUID()
    var title: String
    var createdAt = Date()
    var modelID: String
    var language: String
    var isTranslation: Bool
    var duration: Double
    var text: String
    var segments: [TranscriptSegment]
    var audioFilename: String
}

struct LibraryState: Codable {
    var transcripts: [Transcript] = []
    var queue: [QueueItem] = []
}

enum WordvaleError: LocalizedError {
    case message(String)
    var errorDescription: String? { switch self { case .message(let text): return text } }
}
