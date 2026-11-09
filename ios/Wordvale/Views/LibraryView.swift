import SwiftUI

struct LibraryView: View {
    @ObservedObject var store: AppStore
    @State private var query = ""
    @State private var pendingDeletion: Transcript?

    private var filtered: [Transcript] {
        let term = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return store.transcripts.filter {
            term.isEmpty || $0.title.localizedCaseInsensitiveContains(term) || $0.text.localizedCaseInsensitiveContains(term)
        }.sorted { $0.createdAt > $1.createdAt }
    }

    var body: some View {
        List {
            if store.transcripts.isEmpty {
                ContentUnavailableView {
                    Label("A home for your words", systemImage: "books.vertical")
                } description: {
                    Text("Your finished transcripts are saved here automatically. Record or import audio in Transcribe to begin.")
                        .foregroundStyle(WordvaleTheme.secondary)
                }
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
            } else if filtered.isEmpty {
                ContentUnavailableView {
                    Label("No matching transcripts", systemImage: "magnifyingglass")
                } description: {
                    Text("Try another word or recording title.")
                        .foregroundStyle(WordvaleTheme.secondary)
                }
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            } else {
                Section {
                    ForEach(filtered) { transcript in
                        NavigationLink {
                            TranscriptDetailView(store: store, original: transcript)
                        } label: {
                            VStack(alignment: .leading, spacing: 8) {
                                Text(transcript.title)
                                    .font(.headline)
                                    .foregroundStyle(WordvaleTheme.ink)
                                    .lineLimit(2)
                                Text(transcript.text.isEmpty ? "No speech was detected." : transcript.text)
                                    .font(.subheadline)
                                    .foregroundStyle(WordvaleTheme.secondary)
                                    .lineLimit(2)
                                HStack(spacing: 8) {
                                    Text(transcript.createdAt, format: .dateTime.month(.abbreviated).day())
                                    Text("·")
                                    Text(transcript.duration.wordvaleTime)
                                    if transcript.isTranslation {
                                        Text("·")
                                        Text("English translation")
                                    }
                                }
                                .font(.caption)
                                .foregroundStyle(WordvaleTheme.secondary)
                            }
                            .padding(.vertical, 7)
                        }
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            Button("Delete", role: .destructive) { pendingDeletion = transcript }
                        }
                    }
                } footer: {
                    Text("\(store.transcripts.count) \(store.transcripts.count == 1 ? "transcript" : "transcripts") saved on this iPhone")
                        .foregroundStyle(WordvaleTheme.secondary)
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(WordvaleTheme.paper)
        .navigationTitle("Library")
        .searchable(text: $query, prompt: "Search titles and transcripts")
        .alert("Delete transcript and recording?", isPresented: Binding(
            get: { pendingDeletion != nil },
            set: { if !$0 { pendingDeletion = nil } }
        )) {
            Button("Cancel", role: .cancel) { pendingDeletion = nil }
            Button("Delete", role: .destructive) {
                if let transcript = pendingDeletion { store.deleteTranscript(transcript.id) }
                pendingDeletion = nil
            }
        } message: {
            Text("“\(pendingDeletion?.title ?? "")” and Wordvale’s copy of its recording will be deleted. This cannot be undone.")
        }
    }
}

struct TranscriptDetailView: View {
    @ObservedObject var store: AppStore
    let original: Transcript
    @StateObject private var player = TranscriptPlayer()
    @State private var showingTimestamps = false
    @State private var exportedFile: ExportedFile?
    @State private var showingRename = false
    @State private var editedTitle = ""
    @State private var copied = false

    private var transcript: Transcript {
        store.transcripts.first(where: { $0.id == original.id }) ?? original
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                VStack(alignment: .leading, spacing: 8) {
                    Text(transcript.title)
                        .font(.title.weight(.semibold))
                        .foregroundStyle(WordvaleTheme.ink)
                        .textSelection(.enabled)
                    Text(transcript.createdAt, format: .dateTime.month(.wide).day().year())
                        .font(.subheadline)
                        .foregroundStyle(WordvaleTheme.secondary)
                    ViewThatFits(in: .horizontal) {
                        metadata.horizontal
                        metadata.vertical
                    }
                }

                if store.audioURL(for: transcript) != nil {
                    AudioPlaybackView(player: player)
                        .disabled(store.recorder.isRecording || store.isStartingRecording)
                    if store.recorder.isRecording || store.isStartingRecording {
                        Text("Finish your microphone recording before playing audio.")
                            .font(.footnote).foregroundStyle(WordvaleTheme.secondary)
                    }
                }

                Picker("Transcript view", selection: $showingTimestamps) {
                    Text("Text").tag(false)
                    Text("Timestamps").tag(true)
                }
                .pickerStyle(.segmented)

                if transcript.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    ContentUnavailableView {
                        Label("No speech detected", systemImage: "waveform.slash")
                    } description: {
                        Text("Try a clearer recording or a different model.")
                            .foregroundStyle(WordvaleTheme.secondary)
                    }
                } else if showingTimestamps {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(transcript.segments) { segment in
                            VStack(alignment: .leading, spacing: 5) {
                                Button {
                                    player.seek(to: segment.start)
                                    if !player.isPlaying { player.toggle() }
                                } label: {
                                    Label(segment.start.wordvaleTime, systemImage: "play.circle")
                                        .font(.caption.monospacedDigit().weight(.medium))
                                        .frame(minHeight: 44)
                                        .contentShape(Rectangle())
                                }
                                .disabled(store.audioURL(for: transcript) == nil || player.error != nil || store.recorder.isRecording || store.isStartingRecording)
                                .accessibilityLabel("Play from \(segment.start.wordvaleTime)")
                                Text(segment.text.trimmingCharacters(in: .whitespacesAndNewlines))
                                    .font(.body)
                                    .lineSpacing(5)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .textSelection(.enabled)
                                    .foregroundStyle(WordvaleTheme.ink)
                            }
                            .padding(.bottom, 18)
                            .padding(.horizontal, 12)
                            .background(activeSegment(segment) ? WordvaleTheme.soft : Color.clear, in: RoundedRectangle(cornerRadius: 12))
                        }
                    }
                } else {
                    Text(transcript.text)
                        .font(.body)
                        .lineSpacing(7)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .textSelection(.enabled)
                        .foregroundStyle(WordvaleTheme.ink)
                }

                PrivacyNote().padding(.top, 8)
            }
            .frame(maxWidth: 680, alignment: .leading)
            .padding(20)
            .frame(maxWidth: .infinity)
        }
        .background(WordvaleTheme.paper)
        .navigationTitle("Transcript")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Menu {
                    ForEach(ExportFormat.allCases) { format in
                        if format != .ass || TranscriptExporter.canExportKaraoke(transcript) {
                            Button(format.title) { export(format) }
                        }
                    }
                } label: { Image(systemName: "square.and.arrow.up").frame(minWidth: 44, minHeight: 44) }
                .accessibilityLabel("Export transcript")

                Menu {
                    Button(copied ? "Copied" : "Copy text", systemImage: "doc.on.doc") {
                        UIPasteboard.general.string = transcript.text
                        copied = true
                    }
                    Button("Rename", systemImage: "pencil") {
                        editedTitle = transcript.title
                        showingRename = true
                    }
                    if let audio = store.audioURL(for: transcript) {
                        ShareLink(item: audio) { Label("Share recording", systemImage: "waveform") }
                    }
                } label: { Image(systemName: "ellipsis.circle").frame(minWidth: 44, minHeight: 44) }
                .accessibilityLabel("Transcript actions")
            }
        }
        .alert("Rename transcript", isPresented: $showingRename) {
            TextField("Title", text: $editedTitle)
            Button("Cancel", role: .cancel) {}
            Button("Save") { store.renameTranscript(transcript.id, title: editedTitle) }
                .disabled(editedTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        .sheet(item: $exportedFile) { file in ActivitySheet(items: [file.url]) }
        .onAppear { player.load(store.audioURL(for: transcript)) }
        .onDisappear { player.stop() }
    }

    private var metadata: (horizontal: some View, vertical: some View) {
        let language = Locale.current.localizedString(forLanguageCode: transcript.language) ?? transcript.language
        let model = store.models.catalog.first(where: { $0.id == transcript.modelID })?.name ?? transcript.modelID
        return (
            HStack(spacing: 12) {
                Label(transcript.duration.wordvaleTime, systemImage: "clock")
                Text(transcript.isTranslation ? "English translation" : language.capitalized)
                Text(model)
            }.font(.caption).foregroundStyle(WordvaleTheme.secondary),
            VStack(alignment: .leading, spacing: 6) {
                Label(transcript.duration.wordvaleTime, systemImage: "clock")
                Text((transcript.isTranslation ? "English translation" : language.capitalized) + " · " + model)
            }.font(.caption).foregroundStyle(WordvaleTheme.secondary)
        )
    }

    private func activeSegment(_ segment: TranscriptSegment) -> Bool {
        player.isPlaying && player.position >= segment.start && player.position < segment.end
    }

    private func export(_ format: ExportFormat) {
        do { exportedFile = ExportedFile(url: try store.export(transcript, format: format)) }
        catch { store.errorMessage = "Could not export the transcript: \(error.localizedDescription)" }
    }
}

private struct ExportedFile: Identifiable {
    let id = UUID()
    let url: URL
}
