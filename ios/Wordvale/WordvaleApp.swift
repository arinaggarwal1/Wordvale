import SwiftUI

@MainActor
final class AppBootstrap: ObservableObject {
    let store: AppStore?
    let failure: String?
    init() {
        do { store = try AppStore(); failure = nil }
        catch { store = nil; failure = error.localizedDescription }
    }
}

@main
struct WordvaleApp: App {
    @StateObject private var bootstrap = AppBootstrap()
    @Environment(\.scenePhase) private var scenePhase
    var body: some Scene {
        WindowGroup {
            if let store = bootstrap.store {
                RootView().environmentObject(store)
                    .onChange(of: scenePhase) { _, phase in store.handleScenePhase(phase) }
                    .onOpenURL { url in Task { await store.importFiles([url]) } }
            } else {
                ContentUnavailableView {
                    Label("Your library couldn’t open", systemImage: "externaldrive.badge.exclamationmark")
                } description: {
                    Text("\(bootstrap.failure ?? "An unexpected storage error occurred.")\n\nYour saved files have not been replaced. You can copy the Wordvale folder through Finder File Sharing before trying again.")
                }
            }
        }
    }
}
