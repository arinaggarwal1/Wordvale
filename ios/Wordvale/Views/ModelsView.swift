import SwiftUI

struct ModelsView: View {
    @ObservedObject var store: AppStore
    @ObservedObject var models: ModelStore
    @State private var pendingDeletion: WhisperModel?

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Download once. Transcribe offline.")
                        .font(.title2.weight(.semibold))
                        .foregroundStyle(WordvaleTheme.ink)
                    Text("Start with Base for everyday recordings. Larger models can improve accuracy, with more storage and processing time.")
                        .font(.subheadline)
                        .foregroundStyle(WordvaleTheme.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.vertical, 8)
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
            }

            Section {
                ForEach(models.catalog) { model in
                    modelRow(model)
                }
            } header: { Text("Whisper models").foregroundStyle(WordvaleTheme.secondary) }
            footer: {
                Text("Downloads need an internet connection. Audio is processed on this iPhone. Model files are excluded from iCloud backups and can be downloaded again.")
                    .foregroundStyle(WordvaleTheme.secondary)
            }

            Section {
                LabeledContent("Processing", value: "On device · Metal")
                LabeledContent("Recommended device", value: "iPhone 15 Pro")
                NavigationLink("Transcription settings") {
                    TranscriptionSettingsView(store: store, models: models)
                }
                .disabled(store.isProcessing || store.isStartingRecording || store.recorder.isRecording)
            } header: { Text("On your iPhone").foregroundStyle(WordvaleTheme.secondary) }
            footer: {
                Text("Long recordings and larger models use more battery and may warm your iPhone. Keep Wordvale in the foreground during transcription.")
                    .foregroundStyle(WordvaleTheme.secondary)
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(WordvaleTheme.paper)
        .navigationTitle("Models")
        .alert("Delete downloaded model?", isPresented: Binding(
            get: { pendingDeletion != nil },
            set: { if !$0 { pendingDeletion = nil } }
        )) {
            Button("Cancel", role: .cancel) { pendingDeletion = nil }
            Button("Delete", role: .destructive) {
                if let model = pendingDeletion {
                    do { try models.delete(model) }
                    catch { store.errorMessage = error.localizedDescription }
                }
                pendingDeletion = nil
            }
        } message: {
            Text("Remove \(pendingDeletion?.name ?? "this model") from this iPhone? Your transcripts will stay in the library. You can download the model again later.")
        }
    }

    @ViewBuilder
    private func modelRow(_ model: WhisperModel) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                Text(model.name).font(.headline).foregroundStyle(WordvaleTheme.ink)
                Spacer()
                Text(ByteCountFormatter.string(fromByteCount: Int64(model.sizeMB) * 1_000_000, countStyle: .file))
                    .font(.caption).foregroundStyle(WordvaleTheme.secondary)
            }
            Text(model.summary)
                .font(.subheadline).foregroundStyle(WordvaleTheme.secondary)
                .fixedSize(horizontal: false, vertical: true)
            if model.recommended {
                Label("Recommended for iPhone", systemImage: "checkmark.seal")
                    .font(.caption).foregroundStyle(WordvaleTheme.accent)
            }

            if let progress = models.progress[model.id] {
                VStack(alignment: .leading, spacing: 8) {
                    ProgressView(value: max(0, min(1, progress)))
                        .accessibilityLabel("Downloading \(model.name)")
                    HStack {
                        Text("Downloading · \(Int(progress * 100))%")
                            .font(.caption.monospacedDigit()).foregroundStyle(WordvaleTheme.secondary)
                        Spacer()
                        Button("Cancel") { models.cancelDownload(model.id) }
                            .font(.subheadline).frame(minHeight: 44)
                    }
                }
            } else if models.isInstalled(model) {
                HStack(spacing: 16) {
                    Button {
                        store.selectedModelID = model.id
                    } label: {
                        Label(store.selectedModelID == model.id ? "Selected" : "Use model",
                              systemImage: store.selectedModelID == model.id ? "checkmark.circle.fill" : "circle")
                            .frame(minHeight: 44)
                    }
                    .disabled(store.isProcessing || store.isStartingRecording || store.recorder.isRecording)
                    Spacer(minLength: 0)
                    Button(role: .destructive) { pendingDeletion = model } label: {
                        Image(systemName: "trash").frame(minWidth: 44, minHeight: 44)
                    }
                    .disabled(store.isProcessing)
                    .accessibilityLabel("Delete \(model.name)")
                }
            } else {
                Button { models.download(model) } label: {
                    Label(models.errors[model.id] == nil ? "Download model" : "Retry download", systemImage: "arrow.down.circle")
                        .frame(minHeight: 44)
                }
            }

            if let error = models.errors[model.id] {
                Label(error, systemImage: "exclamationmark.circle")
                    .font(.footnote).foregroundStyle(WordvaleTheme.danger)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.vertical, 9)
        .buttonStyle(.borderless)
    }
}
