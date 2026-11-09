import Foundation

struct LibraryStorage: Sendable {
    let root: URL
    var mediaDirectory: URL { root.appendingPathComponent("Recordings", isDirectory: true) }
    var stateURL: URL { root.appendingPathComponent("Library.json") }

    init(root: URL? = nil) throws {
        self.root = try root ?? FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true).appendingPathComponent("Wordvale", isDirectory: true)
        try FileManager.default.createDirectory(at: mediaDirectory, withIntermediateDirectories: true)
    }

    func load() throws -> LibraryState {
        guard FileManager.default.fileExists(atPath: stateURL.path) else { return LibraryState() }
        var state = try JSONDecoder().decode(LibraryState.self, from: Data(contentsOf: stateURL))
        for index in state.queue.indices where state.queue[index].status == .processing {
            state.queue[index].status = .cancelled
            state.queue[index].progress = 0
            state.queue[index].message = "Interrupted when the app closed. Tap Retry to start again."
        }
        return state
    }

    func save(_ state: LibraryState) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        try encoder.encode(state).write(to: stateURL, options: [.atomic, .completeFileProtectionUnlessOpen])
    }

    func mediaURL(_ filename: String) -> URL {
        // Stored names are generated locally. Strip path components when reading old/imported state.
        mediaDirectory.appendingPathComponent((filename as NSString).lastPathComponent)
    }

    func importFile(_ source: URL) throws -> (filename: String, title: String) {
        let accessed = source.startAccessingSecurityScopedResource()
        defer { if accessed { source.stopAccessingSecurityScopedResource() } }
        let ext = source.pathExtension.lowercased()
        let supported: Set<String> = ["wav", "mp3", "m4a", "mp4", "mov", "aac", "aif", "aiff", "caf", "flac", "m4v", "3gp", "3gpp"]
        guard supported.contains(ext) else { throw WordvaleError.message("\(source.lastPathComponent): this format is not supported on iPhone. Use WAV, M4A, MP3, MP4, MOV, AAC, AIFF, CAF, or FLAC.") }
        let filename = UUID().uuidString + "." + ext
        let destination = mediaURL(filename)
        var coordinationError: NSError?
        var copyError: Error?
        NSFileCoordinator().coordinate(readingItemAt: source, options: .withoutChanges, error: &coordinationError) { readable in
            do {
                let values = try readable.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
                guard values.isRegularFile == true, (values.fileSize ?? 0) > 0 else { throw WordvaleError.message("The selected recording is empty or unavailable. Download it in Files first.") }
                try FileManager.default.copyItem(at: readable, to: destination)
                try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: destination.path)
            } catch { copyError = error }
        }
        if let error = coordinationError ?? copyError as NSError? {
            try? FileManager.default.removeItem(at: destination)
            throw error
        }
        return (filename, source.deletingPathExtension().lastPathComponent)
    }

    func removeMediaIfUnused(_ filename: String, state: LibraryState) {
        guard !state.transcripts.contains(where: { $0.audioFilename == filename }), !state.queue.contains(where: { $0.audioFilename == filename }) else { return }
        try? FileManager.default.removeItem(at: mediaURL(filename))
    }
}
