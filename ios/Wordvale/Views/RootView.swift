import SwiftUI
import UniformTypeIdentifiers

struct RootView: View {
    @EnvironmentObject private var store: AppStore
    @State private var selectedTab = 0

    var body: some View {
        TabView(selection: $selectedTab) {
            NavigationStack {
                TranscribeView(store: store, models: store.models, recorder: store.recorder,
                               showModels: { selectedTab = 2 })
            }
            .tabItem { Label("Transcribe", systemImage: "waveform") }
            .tag(0)

            NavigationStack { LibraryView(store: store) }
                .tabItem { Label("Library", systemImage: "books.vertical") }
                .tag(1)

            NavigationStack { ModelsView(store: store, models: store.models) }
                .tabItem { Label("Models", systemImage: "square.stack.3d.up") }
                .tag(2)
        }
        .tint(WordvaleTheme.accent)
        .alert("Something needs attention", isPresented: Binding(
            get: { store.errorMessage != nil },
            set: { if !$0 { store.errorMessage = nil } }
        )) {
            Button("OK", role: .cancel) { store.errorMessage = nil }
        } message: { Text(store.errorMessage ?? "") }
    }
}

private struct TranscribeView: View {
    @ObservedObject var store: AppStore
    @ObservedObject var models: ModelStore
    @ObservedObject var recorder: AudioRecorder
    let showModels: () -> Void
    @State private var showingImporter = false
    @State private var pendingRemoval: QueueItem?

    private var pendingCount: Int { store.queue.filter { $0.status == .queued }.count }

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 20) {
                    HStack(alignment: .center, spacing: 18) {
                        WordvaleMark()
                            .stroke(WordvaleTheme.accent, style: StrokeStyle(lineWidth: 3.2, lineCap: .round, lineJoin: .round))
                            .frame(width: 62, height: 62)
                            .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 6) {
                            Text(recorder.isRecording ? "Listening to your world." : "Your recordings. Your words.")
                                .font(.title2.weight(.semibold))
                                .foregroundStyle(WordvaleTheme.ink)
                                .fixedSize(horizontal: false, vertical: true)
                            Text("Record or import audio to make a transcript.")
                                .font(.subheadline)
                                .foregroundStyle(WordvaleTheme.secondary)
                        }
                    }

                    if recorder.isRecording {
                        HStack {
                            Label("Recording", systemImage: "record.circle.fill")
                                .foregroundStyle(WordvaleTheme.danger)
                            Spacer()
                            Text(recorder.duration.wordvaleTime)
                                .font(.title3.monospacedDigit().weight(.medium))
                        }
                        ProgressView(value: Double(max(0, min(1, recorder.level))))
                            .tint(.red)
                            .accessibilityLabel("Microphone level")
                        Button { store.stopRecording() } label: {
                            Label("Stop and add to queue", systemImage: "stop.fill")
                                .frame(maxWidth: .infinity, minHeight: 36)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(.red)
                    } else {
                        Button { Task { await store.startRecording() } } label: {
                            Label(store.isStartingRecording ? "Starting microphone…" : "Record audio", systemImage: "mic.fill")
                                .foregroundStyle(WordvaleTheme.onAccent)
                                .frame(maxWidth: .infinity, minHeight: 36)
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(store.isProcessing || store.isImporting || store.isStartingRecording)
                        .accessibilityIdentifier("recordAudio")
                    }

                    Button { showingImporter = true } label: {
                        HStack {
                            Label(store.isImporting ? "Importing recordings…" : "Import audio or video", systemImage: "square.and.arrow.down")
                            Spacer()
                            if store.isImporting { ProgressView() }
                            else { Image(systemName: "chevron.right").font(.caption.weight(.semibold)) }
                        }
                        .frame(minHeight: 44)
                    }
                    .disabled(store.isImporting || recorder.isRecording || store.isStartingRecording)
                    .accessibilityIdentifier("importAudio")
                    PrivacyNote()
                }
                .padding(.vertical, 10)
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
            }

            Section {
                NavigationLink {
                    TranscriptionSettingsView(store: store, models: models)
                } label: {
                    VStack(alignment: .leading, spacing: 5) {
                        Text(store.selectedModel.name).font(.body.weight(.medium))
                        Text(settingsSummary)
                            .font(.footnote)
                            .foregroundStyle(WordvaleTheme.secondary)
                    }
                    .padding(.vertical, 3)
                }
                .disabled(store.isProcessing || recorder.isRecording || store.isStartingRecording)
                .accessibilityIdentifier("transcriptionSettings")
                if !models.isInstalled(store.selectedModel) {
                    Button(action: showModels) {
                        Label("Download a model to get started", systemImage: "arrow.down.circle")
                            .font(.subheadline)
                            .frame(minHeight: 44)
                    }
                }
            } header: { Text("Transcription settings").foregroundStyle(WordvaleTheme.secondary) }

            if let message = store.statusMessage, !message.isEmpty {
                Section {
                    Label(message, systemImage: "info.circle")
                        .font(.footnote)
                        .foregroundStyle(WordvaleTheme.secondary)
                }
            }

            if !store.queue.isEmpty {
                Section {
                    ForEach(store.queue) { item in
                        if let transcriptID = item.transcriptID,
                           let transcript = store.transcripts.first(where: { $0.id == transcriptID }) {
                            NavigationLink { TranscriptDetailView(store: store, original: transcript) } label: {
                                QueueRow(item: item)
                            }
                        } else {
                            QueueRow(item: item)
                                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                    if item.status != .processing {
                                        Button("Remove", role: .destructive) { pendingRemoval = item }
                                    }
                                    if item.status == .failed || item.status == .cancelled {
                                        Button("Retry") { store.retryQueueItem(item.id) }.tint(WordvaleTheme.accent)
                                    }
                                }
                        }
                    }
                } header: {
                    HStack {
                        Text("Queue · \(store.queue.count)")
                            .foregroundStyle(WordvaleTheme.secondary)
                        Spacer()
                        if store.queue.contains(where: { $0.status == .completed }) {
                            Button("Clear finished") { store.clearFinished() }
                                .textCase(nil)
                                .frame(minHeight: 44)
                        }
                    }
                } footer: {
                    Text("Completed transcripts are saved to your library. Keep Wordvale open while transcribing.")
                        .foregroundStyle(WordvaleTheme.secondary)
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(WordvaleTheme.paper)
        .navigationTitle("Wordvale")
        .safeAreaInset(edge: .bottom) {
            if store.isProcessing || pendingCount > 0 {
                VStack(spacing: 8) {
                    if store.isProcessing {
                        HStack(spacing: 12) {
                            ProgressView()
                            Text("Transcribing on your iPhone…").font(.subheadline)
                            Spacer(minLength: 0)
                        }
                        Button("Cancel transcription", role: .destructive) { store.cancelProcessing() }
                            .frame(maxWidth: .infinity, minHeight: 44)
                    } else {
                        Button { store.startQueue() } label: {
                            Label(pendingCount == 1 ? "Transcribe recording" : "Transcribe \(pendingCount) recordings",
                                  systemImage: "text.badge.waveform")
                                .foregroundStyle(WordvaleTheme.onAccent)
                                .frame(maxWidth: .infinity, minHeight: 36)
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(!models.isInstalled(store.selectedModel) || recorder.isRecording || store.isImporting || store.isStartingRecording)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 12)
                .background(.regularMaterial)
            }
        }
        .fileImporter(isPresented: $showingImporter, allowedContentTypes: [.audio, .movie], allowsMultipleSelection: true) { result in
            switch result {
            case .success(let urls): Task { await store.importFiles(urls) }
            case .failure(let error): store.errorMessage = "Could not import the recording: \(error.localizedDescription)"
            }
        }
        .alert("Remove queued recording?", isPresented: Binding(
            get: { pendingRemoval != nil },
            set: { if !$0 { pendingRemoval = nil } }
        )) {
            Button("Cancel", role: .cancel) { pendingRemoval = nil }
            Button("Remove", role: .destructive) {
                if let item = pendingRemoval { store.removeQueueItem(item.id) }
                pendingRemoval = nil
            }
        } message: {
            Text("Wordvale’s copy of “\(pendingRemoval?.title ?? "")” will be deleted if it isn’t used by a saved transcript. Share or transcribe an unsaved microphone recording before removing it.")
        }
    }

    private var settingsSummary: String {
        let language = !store.selectedModel.isMultilingual ? "English" : (store.language == "auto" ? "Detect language" : (Locale.current.localizedString(forLanguageCode: store.language) ?? store.language))
        return language + (store.translate ? " · Translate to English" : " · Transcribe")
    }
}

private struct QueueRow: View {
    let item: QueueItem

    private var symbol: String {
        switch item.status {
        case .queued: return "waveform"
        case .processing: return "waveform.badge.mic"
        case .completed: return "checkmark.circle.fill"
        case .failed: return "exclamationmark.circle"
        case .cancelled: return "pause.circle"
        }
    }

    private var statusText: String {
        switch item.status {
        case .queued: return "Ready to transcribe"
        case .processing: return item.message ?? "Transcribing…"
        case .completed: return item.message ?? "Saved to library"
        case .failed: return item.message ?? "Could not transcribe. Swipe to retry."
        case .cancelled: return "Cancelled. Swipe to retry."
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: symbol)
                .font(.title3)
                .foregroundStyle(item.status == .failed ? WordvaleTheme.danger : WordvaleTheme.accent)
                .frame(width: 28)
                .padding(.top, 2)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 6) {
                Text(item.title).font(.body.weight(.medium)).lineLimit(2)
                Text(statusText).font(.footnote).foregroundStyle(WordvaleTheme.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                if item.status == .processing {
                    ProgressView(value: min(1, max(0, item.progress)))
                        .accessibilityLabel("Transcription progress")
                }
            }
        }
        .padding(.vertical, 7)
        .accessibilityElement(children: .combine)
    }
}

struct TranscriptionSettingsView: View {
    @ObservedObject var store: AppStore
    @ObservedObject var models: ModelStore
    private let languages = ["auto", "en", "es", "fr", "de", "it", "pt", "nl", "pl", "uk", "ru", "hi", "ar", "zh", "ja", "ko", "tr", "sv", "da", "fi", "el", "he", "id", "vi", "th", "ta", "te", "bn", "ur"]

    var body: some View {
        Form {
            Section {
                Picker("Model", selection: $store.selectedModelID) {
                    ForEach(models.catalog) { model in
                        Text(model.name + (models.isInstalled(model) ? "" : " · Download needed")).tag(model.id)
                    }
                }
                .accessibilityIdentifier("modelPicker")
                Picker("Language", selection: store.selectedModel.isMultilingual ? $store.language : .constant("en")) {
                    ForEach(languages, id: \.self) { code in
                        Text(code == "auto" ? "Detect automatically" : (Locale.current.localizedString(forLanguageCode: code) ?? code).capitalized)
                            .tag(code)
                    }
                }
                .disabled(!store.selectedModel.isMultilingual)
                .accessibilityIdentifier("languagePicker")
                Toggle("Translate to English", isOn: $store.translate)
                    .disabled(!store.selectedModel.isMultilingual)
                    .accessibilityIdentifier("translateToggle")
            } footer: {
                Text(store.selectedModel.isMultilingual
                     ? "Translation produces an English transcript from speech in another language."
                     : "This model supports English speech. Choose a multilingual model for other languages or translation.")
                    .foregroundStyle(WordvaleTheme.secondary)
            }
            Section {
                Toggle("Word timestamps", isOn: $store.wordTimestamps)
                    .accessibilityIdentifier("wordTimestampsToggle")
            } footer: {
                Text("Include approximate timing for individual words. Useful for karaoke subtitle exports; this can take longer.")
                    .foregroundStyle(WordvaleTheme.secondary)
            }
            Section {
                PrivacyNote()
                Text("Models download once. Audio and transcripts stay on your iPhone; transcription works offline after a model is installed.")
                    .font(.footnote).foregroundStyle(WordvaleTheme.secondary)
            }
        }
        .scrollContentBackground(.hidden)
        .background(WordvaleTheme.paper)
        .navigationTitle("Transcription settings")
        .navigationBarTitleDisplayMode(.inline)
    }
}
