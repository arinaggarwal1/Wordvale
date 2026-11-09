import SwiftUI
import AVFoundation

@MainActor
final class TranscriptPlayer: ObservableObject {
    @Published private(set) var isPlaying = false
    @Published private(set) var position: TimeInterval = 0
    @Published private(set) var duration: TimeInterval = 0
    @Published private(set) var error: String?

    private var player: AVPlayer?
    private var ticker: Timer?
    private var loadingTask: Task<Void, Never>?

    func load(_ url: URL?) {
        stop()
        loadingTask?.cancel()
        player = nil
        position = 0
        duration = 0
        error = nil
        guard let url else { return }
        let asset = AVURLAsset(url: url)
        loadingTask = Task { [weak self] in
            do {
                let time = try await asset.load(.duration)
                try Task.checkCancellation()
                guard let self else { return }
                self.duration = time.seconds.isFinite ? max(0, time.seconds) : 0
                self.player = AVPlayer(playerItem: AVPlayerItem(asset: asset))
            } catch is CancellationError {
                return
            } catch {
                self?.error = "This recording can’t be played here. The transcript is still available."
            }
        }
    }

    func toggle() {
        guard let player else { return }
        if isPlaying {
            stop()
            return
        }
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
            try AVAudioSession.sharedInstance().setActive(true)
            if position >= max(0, duration - 0.05) { seek(to: 0) }
            player.play()
            isPlaying = true
            ticker?.invalidate()
            ticker = Timer.scheduledTimer(withTimeInterval: 0.15, repeats: true) { [weak self] _ in
                Task { @MainActor in
                    guard let self, let audio = self.player else { return }
                    let current = audio.currentTime().seconds
                    if current.isFinite { self.position = max(0, current) }
                    if audio.currentItem?.status == .failed {
                        self.error = "This recording can’t be played here. The transcript is still available."
                        self.stop()
                    } else if self.duration > 0 && self.position >= self.duration - 0.05 {
                        self.stop()
                    }
                }
            }
        } catch {
            self.error = "Audio playback is unavailable: \(error.localizedDescription)"
        }
    }

    func seek(to time: TimeInterval) {
        guard let player else { return }
        position = min(max(time, 0), duration)
        player.seek(to: CMTime(seconds: position, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
    }

    func skip(_ interval: TimeInterval) { seek(to: position + interval) }

    func stop() {
        player?.pause()
        isPlaying = false
        ticker?.invalidate()
        ticker = nil
    }

    deinit { ticker?.invalidate(); loadingTask?.cancel() }
}

struct AudioPlaybackView: View {
    @ObservedObject var player: TranscriptPlayer

    var body: some View {
        VStack(spacing: 8) {
            if let error = player.error {
                Label(error, systemImage: "exclamationmark.circle")
                    .font(.footnote)
                    .foregroundStyle(WordvaleTheme.secondary)
            } else {
                HStack(spacing: 20) {
                    Button { player.skip(-15) } label: {
                        Image(systemName: "gobackward.15").font(.title2)
                            .frame(minWidth: 44, minHeight: 44)
                    }
                    .accessibilityLabel("Back 15 seconds")
                    Button { player.toggle() } label: {
                        Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                            .font(.title2)
                            .frame(width: 52, height: 52)
                            .background(WordvaleTheme.soft, in: Circle())
                    }
                    .accessibilityLabel(player.isPlaying ? "Pause recording" : "Play recording")
                    Button { player.skip(15) } label: {
                        Image(systemName: "goforward.15").font(.title2)
                            .frame(minWidth: 44, minHeight: 44)
                    }
                    .accessibilityLabel("Forward 15 seconds")
                }
                .disabled(player.duration <= 0)
                Slider(value: Binding(get: { player.position }, set: { player.seek(to: $0) }),
                       in: 0...max(0.1, player.duration))
                    .accessibilityLabel("Playback position")
                    .accessibilityValue("\(player.position.wordvaleTime) of \(player.duration.wordvaleTime)")
                HStack {
                    Text(player.position.wordvaleTime)
                    Spacer()
                    Text(player.duration.wordvaleTime)
                }
                .font(.caption.monospacedDigit())
                .foregroundStyle(WordvaleTheme.secondary)
            }
        }
        .padding(.vertical, 12)
        .buttonStyle(.plain)
    }
}
