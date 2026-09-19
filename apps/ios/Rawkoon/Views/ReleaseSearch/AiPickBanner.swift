import RawkoonKit
import SwiftUI

/// AI-picks banner: mirrors the web `AiPickBanner`. State lives in
/// `ReleaseSearchView`; this view renders it and reports actions back through
/// the closures (retry, grab, dismiss) so the parent stays the single owner.
struct AiPickBanner: View {
    let aiPickLoading: Bool
    let aiPickError: String?
    let aiPickedRelease: ReleaseItem?
    let aiPickGrabbed: Bool
    let aiPick: AiPick?
    let grabbingGuid: String?
    let onRetry: () async -> Void
    let onGrab: (ReleaseItem) async -> Void
    let onDismiss: () -> Void

    @ViewBuilder
    var body: some View {
        if aiPickLoading {
            aiPickBannerShell(isError: false) {
                HStack(spacing: 8) {
                    Image(systemName: "sparkles")
                        .font(.caption)
                        .foregroundStyle(Theme.apricot)
                    Text("AI is picking the best release…")
                        .font(.subheadline)
                        .foregroundStyle(Theme.muted)
                }
            }
        } else if aiPickError != nil {
            aiPickBannerShell(isError: true) {
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
                }
            }
        } else if let release = aiPickedRelease {
            aiPickBannerShell(isError: false) {
                if aiPickGrabbed {
                    HStack(spacing: 8) {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.caption)
                            .foregroundStyle(Theme.seed)
                        Text("Grabbed!")
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(Theme.seed)
                    }
                } else {
                    aiPickBannerContent(release)
                }
            }
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
                    Button {
                        onDismiss()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(Theme.muted)
                            .frame(width: 44, height: 44)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

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
            .padding(.horizontal, 16)
            .padding(.bottom, 10)
    }
}
