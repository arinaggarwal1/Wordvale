import Foundation

enum ExportFormat: String, CaseIterable, Identifiable {
    case text, timedText, srt, vtt, json, ass
    var id: String { rawValue }
    var title: String {
        switch self {
        case .text: return "Plain text"
        case .timedText: return "Timed text"
        case .srt: return "SRT subtitles"
        case .vtt: return "WebVTT subtitles"
        case .json: return "JSON"
        case .ass: return "Karaoke ASS"
        }
    }
    var fileExtension: String {
        switch self {
        case .text, .timedText: return "txt"
        default: return rawValue
        }
    }
}

struct TranscriptExporter {
    static func timestamp(_ seconds: Double, separator: String = ",") -> String {
        let ms = max(0, Int(((seconds.isFinite ? seconds : 0) * 1000).rounded()))
        return String(format: "%02d:%02d:%02d%@%03d", ms / 3_600_000, (ms / 60_000) % 60, (ms / 1000) % 60, separator, ms % 1000)
    }

    static func canExportKaraoke(_ transcript: Transcript) -> Bool {
        !transcript.segments.isEmpty && transcript.segments.allSatisfy { segment in
            guard !segment.words.isEmpty else { return false }
            var previous = segment.start
            return segment.words.allSatisfy { word in
                defer { previous = word.end }
                return word.start.isFinite && word.end.isFinite && word.start >= previous - 0.01 && word.end > word.start && word.start >= segment.start - 0.01 && word.end <= segment.end + 0.02
            }
        }
    }

    static func content(_ transcript: Transcript, format: ExportFormat) throws -> Data {
        let text: String
        switch format {
        case .text: text = transcript.text
        case .timedText:
            text = transcript.segments.map { "[\(timestamp($0.start, separator: ".")) – \(timestamp($0.end, separator: "."))] \($0.text.trimmingCharacters(in: .whitespacesAndNewlines))" }.joined(separator: "\n\n")
        case .srt, .vtt:
            let separator = format == .srt ? "," : "."
            text = (format == .vtt ? "WEBVTT\n\n" : "") + transcript.segments.enumerated().map { index, segment in
                let body = segment.text.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: "\r", with: "")
                let safe = format == .vtt ? body.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: ">", with: "&gt;") : body
                return "\(index + 1)\n\(timestamp(segment.start, separator: separator)) --> \(timestamp(max(segment.start + 0.001, segment.end), separator: separator))\n\(safe)"
            }.joined(separator: "\n\n") + "\n"
        case .json:
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
            encoder.dateEncodingStrategy = .iso8601
            return try encoder.encode(transcript)
        case .ass:
            guard canExportKaraoke(transcript) else { throw WordvaleError.message("Karaoke export needs reliable word timestamps. Transcribe again with Word timestamps enabled, or choose SRT.") }
            let header = """
            [Script Info]
            ScriptType: v4.00+
            PlayResX: 1920
            PlayResY: 1080
            WrapStyle: 0

            [V4+ Styles]
            Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
            Style: Default,Arial,56,&H00FFFFFF,&H0000FFFF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,1,2,50,50,70,1

            [Events]
            Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
            """
            text = header + "\n" + transcript.segments.map { segment in
                var previous = segment.start
                let body = segment.words.map { word -> String in
                    let gap = max(0, Int((word.start * 100).rounded()) - Int((previous * 100).rounded()))
                    let duration = max(1, Int((word.end * 100).rounded()) - Int((word.start * 100).rounded()))
                    previous = word.end
                    let safe = word.text.replacingOccurrences(of: "\\", with: "＼").replacingOccurrences(of: "{", with: "(").replacingOccurrences(of: "}", with: ")").replacingOccurrences(of: "\n", with: " ")
                    return (gap > 0 ? "{\\k\(gap)}" : "") + "{\\kf\(duration)}" + safe
                }.joined(separator: " ")
                return "Dialogue: 0,\(assTimestamp(segment.start)),\(assTimestamp(segment.end)),Default,,0,0,0,,\(body)"
            }.joined(separator: "\n") + "\n"
        }
        return Data(text.utf8)
    }

    static func safeFilename(_ title: String) -> String {
        let illegal = CharacterSet(charactersIn: "/\\:?%*|\"<>\n\r\0")
        let name = title.components(separatedBy: illegal).joined(separator: "-").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, name != ".", name != ".." else { return "Transcript" }
        // Leave room for the extension on filesystems with byte or UTF-16 limits.
        // A single visible emoji can contain many Unicode scalars.
        var result = ""
        for character in name {
            let next = result + String(character)
            if next.utf8.count > 180 || next.utf16.count > 180 || next.count > 100 { break }
            result = next
        }
        return result.isEmpty ? "Transcript" : result
    }

    private static func assTimestamp(_ seconds: Double) -> String {
        let cs = max(0, Int((seconds * 100).rounded()))
        return String(format: "%d:%02d:%02d.%02d", cs / 360_000, (cs / 6000) % 60, (cs / 100) % 60, cs % 100)
    }
}
