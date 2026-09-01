import AVKit
import Foundation
import RawkoonKit
import SwiftUI

struct PlayerView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss

    let summary: LibrarySummary
    let manifest: BookManifest

    @State private var sliderPosition: Double = 0
    @State private var isDraggingSlider = false
    @State private var draggingChapterSnapshot: ManifestChapter?
    @State private var showingChapters = false

    private let rates: [Double] = [0.8, 1.0, 1.25, 1.5, 2.0]

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [Theme.raised, Theme.base, Theme.well],
                startPoint: .top, endPoint: .bottom
            )
            .ignoresSafeArea()
            Theme.duskGlow.ignoresSafeArea()

            VStack(spacing: 0) {
                header

                // The sheet is always full-height, and the controls are a
                // fixed-height stack, so without the pair of spacers
                // everything pinned itself to the top and left a dead half
                // screen underneath.
                Spacer(minLength: 0)

                playbackStack

                Spacer(minLength: 0)
            }
            .padding(.horizontal, 24)
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .presentationBackground(Theme.base)
        .onAppear { sliderPosition = model.player.positionSecs }
        .onReceive(model.player.$positionSecs) { position in
            guard !isDraggingSlider else { return }
            sliderPosition = position
        }
        .sheet(isPresented: $showingChapters) {
            NavigationStack {
                List {
                    ForEach(manifest.chapters, id: \.index) { chapter in
                        Button {
                            model.player.jumpToChapter(chapter)
                            showingChapters = false
                        } label: {
                            SpineRow(
                                index: chapter.index,
                                title: chapter.title,
                                downloaded: true,
                                current: model.player.currentChapterIndex == chapter.index
                            )
                            .frame(minHeight: 44)
                        }
                        .listRowBackground(Theme.raised)
                    }
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
                .background(Theme.base)
                .navigationTitle("Chapters")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Done") { showingChapters = false }
                    }
                }
            }
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
        }
    }

    // MARK: Content

    private var playbackStack: some View {
        VStack(spacing: 16) {
            BookCover(url: summary.coverURL, size: 220, corner: 16)
                .frame(maxWidth: 220)
                .shadow(color: .black.opacity(0.6), radius: 24, y: 14)
                .accessibilityHidden(true)

            VStack(spacing: 4) {
                Text(summary.title)
                    .font(.display(20))
                    .foregroundStyle(Theme.textStrong)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                Text(currentChapterTitle)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(hasChapter ? Theme.apricotSoft : Theme.muted)
                    .lineLimit(1)

                if !manifest.chapters.isEmpty {
                    Button {
                        showingChapters = true
                    } label: {
                        Label("Chapters", systemImage: "list.bullet")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(Theme.muted)
                            .frame(minHeight: 44)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Choose chapter")
                }
            }
            .padding(.top, 8)
            .accessibilityElement(children: .combine)

            scrubber
            transport

            HStack(spacing: 12) {
                rateMenu
                sleepMenu
                routeButton
            }
            .padding(.top, 8)
        }
    }

    // MARK: Header

    /// Chevron collapses the sheet back to the mini player; the cross stops
    /// playback outright and dismisses both.
    private var header: some View {
        HStack {
            Button { dismiss() } label: {
                headerIcon("chevron.down")
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Collapse player")

            Spacer()

            Button {
                model.closePlayer()
                dismiss()
            } label: {
                headerIcon("xmark")
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Stop playback and close")
        }
        .padding(.top, 8)
    }

    private func headerIcon(_ name: String) -> some View {
        Image(systemName: name)
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(Theme.textStrong)
            .frame(width: 44, height: 44)
            .background(Theme.raised.opacity(0.8), in: Circle())
            .contentShape(Circle())
    }

    // MARK: Scrubber

    private var scrubber: some View {
        VStack(spacing: 8) {
            if let chapter = scrubberChapterScope {
                Slider(
                    value: $sliderPosition,
                    in: chapter.startSecs...chapter.endSecs,
                    onEditingChanged: scrubChanged
                )
                .tint(Theme.apricot)
                .accessibilityLabel("Position in chapter")
                .accessibilityValue(formatTime(max(sliderPosition - chapter.startSecs, 0)))

                HStack {
                    Text(formatTime(max(sliderPosition - chapter.startSecs, 0)))
                    Spacer()
                    Text("−\(formatTime(max(chapter.endSecs - sliderPosition, 0)))")
                }
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(Theme.muted)
                .accessibilityHidden(true)

                Text("\(formatTime(sliderPosition)) of \(formatTime(model.player.duration))")
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(Theme.faint)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityLabel("Book position")
                    .accessibilityValue("\(formatTime(sliderPosition)) of \(formatTime(model.player.duration))")
            } else {
                Slider(
                    value: $sliderPosition,
                    in: 0...max(model.player.duration, 0.1),
                    onEditingChanged: scrubChanged
                )
                .tint(Theme.apricot)
                .accessibilityLabel("Position in book")
                .accessibilityValue(formatTime(sliderPosition))

                HStack {
                    Text(formatTime(sliderPosition))
                    Spacer()
                    Text("−\(formatTime(max(model.player.duration - sliderPosition, 0)))")
                }
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(Theme.muted)
                .accessibilityHidden(true)
            }
        }
        .padding(.top, 8)
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
        HStack(spacing: 24) {
            control("backward.end.fill", label: "Previous chapter", action: model.player.prevChapter)
            control("gobackward.30", label: "Skip back 30 seconds") { model.player.skipBackward(30) }

            Button {
                model.player.isPlaying ? model.player.pause() : model.player.play()
            } label: {
                Image(systemName: model.player.isPlaying ? "pause.fill" : "play.fill")
                    .font(.system(size: 28, weight: .bold))
                    .foregroundStyle(Theme.onAccent)
                    .frame(width: 66, height: 66)
            }
            .buttonStyle(PlayFillStyle())
            .shadow(color: Theme.apricot.opacity(0.35), radius: 12, y: 6)
            .accessibilityLabel(model.player.isPlaying ? "Pause" : "Play")

            control("goforward.30", label: "Skip forward 30 seconds") { model.player.skipForward(30) }
            control("forward.end.fill", label: "Next chapter", action: model.player.nextChapter)
        }
        .padding(.top, 8)
    }

    private func control(_ name: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: name)
                .font(.system(size: 22))
                .foregroundStyle(Theme.textStrong)
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    // MARK: Speed

    private var rateMenu: some View {
        Menu {
            ForEach(rates, id: \.self) { rateValue in
                Button("\(rateLabel(rateValue))×") { model.player.setRate(Float(rateValue)) }
            }
        } label: {
            chip(
                title: "\(rateLabel(Double(model.player.rate)))×",
                systemImage: "speedometer",
                emphasized: false
            )
        }
        .accessibilityLabel("Playback speed")
        .accessibilityValue("\(rateLabel(Double(model.player.rate)))×")
    }

    private var sleepMenu: some View {
        Menu {
            Button("Off") { model.player.setSleep(.off) }
            Button("End of chapter") { model.player.setSleep(.endOfChapter) }
            ForEach([10, 15, 30, 45, 60], id: \.self) { m in
                Button("\(m) min") { model.player.setSleep(.minutes(m)) }
            }
        } label: {
            chip(title: sleepLabel, systemImage: "moon.zzz.fill", emphasized: sleepActive)
        }
        .accessibilityLabel("Sleep timer")
        .accessibilityValue(sleepLabel)
    }

    /// AirPlay, in the player rather than only in Control Center — moving a
    /// book to a HomePod or the car should not mean leaving the app.
    private var routeButton: some View {
        RoutePicker()
            .frame(width: 44, height: 40)
            .background(Theme.raised.opacity(0.8), in: Capsule())
            .overlay(Capsule().strokeBorder(Theme.borderStrong, lineWidth: 1))
    }

    private func chip(title: String, systemImage: String, emphasized: Bool) -> some View {
        Label(title, systemImage: systemImage)
            .font(.system(.subheadline, design: .monospaced).weight(.medium))
            .foregroundStyle(emphasized ? Theme.apricot : Theme.textStrong)
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
            .background(Theme.raised.opacity(0.8), in: Capsule())
            .overlay(
                Capsule().strokeBorder(
                    emphasized ? Theme.apricot.opacity(0.5) : Theme.borderStrong,
                    lineWidth: 1
                )
            )
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

    private var hasChapter: Bool {
        model.player.currentChapterIndex != nil
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

/// `AVRoutePickerView` has no SwiftUI equivalent.
private struct RoutePicker: UIViewRepresentable {
    func makeUIView(context: Context) -> AVRoutePickerView {
        let view = AVRoutePickerView()
        // AVRoutePickerView is already an accessible button and names itself,
        // so a SwiftUI label on the wrapper would have VoiceOver say it twice.
        // Audio only, so the picker should not rank AirPlay displays first.
        view.prioritizesVideoDevices = false
        view.tintColor = UIColor(Theme.textStrong)
        view.activeTintColor = UIColor(Theme.apricot)
        view.backgroundColor = .clear
        return view
    }

    func updateUIView(_ uiView: AVRoutePickerView, context: Context) {}
}

/// Apricot at rest, terracotta when pressed — the lamp, then the ember.
private struct PlayFillStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(
                configuration.isPressed ? Theme.terracotta : Theme.apricot,
                in: Circle()
            )
    }
}
