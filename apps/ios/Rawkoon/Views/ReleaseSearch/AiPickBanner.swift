import RawkoonKit
import SwiftUI

/// AI-picks banner: mirrors the web `AiPickBanner`. State lives in
/// `ReleaseSearchView`; this view renders it and reports actions back through
/// the closures (retry, grab, dismiss) so the parent stays the single owner.
/// One shell stays mounted across its faces, so a state change morphs it instead of cutting.
struct AiPickBanner: View {
    @Environment(AppModel.self) private var model

    let aiPickLoading: Bool
    let aiPickError: String?
    let aiPickBudgetReached: Bool
    let aiPickedRelease: ReleaseItem?
    let aiPickGrabbed: Bool
    let aiPick: AiPick?
    let grabbingGuid: String?
    let onRetry: () async -> Void
    let onGrab: (ReleaseItem) async -> Void
    let onDismiss: () -> Void

    /// The banner's faces, in the precedence the parent's state implies.
    nonisolated enum Phase: Equatable {
        case hidden, loading, budgetReached, failed, picked, grabbed
    }

    nonisolated static func phase(
        loading: Bool,
        budgetReached: Bool,
        failed: Bool,
        hasRelease: Bool,
        grabbed: Bool
    ) -> Phase {
        if loading {
            return .loading
        }
        if budgetReached {
            return .budgetReached
        }
        if failed {
            return .failed
        }
        guard hasRelease else { return .hidden }
        return grabbed ? .grabbed : .picked
    }

    private var phase: Phase {
        Self.phase(
            loading: aiPickLoading,
            budgetReached: aiPickBudgetReached,
            failed: aiPickError != nil,
            hasRelease: aiPickedRelease != nil,
            grabbed: aiPickGrabbed
        )
    }

    var body: some View {
        VStack(spacing: 0) {
            if phase != .hidden {
                aiPickBannerShell(isError: phase == .failed) {
                    // One slot, so faces crossfade while the shell resizes around them.
                    ZStack(alignment: .topLeading) {
                        face
                    }
                }
                // Visual only: the sheet plays the grab haptic once for every confirmed grab.
                .rawkoonCelebrate(
                    trigger: aiPickGrabbed,
                    ring: .roundedRect(cornerRadius: 12),
                    haptic: nil,
                    when: { !$0 && $1 }
                )
                .padding(.horizontal, 16)
                .padding(.bottom, 10)
                .transition(.rawkoonReveal)
            }
        }
        .rawkoonMotion(RawkoonMotion.spring, value: phase)
    }

    @ViewBuilder
    private var face: some View {
        switch phase {
        case .hidden:
            EmptyView()
        case .loading:
            HStack(spacing: 8) {
                Image(systemName: "sparkles")
                    .font(.caption)
                    .foregroundStyle(Theme.apricot)
                Text("AI is picking the best release…")
                    .font(.subheadline)
                    .foregroundStyle(Theme.muted)
            }
            .transition(.rawkoonSwap)
        case .budgetReached:
            HStack(spacing: 8) {
                Image(systemName: "sparkles")
                    .font(.caption)
                    .foregroundStyle(Theme.muted)
                Text("AI daily budget reached \u{2014} showing the classic pick")
                    .font(.subheadline)
                    .foregroundStyle(Theme.muted)
            }
            .transition(.rawkoonSwap)
        case .failed:
            HStack(spacing: 8) {
                Image(systemName: "exclamationmark.triangle")
                    .font(.caption)
                    .foregroundStyle(Theme.terracotta)
                Text("Could not get a response from AI")
                    .font(.subheadline)
                    .foregroundStyle(Theme.terracotta)
                Spacer(minLength: 8)
                Button {
                    Task {
                        await onRetry()
                    }
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "arrow.clockwise")
                        Text("Retry")
                    }
                    .font(.system(.caption, design: .monospaced).weight(.semibold))
                    .foregroundStyle(Theme.textStrong)
                    .padding(.horizontal, 12)
                    .frame(minHeight: 44)
                }
                .buttonStyle(.plain)
                .requiresConnection(model.isOffline)
            }
            .transition(.rawkoonSwap)
        case .picked:
            if let release = aiPickedRelease {
                aiPickBannerContent(release)
                    .transition(.rawkoonSwap)
            }
        case .grabbed:
            HStack(spacing: 8) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.caption)
                    .foregroundStyle(Theme.seed)
                Text("Grabbed!")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Theme.seed)
            }
            .transition(.rawkoonSwap)
        }
    }

    private func aiPickBannerContent(_ release: ReleaseItem) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "sparkles")
                .font(.caption)
                .foregroundStyle(Theme.apricot)
                .padding(.top, 1)
            VStack(alignment: .leading, spacing: 4) {
                Text("AI Pick")
                    .font(.system(.caption, design: .monospaced).weight(.semibold))
                    .foregroundStyle(Theme.apricotSoft)
                Text(release.title)
                    .font(.subheadline)
                    .foregroundStyle(Theme.text)
                    .lineLimit(2)
                if let reasoning = aiPick?.reasoning, !reasoning.isEmpty {
                    Text(reasoning)
                        .font(.caption)
                        .italic()
                        .foregroundStyle(Theme.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                HStack(spacing: 8) {
                    Spacer(minLength: 8)
                    Button {
                        Task {
                            await onGrab(release)
                        }
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "sparkles")
                            Text("Grab")
                        }
                        .font(.system(.caption, design: .monospaced).weight(.semibold))
                        .foregroundStyle(Theme.onAccent)
                        .padding(.horizontal, 14)
                        .frame(minHeight: 44)
                        .background(Theme.apricot, in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .disabled(grabbingGuid != nil)
                    .requiresConnection(model.isOffline)
                    Button {
                        onDismiss()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(Theme.muted)
                            .frame(width: 44, height: 44)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Close")
                }
            }
        }
    }

    /// The card itself; its outer gutter sits outside, so the celebration ring hugs the card.
    private func aiPickBannerShell(isError: Bool, @ViewBuilder content: () -> some View) -> some View {
        content()
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(
                (isError ? Theme.terracotta : Theme.apricot).opacity(0.12),
                in: RoundedRectangle(cornerRadius: 12)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .strokeBorder(isError ? Theme.terracotta.opacity(0.4) : Theme.apricotSoft, lineWidth: 1)
            )
    }
}
