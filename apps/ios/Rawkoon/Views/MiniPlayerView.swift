import RawkoonKit
import SwiftUI

/// The persistent audio bar; visible only while a book is loaded. Tapping the
/// body expands to the full Now Playing sheet; the trailing buttons toggle
/// play and close the player.
///
/// On iOS 18 it rides above the tab bar via `.safeAreaInset` and draws its own
/// floating-pill chrome. On iOS 26 it's handed to `tabViewBottomAccessory`,
/// which already frames the accessory natively — `chromed: false` there drops
/// this view's own background/shadow so the two don't double-frame each other.
struct MiniPlayerView: View {
    @Environment(AppModel.self) private var model
    let onExpand: () -> Void
    var chromed: Bool = true

    var body: some View {
        if let active = model.activeBook() {
            if chromed {
                row(active)
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
            } else {
                row(active)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 12)
            }
        }
    }

    /// The native `tabViewBottomAccessory` (iOS 26) draws on a light, adaptive
    /// system material, where the app's dark-surface text tokens go unreadable —
    /// so the un-chromed variant uses semantic colors that adapt to it. The
    /// iOS 18 pill keeps the Cozy Dusk tokens against its own dark chrome.
    private var titleColor: Color {
        chromed ? Theme.textStrong : .primary
    }

    private var subtitleColor: Color {
        if model.player.playbackError != nil {
            return Theme.terracotta
        }
        return chromed ? Theme.muted : .secondary
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
                            .foregroundStyle(titleColor)
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
                    .foregroundStyle(chromed ? Theme.muted : .secondary)
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
