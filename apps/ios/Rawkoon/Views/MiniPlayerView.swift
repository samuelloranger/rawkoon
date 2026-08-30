import RawkoonKit
import SwiftUI

/// The persistent audio bar. Rides above the tab bar on every tab via
/// `.safeAreaInset`; visible only while a book is loaded. Tapping the body
/// expands to the full Now Playing sheet; the trailing button toggles play.
struct MiniPlayerView: View {
    @EnvironmentObject private var model: AppModel
    let onExpand: () -> Void

    var body: some View {
        if let active = model.activeBook() {
            Button(action: onExpand) {
                HStack(spacing: 10) {
                    BookCover(url: active.summary.coverURL, size: 38, corner: 9)

                    VStack(alignment: .leading, spacing: 1) {
                        Text(active.summary.title)
                            .font(.display(14))
                            .foregroundStyle(Theme.textStrong)
                            .lineLimit(1)
                        Text(chapterLine(active.manifest))
                            .font(.caption2)
                            .foregroundStyle(Theme.muted)
                            .lineLimit(1)
                    }

                    Spacer(minLength: 8)

                    Button {
                        model.player.isPlaying ? model.player.pause() : model.player.play()
                    } label: {
                        Image(systemName: model.player.isPlaying ? "pause.fill" : "play.fill")
                            .font(.system(size: 15, weight: .bold))
                            .foregroundStyle(Theme.onAccent)
                            .frame(width: 30, height: 30)
                            .background(Theme.apricot, in: Circle())
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 7)
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 18))
                .overlay(
                    RoundedRectangle(cornerRadius: 18)
                        .strokeBorder(Theme.apricot.opacity(0.22), lineWidth: 1)
                )
                .background(
                    // Warm tint under the glass so it reads as a lit-from-within bar.
                    RoundedRectangle(cornerRadius: 18)
                        .fill(Theme.terracotta.opacity(0.18))
                )
                .shadow(color: .black.opacity(0.4), radius: 10, y: 4)
                .padding(.horizontal, 12)
                .padding(.bottom, 4)
            }
            .buttonStyle(.plain)
        }
    }

    private func chapterLine(_ manifest: BookManifest) -> String {
        guard
            let index = model.player.currentChapterIndex,
            let chapter = manifest.chapters.first(where: { $0.index == index })
        else {
            return "Audiobook"
        }
        return chapter.title
    }
}
