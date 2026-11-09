import AVFoundation
import Foundation

/// Decodes the first audio track of an Apple-supported audio or video file.
/// PCM is spooled to disk so importing a long lecture does not allocate its full
/// uncompressed audio in memory. Inference reads bounded chunks from this file.
enum AudioDecoder {
    static let sampleRate = 16_000

    struct DecodedAudio {
        let url: URL
        let sampleCount: Int64
        var duration: Double { Double(sampleCount) / Double(AudioDecoder.sampleRate) }
    }

    static func decode(
        _ source: URL,
        isCancelled: () -> Bool,
        progress: (Double) -> Void
    ) throws -> DecodedAudio {
        let asset = AVURLAsset(url: source)
        guard let track = asset.tracks(withMediaType: .audio).first else {
            throw AudioError.noAudioTrack
        }
        let reader = try AVAssetReader(asset: asset)
        let output = AVAssetReaderTrackOutput(track: track, outputSettings: [
            AVFormatIDKey: kAudioFormatLinearPCM,
            AVSampleRateKey: sampleRate,
            AVNumberOfChannelsKey: 1,
            AVLinearPCMBitDepthKey: 32,
            AVLinearPCMIsFloatKey: true,
            AVLinearPCMIsBigEndianKey: false,
            AVLinearPCMIsNonInterleaved: false
        ])
        output.alwaysCopiesSampleData = false
        guard reader.canAdd(output) else { throw AudioError.unsupportedFormat }
        reader.add(output)

        let temporaryURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("wordvale-pcm-\(UUID().uuidString).f32")
        guard FileManager.default.createFile(atPath: temporaryURL.path, contents: nil) else {
            throw AudioError.temporaryFile
        }
        let handle = try FileHandle(forWritingTo: temporaryURL)
        var succeeded = false
        defer {
            try? handle.close()
            if !succeeded { try? FileManager.default.removeItem(at: temporaryURL) }
        }
        guard reader.startReading() else {
            throw reader.error ?? AudioError.unsupportedFormat
        }
        defer { if reader.status == .reading { reader.cancelReading() } }

        let sourceDuration = CMTimeGetSeconds(asset.duration)
        var byteCount: Int64 = 0
        while reader.status == .reading {
            if isCancelled() { throw CancellationError() }
            let hadSample = try autoreleasepool { () throws -> Bool in
                guard let sample = output.copyNextSampleBuffer() else { return false }
                guard let block = CMSampleBufferGetDataBuffer(sample) else {
                    throw AudioError.invalidPCM
                }
                let length = CMBlockBufferGetDataLength(block)
                var bytes = Data(count: length)
                let status = bytes.withUnsafeMutableBytes { raw in
                    CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: length,
                                               destination: raw.baseAddress!)
                }
                guard status == kCMBlockBufferNoErr, length % MemoryLayout<Float>.size == 0 else {
                    throw AudioError.invalidPCM
                }
                try handle.write(contentsOf: bytes)
                byteCount += Int64(length)
                if sourceDuration.isFinite && sourceDuration > 0 {
                    let position = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sample))
                    progress(min(1, max(0, position / sourceDuration)))
                }
                return true
            }
            if !hadSample { break }
        }
        if isCancelled() { throw CancellationError() }
        guard reader.status == .completed else {
            throw reader.error ?? AudioError.unsupportedFormat
        }
        guard byteCount >= Int64(sampleRate / 10 * MemoryLayout<Float>.size) else {
            throw AudioError.tooShort
        }
        try handle.synchronize()
        succeeded = true
        progress(1)
        return DecodedAudio(url: temporaryURL, sampleCount: byteCount / Int64(MemoryLayout<Float>.size))
    }
}

enum AudioError: LocalizedError {
    case noAudioTrack, unsupportedFormat, temporaryFile, invalidPCM, tooShort
    case microphoneDenied, cannotRecord, noRecording

    var errorDescription: String? {
        switch self {
        case .noAudioTrack: return "This file has no readable audio track. Choose an audio recording or a video with sound."
        case .unsupportedFormat: return "iOS could not decode this file. Try exporting it as M4A, MP3, WAV, or MP4."
        case .temporaryFile: return "There is not enough available storage to prepare this recording."
        case .invalidPCM: return "The audio could not be decoded. Try another copy of the recording."
        case .tooShort: return "This recording is too short to transcribe. Record at least a second of speech."
        case .microphoneDenied: return "Microphone access is off. Enable it for Wordvale in Settings to record."
        case .cannotRecord: return "The microphone could not start. Check that another app is not using it and try again."
        case .noRecording: return "There is no recording to save."
        }
    }
}
