import Foundation
import RawkoonKit
import SwiftUI

struct PlayerView: View {
    @Environment(AppModel.self) var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    let summary: LibrarySummary
    let manifest: BookManifest

    @State var sliderPosition: Double = 0
    @State var isDraggingSlider = false
    @State var draggingChapterSnapshot: ManifestChapter?
    @State private var showingChapters = false
    @State private var findingPlace = false
    @State private var handoffDocument: EbookPreviewDocument?
    @State private var handoffTask: Task<Void, Never>?

    let rates: [Double] = [0.8, 1.0, 1.25, 1.5, 2.0]

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
        .sheetGrabber()
        .presentationBackground(Theme.base)
        .rawkoonZoomDestination(RawkoonZoom.audiobook(editionId: summary.editionId))
        .sensoryFeedback(RawkoonHaptics.feedback(for: .playPause), trigger: model.player.isPlaying)
        .sensoryFeedback(RawkoonHaptics.feedback(for: .chapterSkip), trigger: model.player.currentChapterIndex)
        .alert(
            "Couldn't play chapter",
            isPresented: Binding(
                get: { model.player.playbackError != nil },
                set: {
                    if !$0 {
                        model.player.clearPlaybackError()
                    }
                }
            )
        ) {
            Button("OK", role: .cancel) { model.player.clearPlaybackError() }
        } message: {
            if let message = model.player.playbackError {
                Text(message)
            }
        }
        .onAppear { sliderPosition = model.player.positionSecs }
        // A request still in flight must not pause audio or open a reader after the player is gone.
        .onDisappear { handoffTask?.cancel() }
        .onChange(of: model.player.positionSecs) { _, position in
            guard !isDraggingSlider else { return }
            sliderPosition = position
        }
        .sheet(item: $handoffDocument) { document in
            EbookReaderSheet(document: document)
                .environment(model)
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
            .sheetGrabber()
        }
    }

    // MARK: Content

    private var playbackStack: some View {
        VStack(spacing: 16) {
            BookCover(url: summary.coverURL, size: 220, corner: 16)
                .frame(maxWidth: 220)
                .shadow(color: .black.opacity(0.6), radius: 24, y: 14)
                // Purely visual: the cover sits back while paused and springs forward on play.
                .scaleEffect(PlayerMotion.artworkScale(
                    isPlaying: model.player.isPlaying, reduceMotion: reduceMotion
                ))
                .rawkoonMotion(RawkoonMotion.spring, value: model.player.isPlaying)
                .accessibilityHidden(true)

            VStack(spacing: 4) {
                Text(summary.title)
                    .font(.display(20))
                    .foregroundStyle(Theme.textStrong)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                // One slot keyed by chapter, so a new chapter's title rolls up as the old one fades.
                ZStack {
                    Text(currentChapterTitle)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(hasChapter ? Theme.apricotSoft : Theme.muted)
                        .lineLimit(1)
                        .id(model.player.currentChapterIndex)
                        .transition(.rawkoonSlide(.bottom))
                }
                .rawkoonMotion(RawkoonMotion.spring, value: model.player.currentChapterIndex)

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

            GlassEffectContainer(spacing: 12) {
                HStack(spacing: 12) {
                    rateMenu
                    sleepMenu
                    routeButton
                }
            }
            .padding(.top, 8)

            readFromHereButton
        }
    }

    // MARK: Read from here

    /// Only for a book that also has an ebook, and only online: the match runs on the server.
    @ViewBuilder private var readFromHereButton: some View {
        if model.isOnline, model.library.first(where: { $0.bookId == summary.bookId })?.hasEbook == true {
            Button(action: readFromHere) {
                HStack(spacing: 8) {
                    if findingPlace {
                        ProgressView().tint(Theme.textStrong)
                        Text("Finding your place…")
                    } else {
                        Image(systemName: "book")
                        Text("Read from here")
                    }
                }
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Theme.textStrong)
                .padding(.horizontal, 18)
                .frame(minHeight: 44)
                .glassEffect(.regular.interactive(), in: .capsule)
            }
            .buttonStyle(.plain)
            .disabled(findingPlace)
            .accessibilityHint("Opens the ebook at this spot in the story")
        }
    }

    private func readFromHere() {
        guard !findingPlace else { return }
        findingPlace = true
        // Paused first so the position sent is the one the reader lands on.
        let wasPlaying = model.player.isPlaying
        model.player.pause()
        let positionSecs = model.player.positionSecs
        handoffTask = Task {
            let document = await model.readFromHere(
                bookId: summary.bookId,
                title: summary.title,
                positionSecs: positionSecs
            )
            findingPlace = false
            if let document {
                handoffDocument = document
            } else if wasPlaying, model.activeBook() != nil {
                model.player.play()
            }
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
            .glassEffect(.regular.interactive(), in: .circle)
            .contentShape(Circle())
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
            return String(localized: "No chapter loaded")
        }
        return chapter.title
    }
}
