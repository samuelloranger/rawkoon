import RawkoonKit
import SwiftUI

extension FocusedValues {
    /// The focused window's tab selection, so menu commands act on that window only.
    @Entry var rootTabSelection: Binding<RootTab>?
    @Entry var showPlayer: (() -> Void)?
}

/// The Mac/iPad menu bar: no document commands, Settings on ⌘,, a Go menu over
/// the sidebar tabs and a Playback menu for the active book.
struct RawkoonCommands: Commands {
    let model: AppModel
    @FocusedValue(\.rootTabSelection) private var selection
    @FocusedValue(\.showPlayer) private var showPlayer

    var body: some Commands {
        CommandGroup(replacing: .saveItem) {}
        CommandGroup(replacing: .importExport) {}
        CommandGroup(replacing: .help) {}

        CommandGroup(replacing: .appSettings) {
            Button("Settings…") { selection?.wrappedValue = .settings }
                .keyboardShortcut(",", modifiers: .command)
                .disabled(selection == nil)
        }

        CommandMenu("Go") {
            ForEach(Array(RootTab.visibleSidebar(isAdmin: model.isAdmin).enumerated()), id: \.element) { index, tab in
                if index < 9, let key = "\(index + 1)".first {
                    goButton(tab).keyboardShortcut(KeyEquivalent(key), modifiers: .command)
                } else {
                    goButton(tab)
                }
            }
        }

        // ⌘←/⌘→ are caret moves in text fields and a bare Space would be swallowed
        // by them, so transport uses bracket keys and ⌥Space.
        CommandMenu("Playback") {
            Button("Play/Pause") {
                model.player.isPlaying ? model.player.pause() : model.player.play()
            }
            .keyboardShortcut(.space, modifiers: .option)
            .disabled(noBook)
            Button("Skip Back 30 Seconds") { model.player.skipBackward(30) }
                .keyboardShortcut("[", modifiers: .command)
                .disabled(noBook)
            Button("Skip Forward 30 Seconds") { model.player.skipForward(30) }
                .keyboardShortcut("]", modifiers: .command)
                .disabled(noBook)
            Button("Previous Chapter") { model.player.prevChapter() }
                .keyboardShortcut("[", modifiers: [.command, .shift])
                .disabled(noBook)
            Button("Next Chapter") { model.player.nextChapter() }
                .keyboardShortcut("]", modifiers: [.command, .shift])
                .disabled(noBook)
            Divider()
            Button("Show Player") { showPlayer?() }
                .keyboardShortcut("p", modifiers: [.command, .option])
                .disabled(noBook || showPlayer == nil)
        }
    }

    private var noBook: Bool {
        model.activeBook() == nil
    }

    private func goButton(_ tab: RootTab) -> some View {
        Button(tab.title) { selection?.wrappedValue = tab }
            .disabled(selection == nil)
    }
}
