import Foundation
import RawkoonKit
import SwiftUI

struct PlayerView: View {
    @EnvironmentObject private var model: AppModel

    let summary: LibrarySummary
    let manifest: BookManifest

    @State private var sliderPosition: Double = 0
    @State private var isDraggingSlider = false

    private let rates: [Double] = [0.8, 1.0, 1.25, 1.5, 2.0]

    var body: some View {
        VStack(spacing: 18) {
            AsyncImage(url: summary.coverURL) { image in
                image.resizable().scaledToFit()
            } placeholder: {
                RoundedRectangle(cornerRadius: 12)
                    .fill(.gray.opacity(0.15))
            }
            .frame(maxWidth: 220, maxHeight: 220)
            .clipShape(RoundedRectangle(cornerRadius: 12))

            Text(summary.title)
                .font(.headline)
                .multilineTextAlignment(.center)
                .lineLimit(2)

            Text(currentChapterTitle)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .lineLimit(1)

            Slider(
                value: Binding(
                    get: { isDraggingSlider ? sliderPosition : model.player.positionSecs },
                    set: { sliderPosition = $0 }
                ),
                in: 0...max(model.player.duration, 0.1),
                onEditingChanged: { editing in
                    isDraggingSlider = editing
                    if !editing {
                        model.player.seek(to: sliderPosition)
                    }
                }
            )

            HStack {
                Text(formatTime(model.player.positionSecs))
                Spacer()
                Text("-\(formatTime(max(model.player.duration - model.player.positionSecs, 0)))")
            }
            .font(.caption.monospacedDigit())
            .foregroundStyle(.secondary)

            HStack(spacing: 26) {
                Button(action: model.player.prevChapter) {
                    Image(systemName: "backward.end.fill")
                        .font(.title3)
                }
                Button { model.player.skipBackward(30) } label: {
                    Image(systemName: "gobackward.30")
                        .font(.title3)
                }
                Button {
                    model.player.isPlaying ? model.player.pause() : model.player.play()
                } label: {
                    Image(systemName: model.player.isPlaying ? "pause.circle.fill" : "play.circle.fill")
                        .font(.system(size: 44))
                }
                Button { model.player.skipForward(30) } label: {
                    Image(systemName: "goforward.30")
                        .font(.title3)
                }
                Button(action: model.player.nextChapter) {
                    Image(systemName: "forward.end.fill")
                        .font(.title3)
                }
            }
            .buttonStyle(.plain)

            Menu {
                ForEach(rates, id: \.self) { rateValue in
                    Button("\(rateLabel(rateValue))x") {
                        model.player.setRate(Float(rateValue))
                    }
                }
            } label: {
                Text("Rate: \(rateLabel(Double(model.player.rate)))x")
                    .font(.subheadline.weight(.medium))
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(Capsule().fill(.secondary.opacity(0.15)))
            }

            Text(currentChapterLabel)
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .padding()
        .onAppear {
            sliderPosition = model.player.positionSecs
        }
        .onReceive(model.player.$positionSecs) { position in
            guard !isDraggingSlider else { return }
            sliderPosition = position
        }
    }

    private var currentChapterTitle: String {
        guard
            let currentIndex = model.player.currentChapterIndex,
            let chapter = manifest.chapters.first(where: { $0.index == currentIndex })
        else {
            return "No chapter loaded"
        }
        return chapter.title
    }

    private var currentChapterLabel: String {
        guard let currentIndex = model.player.currentChapterIndex else {
            return "Chapter --"
        }
        return "Chapter \(currentIndex + 1)"
    }

    private func rateLabel(_ value: Double) -> String {
        let rounded = (value * 100).rounded() / 100
        if abs(rounded.rounded() - rounded) < 0.001 {
            return String(format: "%.0f", rounded)
        }
        if abs((rounded * 10).rounded() - (rounded * 10)) < 0.001 {
            return String(format: "%.1f", rounded)
        }
        return String(format: "%.2f", rounded)
    }

    private func formatTime(_ seconds: Double) -> String {
        guard seconds.isFinite, seconds > 0 else { return "0:00" }
        let total = Int(seconds.rounded())
        let hours = total / 3600
        let minutes = (total % 3600) / 60
        let secs = total % 60
        if hours > 0 {
            return String(format: "%d:%02d:%02d", hours, minutes, secs)
        }
        return String(format: "%d:%02d", minutes, secs)
    }
}
