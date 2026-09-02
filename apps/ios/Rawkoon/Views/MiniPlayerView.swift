import RawkoonKit
import SwiftUI

/// The persistent audio bar. Rides above the tab bar on every tab via
/// `.safeAreaInset`; visible only while a book is loaded. Tapping the body
/// expands to the full Now Playing sheet; the trailing buttons toggle play and
/// close the player.
struct MiniPlayerView: View {
    @Environment(AppModel.self) private var model
    let onExpand: () -> Void

    var body: some View {
        if let active = model.activeBook() {
            HStack(spacing: 10) {
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
                                .foregroundStyle(
                                    model.player.playbackError == nil ? Theme.muted : Theme.terracotta
                                )
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
                }
                .buttonStyle(.plain)
                .accessibilityLabel(model.player.isPlaying ? "Pause" : "Play")

                Button {
                    model.closePlayer()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Theme.muted)
                        .frame(width: 34, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Close player")
            }
            .padding(.leading, 10)
            .padding(.trailing, 4)
            .padding(.vertical, 7)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 18))
            .overlay(
                RoundedRectangle(cornerRadius: 18)
                    .strokeBorder(Theme.borderStrong, lineWidth: 1)
            )
            .background(
                RoundedRectangle(cornerRadius: 18)
                    .fill(Theme.terracotta.opacity(0.18))
            )
            .shadow(color: .black.opacity(0.4), radius: 10, y: 4)
            .padding(.horizontal, 12)
            .padding(.bottom, 4)
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
