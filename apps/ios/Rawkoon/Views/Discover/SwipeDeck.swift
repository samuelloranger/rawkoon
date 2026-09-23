import SwiftUI
import UIKit

/// The discover triage deck: up to three stacked posters, swipeable in any
/// direction or worked entirely through the always-visible action bar below.
/// This view owns only local presentation state (the remaining stack, the
/// top card's drag offset) — loading, persistence and navigation are the
/// caller's job via the closures.
struct SwipeDeck: View {
    @Environment(AppModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    let label: String
    /// The primary button's accessibility label — "Add" for an admin
    /// (adds straight to the library), "Request" otherwise (files a
    /// request). The button itself is icon-only, so this is what VoiceOver
    /// announces the role difference through.
    let primaryActionTitle: String
    let onDismiss: (DiscoverDeckItem) -> Void
    let onWatchlist: (DiscoverDeckItem) -> Void
    let onPrimary: (DiscoverDeckItem) -> Void
    let onExhausted: () -> Void
    let onOpen: (DiscoverDeckItem) -> Void

    @State private var items: [DiscoverDeckItem]
    /// The controlled card's live translation — driven 1:1 by the finger during a
    /// drag (no animation), or by an explicit `withAnimation` during a fling.
    @State private var dragOffset: CGSize = .zero
    /// The id of the card that `dragOffset` applies to. Binding the offset to a
    /// specific card (not just "whatever is top") keeps the newly-promoted card
    /// from inheriting the departing card's translation/rotation mid-animation.
    @State private var controlledId: DiscoverDeckItem.ID?
    /// True while the top card is flying off-screen: locks input so a second
    /// gesture can't commit the same or next card mid-exit.
    @State private var isFlinging = false

    private enum Action { case dismiss, primary, watchlist }

    private let maxVisible = 3
    private let horizontalThreshold: CGFloat = 110
    private let verticalThreshold: CGFloat = 100
    private let tapDistance: CGFloat = 10
    /// How far off-screen a flung card travels — well past any device edge.
    private let flingDistance: CGFloat = 900

    init(
        items: [DiscoverDeckItem],
        label: String,
        primaryActionTitle: String,
        onDismiss: @escaping (DiscoverDeckItem) -> Void,
        onWatchlist: @escaping (DiscoverDeckItem) -> Void,
        onPrimary: @escaping (DiscoverDeckItem) -> Void,
        onExhausted: @escaping () -> Void,
        onOpen: @escaping (DiscoverDeckItem) -> Void
    ) {
        _items = State(initialValue: items)
        self.label = label
        self.primaryActionTitle = primaryActionTitle
        self.onDismiss = onDismiss
        self.onWatchlist = onWatchlist
        self.onPrimary = onPrimary
        self.onExhausted = onExhausted
        self.onOpen = onOpen
    }

    /// Poster width cap. Well under the screen so the deck sits in open space
    /// rather than filling edge-to-edge — the page needs room to breathe.
    private let cardMaxWidth: CGFloat = 260

    var body: some View {
        VStack(spacing: 28) {
            ZStack {
                ForEach(Array(visibleItems.enumerated()).reversed(), id: \.element.id) { index, item in
                    card(for: item, stackIndex: index)
                }
            }
            .frame(maxWidth: cardMaxWidth)
            .aspectRatio(2.0 / 3.0, contentMode: .fit)
            .frame(maxWidth: .infinity)
            .padding(.top, 12)

            actionBar
        }
    }

    private var visibleItems: [DiscoverDeckItem] {
        Array(items.prefix(maxVisible))
    }

    @ViewBuilder
    private func card(for item: DiscoverDeckItem, stackIndex: Int) -> some View {
        let isTop = stackIndex == 0
        let depth = CGFloat(stackIndex)
        // Only the card the gesture/fling owns moves — never the card promoted
        // behind it, which would otherwise swing in from the fling offset.
        let live = item.id == controlledId && !reduceMotion ? dragOffset : .zero
        // Cap so a fast fling doesn't over-rotate; a drag never reaches the cap.
        let angle = max(-40, min(40, live.width / 18))

        DeckCardView(item: item, label: label, posterURL: model.absoluteURL(item.posterUrl))
            .overlay {
                if isTop, !reduceMotion {
                    intentOverlay
                }
            }
            // Cards behind sit scaled down and zoom up to full size as they
            // promote — the only "appearing" motion. No slide or fade.
            .scaleEffect(1.0 - depth * 0.05)
            // The top card's live translation is applied without any persistent
            // animation modifier, so it tracks the finger exactly.
            .offset(live)
            .rotationEffect(.degrees(Double(angle)))
            .zIndex(isTop ? 1 : 0)
            .allowsHitTesting(isTop && !isFlinging)
            .contentShape(Rectangle())
            .gesture(dragGesture(for: item))
            // A newly-revealed card at the back must NOT fade/scale in on its own
            // — the only motion when the stack advances is the promoting card's
            // zoom. `.identity` cancels SwiftUI's default insertion transition.
            .transition(.identity)
    }

    /// A Tinder-style directional stamp that fades in with the drag: the action
    /// the current swipe would commit, tinted and iconned. Purely presentational.
    private var intentOverlay: some View {
        let style = intentStyle()
        return RoundedRectangle(cornerRadius: 16)
            .strokeBorder(style.tint, lineWidth: 3)
            .background(RoundedRectangle(cornerRadius: 16).fill(style.tint.opacity(0.14)))
            .overlay {
                Image(systemName: style.icon)
                    .font(.system(size: 46, weight: .heavy))
                    .foregroundStyle(style.tint)
                    .shadow(color: .black.opacity(0.4), radius: 6)
            }
            .opacity(Double(style.progress))
            .allowsHitTesting(false)
    }

    private struct IntentStyle {
        let tint: Color
        let icon: String
        let progress: CGFloat
    }

    /// Which action the current `dragOffset` leans toward, and how far (0...1).
    private func intentStyle() -> IntentStyle {
        let hProgress = min(1, abs(dragOffset.width) / horizontalThreshold)
        let vProgress = min(1, -dragOffset.height / verticalThreshold)
        if vProgress > hProgress, dragOffset.height < 0 {
            return IntentStyle(tint: Theme.importing, icon: "bookmark.fill", progress: vProgress)
        }
        if dragOffset.width >= 0 {
            return IntentStyle(tint: Theme.apricot, icon: "paperplane.fill", progress: hProgress)
        }
        return IntentStyle(tint: Theme.terracotta, icon: "xmark", progress: hProgress)
    }

    private func dragGesture(for item: DiscoverDeckItem) -> some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { value in
                guard !reduceMotion, !isFlinging else { return }
                controlledId = item.id
                dragOffset = value.translation
            }
            .onEnded { value in
                guard !isFlinging else { return }
                let translation = value.translation
                let distance = hypot(translation.width, translation.height)

                guard distance > tapDistance else {
                    springBack()
                    onOpen(item)
                    return
                }

                // Decide from the predicted end point so a fast flick commits even
                // over a short distance, the way a real card toss does.
                if let action = committedAction(for: value.predictedEndTranslation) {
                    flingAway(action, item: item, toward: value.predictedEndTranslation)
                } else {
                    springBack()
                }
            }
    }

    /// The action a swipe toward `predicted` would commit, or nil if it's under
    /// every threshold (springs back). Up-dominant = watchlist; right = primary;
    /// left = dismiss.
    private func committedAction(for predicted: CGSize) -> Action? {
        if predicted.height < -verticalThreshold, abs(predicted.height) > abs(predicted.width) {
            return .watchlist
        }
        if predicted.width > horizontalThreshold {
            return .primary
        }
        if predicted.width < -horizontalThreshold {
            return .dismiss
        }
        return nil
    }

    private func springBack() {
        guard !reduceMotion else { return }
        withAnimation(RawkoonMotion.snappy) { dragOffset = .zero } completion: {
            controlledId = nil
        }
    }

    /// Fling the top card off-screen along `toward`, then remove it and rise the
    /// stack. Under Reduce Motion it removes instantly with a short crossfade.
    private func flingAway(_ action: Action, item: DiscoverDeckItem, toward: CGSize) {
        guard !isFlinging else { return }

        UIImpactFeedbackGenerator(style: action == .dismiss ? .rigid : .medium).impactOccurred()

        guard !reduceMotion else {
            withAnimation(RawkoonMotion.reduced) { performRemoval(action, item: item) }
            return
        }

        isFlinging = true
        controlledId = item.id
        withAnimation(RawkoonMotion.deckFling) {
            dragOffset = flingTarget(toward: toward)
        } completion: {
            // Remove (animating only the stack's scale promotion). The offset
            // belonged to the now-removed card, so clearing it can't affect the
            // promoted card — its `live` is already .zero (id != controlledId).
            withAnimation(RawkoonMotion.snappy) { performRemoval(action, item: item) }
            withTransaction(Transaction(animation: nil)) {
                dragOffset = .zero
                controlledId = nil
            }
            isFlinging = false
        }
    }

    /// Scale a direction vector so the card exits well past the screen edge.
    private func flingTarget(toward: CGSize) -> CGSize {
        let magnitude = max(hypot(toward.width, toward.height), 1)
        let scale = flingDistance / magnitude
        return CGSize(width: toward.width * scale, height: toward.height * scale)
    }

    private var actionBar: some View {
        GlassEffectContainer(spacing: 28) {
            HStack(spacing: 28) {
                actionButton(system: "xmark", label: "Not interested", filled: false) {
                    actOnTop(.dismiss)
                }
                actionButton(system: "paperplane.fill", label: LocalizedStringKey(primaryActionTitle), filled: true) {
                    actOnTop(.primary)
                }
                actionButton(system: "bookmark", label: "Watchlist", filled: false) {
                    actOnTop(.watchlist)
                }
            }
        }
    }

    private func actionButton(
        system: String, label: LocalizedStringKey, filled: Bool, action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: system)
                .font(.system(size: filled ? 22 : 18, weight: .semibold))
                .foregroundStyle(filled ? Theme.onAccent : Theme.text)
                .frame(width: 52, height: 52)
                .glassEffect(.regular.tint(filled ? Theme.apricot : nil).interactive(), in: .circle)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .disabled(items.isEmpty)
    }

    private func actOnTop(_ action: Action) {
        guard let item = items.first, !isFlinging else { return }
        // Send the card off in the direction that matches the action.
        let toward = switch action {
        case .dismiss: CGSize(width: -1, height: -0.15)
        case .primary: CGSize(width: 1, height: -0.15)
        case .watchlist: CGSize(width: 0, height: -1)
        }
        flingAway(action, item: item, toward: toward)
    }

    /// Remove the top item and fire the caller's action closure. Runs from the
    /// fling completion (or immediately under Reduce Motion); the haptic fires in
    /// `flingAway` at commit time, not here.
    private func performRemoval(_ action: Action, item: DiscoverDeckItem) {
        guard let index = items.firstIndex(of: item) else { return }
        items.remove(at: index)

        switch action {
        case .dismiss: onDismiss(item)
        case .primary: onPrimary(item)
        case .watchlist: onWatchlist(item)
        }

        if items.isEmpty {
            onExhausted()
        }
    }
}
