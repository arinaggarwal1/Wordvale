import Foundation
import AVFoundation
import ScreenCaptureKit
import CoreGraphics

@available(macOS 13.0, *)
final class Recorder: NSObject, SCStreamOutput, SCStreamDelegate {
    private let folder: URL
    private let useMic: Bool
    private let useSystem: Bool
    private var micMuted = false
    private var systemMuted = false
    private var paused = false
    private var engine: AVAudioEngine?
    private var micFile: AVAudioFile?
    private var systemFile: AVAudioFile?
    private var stream: SCStream?
    private let lock = NSLock()
    private var levelsEnabled = false
    private var lastMicLevelAt: TimeInterval = 0
    private var lastSystemLevelAt: TimeInterval = 0
    private let levelQueue = DispatchQueue(label: "wordvale.levels")
    init(folder: URL, mic: Bool, system: Bool) { self.folder = folder; self.useMic = mic; self.useSystem = system }
    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio else { return }
        lock.lock(); defer { lock.unlock() }
        guard !paused else { return }
        guard let file = systemFile, let pcm = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: AVAudioFrameCount(CMSampleBufferGetNumSamples(sampleBuffer))) else { return }
        var block: CMBlockBuffer?
        var raw = (AudioBufferList(mNumberBuffers: 2, mBuffers: AudioBuffer(mNumberChannels: 1, mDataByteSize: 0, mData: nil)), AudioBuffer(mNumberChannels: 1, mDataByteSize: 0, mData: nil))
        let rawSize = MemoryLayout.size(ofValue: raw)
        let result = withUnsafeMutablePointer(to: &raw) { pointer in
            pointer.withMemoryRebound(to: AudioBufferList.self, capacity: 1) { list in
                CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(sampleBuffer, bufferListSizeNeededOut: nil, bufferListOut: list, bufferListSize: rawSize, blockBufferAllocator: nil, blockBufferMemoryAllocator: nil, flags: 0, blockBufferOut: &block)
            }
        }
        guard result == noErr, let target = pcm.floatChannelData else { return }
        let count = min(Int(pcm.frameCapacity), CMSampleBufferGetNumSamples(sampleBuffer))
        if raw.0.mNumberBuffers >= 2, let left = raw.0.mBuffers.mData, let right = raw.1.mData {
            let l = left.assumingMemoryBound(to: Float.self), r = right.assumingMemoryBound(to: Float.self)
            for i in 0..<count { target[0][i] = systemMuted ? 0 : l[i]; target[1][i] = systemMuted ? 0 : r[i] }
        } else if let data = raw.0.mBuffers.mData {
            let samples = data.assumingMemoryBound(to: Float.self)
            for i in 0..<count { target[0][i] = systemMuted ? 0 : samples[i * 2]; target[1][i] = systemMuted ? 0 : samples[i * 2 + 1] }
        } else { return }
        pcm.frameLength = AVAudioFrameCount(count)
        reportLevel("system", buffer: pcm, muted: systemMuted)
        try? file.write(from: pcm)
    }
    func start() async throws {
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        if useMic {
            let audio = AVAudioEngine()
            let input = audio.inputNode
            let format = input.outputFormat(forBus: 0)
            let file = try AVAudioFile(forWriting: folder.appendingPathComponent("mic.caf"), settings: format.settings)
            micFile = file
            input.installTap(onBus: 0, bufferSize: 2048, format: format) { [weak self] buffer, _ in
                guard let self else { return }
                self.lock.lock(); defer { self.lock.unlock() }
                guard !self.paused else { return }
                self.reportLevel("mic", buffer: buffer, muted: self.micMuted)
                if self.micMuted { for channel in 0..<Int(buffer.format.channelCount) { if let data = buffer.floatChannelData?[channel] { data.update(repeating: 0, count: Int(buffer.frameLength)) } } }
                try? self.micFile?.write(from: buffer)
            }
            try audio.start(); engine = audio
        }
        if useSystem {
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
            guard let display = content.displays.first else { throw NSError(domain: "Recorder", code: 1, userInfo: [NSLocalizedDescriptionKey: "No display available for computer audio capture"]) }
            let filter = SCContentFilter(display: display, excludingWindows: [])
            let config = SCStreamConfiguration(); config.capturesAudio = true; config.excludesCurrentProcessAudio = true; config.sampleRate = 48000; config.channelCount = 2
            config.width = 16; config.height = 16; config.minimumFrameInterval = CMTime(value: 1, timescale: 1)
            let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 48000, channels: 2, interleaved: false)!
            systemFile = try AVAudioFile(forWriting: folder.appendingPathComponent("system.caf"), settings: format.settings)
            let capture = SCStream(filter: filter, configuration: config, delegate: self)
            try capture.addStreamOutput(self, type: .audio, sampleHandlerQueue: DispatchQueue(label: "wordvale.systemaudio"))
            try await capture.startCapture(); stream = capture
        }
    }
    private func reportLevel(_ source: String, buffer: AVAudioPCMBuffer, muted: Bool) {
        guard levelsEnabled else { return }
        let now = Date.timeIntervalSinceReferenceDate
        if source == "mic" {
            guard now - lastMicLevelAt >= 0.05 else { return }
            lastMicLevelAt = now
        } else {
            guard now - lastSystemLevelAt >= 0.05 else { return }
            lastSystemLevelAt = now
        }
        var energy: Float = 0
        if !muted, let channels = buffer.floatChannelData {
            let count = Int(buffer.frameLength)
            if count > 0 {
                let stride = max(1, count / 128)
                var samples = 0
                for index in Swift.stride(from: 0, to: count, by: stride) {
                    for channel in 0..<Int(buffer.format.channelCount) {
                        let value = channels[channel][index]
                        energy += value * value
                        samples += 1
                    }
                }
                let rms = sqrt(energy / Float(max(samples, 1)))
                energy = min(1, pow(max(0, rms - 0.004), 0.65) * 5.5)
            }
        }
        let value = energy
        levelQueue.async {
            print("LEVEL \(source) \(value)")
            fflush(stdout)
        }
    }
    func enableLevels() { lock.lock(); defer { lock.unlock() }; levelsEnabled = true }
    func setPaused(_ value: Bool) { lock.lock(); defer { lock.unlock() }; paused = value }
    func setMute(_ source: String, _ value: Bool) { lock.lock(); defer { lock.unlock() }; if source == "mic" { micMuted = value } else { systemMuted = value } }
    func stop() async { try? await stream?.stopCapture(); engine?.stop(); engine?.inputNode.removeTap(onBus: 0); micFile = nil; systemFile = nil }
}

@main struct Main {
    static func main() async {
        if CommandLine.arguments.count == 2 && CommandLine.arguments[1] == "--permissions" {
            let mic: String
            switch AVCaptureDevice.authorizationStatus(for: .audio) {
            case .authorized: mic = "granted"
            case .notDetermined: mic = "prompt"
            default: mic = "denied"
            }
            print("{\"mic\":\"\(mic)\",\"system\":\(CGPreflightScreenCaptureAccess())}")
            return
        }
        if CommandLine.arguments.count == 2 && CommandLine.arguments[1] == "--request-system" {
            print(CGRequestScreenCaptureAccess() ? "granted" : "unavailable")
            return
        }
        guard #available(macOS 13.0, *), CommandLine.arguments.count == 4 else { print("ERROR unsupported macOS or arguments"); return }
        let recorder = Recorder(folder: URL(fileURLWithPath: CommandLine.arguments[1]), mic: CommandLine.arguments[2] == "1", system: CommandLine.arguments[3] == "1")
        do { try await recorder.start(); print("READY"); fflush(stdout); recorder.enableLevels() } catch { print("ERROR \(error.localizedDescription)"); fflush(stdout); return }
        while let line = readLine() {
            let parts = line.split(separator: " ").map(String.init)
            if parts.first == "STOP" { await recorder.stop(); return }
            if parts.count == 2 && parts[0] == "PAUSE" { recorder.setPaused(parts[1] == "1") }
            if parts.count == 3 && parts[0] == "MUTE" { recorder.setMute(parts[1], parts[2] == "1");  }
        }
        await recorder.stop()
    }
}
