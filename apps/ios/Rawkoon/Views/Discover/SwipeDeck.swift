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
    @State private var dragOffset: CGSize = .zero

    private enum Action { case dismiss, primary, watchlist }

    private let maxVisible = 3
    private let horizontalThreshold: CGFloat = 120
    private let verticalThreshold: CGFloat = 100
    private let tapDistance: CGFloat = 10

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

    var body: some View {
        VStack(spacing: 24) {
            ZStack {
                ForEach(Array(visibleItems.enumerated()).reversed(), id: \.element.id) { index, item in
                    card(for: item, stackIndex: index)
                }
            }
            .frame(maxWidth: .infinity)
            .aspectRatio(2.0 / 3.0, contentMode: .fit)
            .padding(.horizontal, 24)

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

        DeckCardView(item: item, label: label, posterURL: model.absoluteURL(item.posterUrl))
            .scaleEffect(1.0 - depth * 0.05)
            .offset(y: depth * 10)
            .opacity(1.0 - depth * 0.25)
            .offset(isTop && !reduceMotion ? dragOffset : .zero)
            .rotationEffect(isTop && !reduceMotion ? .degrees(Double(dragOffset.width / 20)) : .zero)
            .zIndex(isTop ? 1 : 0)
            .allowsHitTesting(isTop)
            .contentShape(Rectangle())
            .gesture(dragGesture(for: item))
            .rawkoonMotion(RawkoonMotion.spring, value: dragOffset)
    }

    private func dragGesture(for item: DiscoverDeckItem) -> some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { value in
                guard !reduceMotion else { return }
                dragOffset = value.translation
            }
            .onEnded { value in
                let translation = value.translation
                let distance = hypot(translation.width, translation.height)
                dragOffset = .zero

                guard distance > tapDistance else {
                    onOpen(item)
                    return
                }

                if translation.height < -verticalThreshold, abs(translation.height) > abs(translation.width) {
                    perform(.watchlist, item: item)
                } else if translation.width > horizontalThreshold {
                    perform(.primary, item: item)
                } else if translation.width < -horizontalThreshold {
                    perform(.dismiss, item: item)
                }
                // else: under every threshold — springs back via rawkoonMotion above.
            }
    }

    private var actionBar: some View {
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

    private func actionButton(
        system: String, label: LocalizedStringKey, filled: Bool, action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: system)
                .font(.system(size: filled ? 22 : 18, weight: .semibold))
                .foregroundStyle(filled ? Theme.onAccent : Theme.text)
                .frame(width: 52, height: 52)
                .background(filled ? AnyShapeStyle(Theme.apricot) : AnyShapeStyle(Theme.raised), in: Circle())
                .overlay(Circle().strokeBorder(Theme.border, lineWidth: filled ? 0 : 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .disabled(items.isEmpty)
    }

    private func actOnTop(_ action: Action) {
        guard let item = items.first else { return }
        perform(action, item: item)
    }

    private func perform(_ action: Action, item: DiscoverDeckItem) {
        guard let index = items.firstIndex(of: item) else { return }
        items.remove(at: index)

        UIImpactFeedbackGenerator(style: action == .dismiss ? .rigid : .medium).impactOccurred()

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
