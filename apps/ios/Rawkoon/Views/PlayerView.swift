import Foundation
import RawkoonKit
import SwiftUI

struct PlayerView: View {
    @EnvironmentObject private var model: AppModel

    let summary: LibrarySummary
    let manifest: BookManifest

    @State private var sliderPosition: Double = 0
    @State private var isDraggingSlider = false
    @State private var draggingChapterSnapshot: ManifestChapter?

    private let rates: [Double] = [0.8, 1.0, 1.25, 1.5, 2.0]

    var body: some View {
        ZStack {
            // Dusk glow — a bedside lamp behind the cover.
            LinearGradient(
                colors: [Color(hex: 0x2A201B), Theme.base, Theme.well],
                startPoint: .top, endPoint: .bottom
            )
            .ignoresSafeArea()
            Theme.duskGlow.ignoresSafeArea()

            VStack(spacing: 18) {
                Capsule().fill(Theme.apricotSoft.opacity(0.35))
                    .frame(width: 38, height: 5)
                    .padding(.top, 10)

                BookCover(url: summary.coverURL, size: 220, corner: 16)
                    .frame(maxWidth: 220)
                    .shadow(color: .black.opacity(0.6), radius: 24, y: 14)
                    .padding(.top, 8)

                VStack(spacing: 3) {
                    Text(summary.title)
                        .font(.display(20))
                        .foregroundStyle(Theme.textStrong)
                        .multilineTextAlignment(.center)
                        .lineLimit(2)
                    Text(currentChapterTitle)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Theme.apricotSoft)
                        .lineLimit(1)
                }
                .padding(.top, 6)

                scrubber
                transport

                HStack(spacing: 12) {
                    rateMenu
                    sleepMenu
                }
                .padding(.top, 2)

                Spacer(minLength: 0)
            }
            .padding(.horizontal, 24)
        }
        .presentationDetents([.large])
        .onAppear { sliderPosition = model.player.positionSecs }
        .onReceive(model.player.$positionSecs) { position in
            guard !isDraggingSlider else { return }
            sliderPosition = position
        }
    }

    // MARK: Scrubber

    private var scrubber: some View {
        VStack(spacing: 8) {
            if let chapter = scrubberChapterScope {
                Text(chapter.title)
                    .font(.caption)
                    .foregroundStyle(Theme.muted)
                    .frame(maxWidth: .infinity, alignment: .leading)

                Slider(
                    value: $sliderPosition,
                    in: chapter.startSecs...chapter.endSecs,
                    onEditingChanged: scrubChanged
                )
                .tint(Theme.apricot)

                HStack {
                    Text(formatTime(max(sliderPosition - chapter.startSecs, 0)))
                    Spacer()
                    Text("-\(formatTime(max(chapter.endSecs - sliderPosition, 0)))")
                }
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(Theme.muted)

                Text("\(formatTime(sliderPosition)) in / \(formatTime(model.player.duration))")
                    .font(.caption)
                    .foregroundStyle(Theme.muted)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                Slider(
                    value: $sliderPosition,
                    in: 0...max(model.player.duration, 0.1),
                    onEditingChanged: scrubChanged
                )
                .tint(Theme.apricot)

                HStack {
                    Text(formatTime(sliderPosition))
                    Spacer()
                    Text("-\(formatTime(max(model.player.duration - sliderPosition, 0)))")
                }
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(Theme.muted)
            }
        }
        .padding(.top, 6)
    }

    /// SwiftUI can call `onEditingChanged(false)` before the last thumb
    /// write lands on `sliderPosition`. One turn of the run loop lets that
    /// write commit so we seek to where the finger actually was, not where
    /// playback still is. Keep `isDraggingSlider` true across that hop so a
    /// tick cannot overwrite the value first.
    private func scrubChanged(_ editing: Bool) {
        if editing {
            isDraggingSlider = true
            if draggingChapterSnapshot == nil {
                draggingChapterSnapshot = model.player.currentChapter
            }
            return
        }
        DispatchQueue.main.async {
            model.player.seek(to: sliderPosition)
            isDraggingSlider = false
            draggingChapterSnapshot = nil
        }
    }

    // MARK: Transport

    private var transport: some View {
        HStack(spacing: 26) {
            control("backward.end.fill", size: 22, action: model.player.prevChapter)
            control("gobackward.30", size: 24) { model.player.skipBackward(30) }

            Button {
                model.player.isPlaying ? model.player.pause() : model.player.play()
            } label: {
                Image(systemName: model.player.isPlaying ? "pause.fill" : "play.fill")
                    .font(.system(size: 28, weight: .bold))
                    .foregroundStyle(Theme.onAccent)
                    .frame(width: 66, height: 66)
                    .background(Theme.apricot, in: Circle())
                    .shadow(color: Theme.apricot.opacity(0.35), radius: 12, y: 6)
            }
            .buttonStyle(.plain)

            control("goforward.30", size: 24) { model.player.skipForward(30) }
            control("forward.end.fill", size: 22, action: model.player.nextChapter)
        }
        .padding(.top, 6)
    }

    private func control(_ name: String, size: CGFloat, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: name)
                .font(.system(size: size))
                .foregroundStyle(Theme.textStrong)
        }
        .buttonStyle(.plain)
    }

    // MARK: Speed

    private var rateMenu: some View {
        Menu {
            ForEach(rates, id: \.self) { rateValue in
                Button("\(rateLabel(rateValue))×") { model.player.setRate(Float(rateValue)) }
            }
        } label: {
            Label("\(rateLabel(Double(model.player.rate)))×", systemImage: "speedometer")
                .font(.system(.subheadline, design: .monospaced).weight(.medium))
                .foregroundStyle(Theme.textStrong)
                .padding(.horizontal, 14)
                .padding(.vertical, 9)
                .background(Theme.raised.opacity(0.8), in: Capsule())
                .overlay(Capsule().strokeBorder(Theme.borderStrong, lineWidth: 1))
        }
    }

    private var sleepMenu: some View {
        Menu {
            Button("Off") { model.player.setSleep(.off) }
            Button("End of chapter") { model.player.setSleep(.endOfChapter) }
            ForEach([10, 15, 30, 45, 60], id: \.self) { m in
                Button("\(m) min") { model.player.setSleep(.minutes(m)) }
            }
        } label: {
            Label(sleepLabel, systemImage: "moon.zzz.fill")
                .font(.system(.subheadline, design: .monospaced).weight(.medium))
                .foregroundStyle(sleepActive ? Theme.apricot : Theme.textStrong)
                .padding(.horizontal, 14)
                .padding(.vertical, 9)
                .background(Theme.raised.opacity(0.8), in: Capsule())
                .overlay(Capsule().strokeBorder(sleepActive ? Theme.apricot.opacity(0.5) : Theme.borderStrong, lineWidth: 1))
        }
    }

    private var sleepActive: Bool {
        model.player.sleepMode != .off
    }

    private var sleepLabel: String {
        switch model.player.sleepMode {
        case .off:
            return "Sleep"
        case .endOfChapter:
            return "Chapter"
        case .minutes:
            if let remaining = model.player.sleepRemainingSecs {
                let m = Int(remaining) / 60
                let s = Int(remaining) % 60
                return String(format: "%d:%02d", m, s)
            }
            return "Sleep"
        }
    }

    // MARK: Derived

    private var currentChapterTitle: String {
        guard
            let currentIndex = model.player.currentChapterIndex,
            let chapter = manifest.chapters.first(where: { $0.index == currentIndex })
        else {
            return "No chapter loaded"
        }
        return chapter.title
    }

    /// The chapter the scrubber is scoped to, or nil to fall back to a
    /// whole-book slider.
    ///
    /// A zero-length chapter is rejected: `Slider(in:)` divides by the span, so a
    /// degenerate range produces NaN rather than a disabled control.
    private var scrubberChapterScope: ManifestChapter? {
        let chapter = isDraggingSlider ? draggingChapterSnapshot : model.player.currentChapter
        guard let chapter, chapter.endSecs > chapter.startSecs else { return nil }
        return chapter
    }

    private func rateLabel(_ value: Double) -> String {
        let rounded = (value * 100).rounded() / 100
        if abs(rounded.rounded() - rounded) < 0.001 { return String(format: "%.0f", rounded) }
        if abs((rounded * 10).rounded() - (rounded * 10)) < 0.001 { return String(format: "%.1f", rounded) }
        return String(format: "%.2f", rounded)
    }

    private func formatTime(_ seconds: Double) -> String {
        guard seconds.isFinite, seconds > 0 else { return "0:00" }
        let total = Int(seconds.rounded())
        let hours = total / 3600
        let minutes = (total % 3600) / 60
        let secs = total % 60
        if hours > 0 { return String(format: "%d:%02d:%02d", hours, minutes, secs) }
        return String(format: "%d:%02d", minutes, secs)
    }
}
