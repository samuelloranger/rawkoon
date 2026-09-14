import RawkoonKit
import SwiftUI

/// The persistent audio bar; visible only while a book is loaded. Tapping the
/// body expands to the full Now Playing sheet; the trailing buttons toggle
/// play and close the player.
///
/// It's handed to `tabViewBottomAccessory`, which frames the accessory natively,
/// so this view draws no background of its own and uses semantic colors that
/// adapt to the system material.
struct MiniPlayerView: View {
    /// Passed explicitly rather than read from `@Environment`: the
    /// `tabViewBottomAccessory` host does not propagate the window's environment
    /// into the accessory, so an `@Environment(AppModel.self)` read there traps on
    /// the missing value. An `@Observable` reference held as a plain property still
    /// tracks its reads in `body`, so reactivity is unchanged.
    let model: AppModel
    let onExpand: () -> Void

    var body: some View {
        if let active = model.activeBook() {
            row(active)
                .padding(.horizontal, 10)
                .padding(.vertical, 12)
        }
    }

    private var subtitleColor: Color {
        model.player.playbackError != nil ? Theme.terracotta : .secondary
    }

    @ViewBuilder
    private func row(_ active: (summary: LibrarySummary, manifest: BookManifest)) -> some View {
        HStack(spacing: 10) {
            Button(action: onExpand) {
                HStack(spacing: 10) {
                    BookCover(url: active.summary.coverURL, size: 38, corner: 9)

                    VStack(alignment: .leading, spacing: 1) {
                        Text(active.summary.title)
                            .font(.display(14))
                            .foregroundStyle(Color.primary)
                            .lineLimit(1)
                        Text(chapterLine(active.manifest))
                            .font(.caption2)
                            .foregroundStyle(subtitleColor)
                            .lineLimit(2)
                    }

                    Spacer(minLength: 8)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Now Playing")
            .accessibilityHint("Opens the full player")

            Button {
                model.player.isPlaying ? model.player.pause() : model.player.play()
            } label: {
                Image(systemName: model.player.isPlaying ? "pause.fill" : "play.fill")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(Theme.onAccent)
                    .frame(width: 44, height: 44)
                    .background(Theme.apricot, in: Circle())
                    .breathingLamp(active: model.player.isPlaying)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(LocalizedStringKey(model.player.isPlaying ? "Pause" : "Play")))

            Button {
                model.closePlayer()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Color.secondary)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Close player")
        }
    }

    private func chapterLine(_ manifest: BookManifest) -> String {
        if let error = model.player.playbackError {
            return error
        }
        guard
            let index = model.player.currentChapterIndex,
            let chapter = manifest.chapters.first(where: { $0.index == index })
        else {
            return "Audiobook"
        }
        return chapter.title
    }
}
