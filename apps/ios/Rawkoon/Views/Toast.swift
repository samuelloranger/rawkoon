import SwiftUI

/// A brief, auto-dismissing confirmation or error banner. The app has no
/// notification-banner mechanism otherwise, so this is the one place a
/// background action (a swipe delete, a menu action, a fire-and-forget
/// refresh) gets to say "done" or "failed" without blocking anything.
struct Toast: Equatable, Identifiable {
    enum Style {
        case success, error, info
    }

    let id = UUID()
    let message: String
    var style: Style = .info

    static func == (lhs: Toast, rhs: Toast) -> Bool {
        lhs.id == rhs.id
    }
}

/// Renders `AppModel.toast` as an overlay. Mounted exactly once, at the app
/// root, so any screen can call `model.toast(...)` and have it appear above
/// whatever is currently on screen.
struct ToastOverlay: View {
    let toast: Toast?

    var body: some View {
        VStack {
            Spacer()
            if let toast {
                content(for: toast)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .padding(.horizontal, 16)
                    .padding(.bottom, 12)
            }
        }
        .allowsHitTesting(false)
        .animation(.spring(duration: 0.3), value: toast)
    }

    private func content(for toast: Toast) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon(for: toast.style))
                .foregroundStyle(tint(for: toast.style))
            Text(toast.message)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(Theme.textStrong)
                .lineLimit(2)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.border, lineWidth: 1))
        .shadow(color: .black.opacity(0.35), radius: 12, y: 4)
    }

    private func icon(for style: Toast.Style) -> String {
        switch style {
        case .success: "checkmark.circle.fill"
        case .error: "exclamationmark.triangle.fill"
        case .info: "info.circle.fill"
        }
    }

    private func tint(for style: Toast.Style) -> Color {
        switch style {
        case .success: Theme.seed
        case .error: Theme.terracotta
        case .info: Theme.apricot
        }
    }
}

/// A drop-in for `Button { Task { await … } }` on a single-shot save/submit
/// action. Disables itself and shows an inline `ProgressView` the instant it
/// is tapped — before the async work even starts — then restores. Pairs with
/// per-row busy state for list actions; use this for standalone buttons.
struct AsyncButton<Label: View>: View {
    var role: ButtonRole?
    let action: () async -> Void
    @ViewBuilder let label: () -> Label

    @State private var isRunning = false
    @State private var tapCount = 0

    init(
        role: ButtonRole? = nil,
        action: @escaping () async -> Void,
        @ViewBuilder label: @escaping () -> Label
    ) {
        self.role = role
        self.action = action
        self.label = label
    }

    var body: some View {
        Button(role: role) {
            tapCount += 1
            isRunning = true
            Task {
                await action()
                isRunning = false
            }
        } label: {
            HStack(spacing: 6) {
                if isRunning {
                    ProgressView()
                        .controlSize(.small)
                }
                label()
            }
        }
        .disabled(isRunning)
        .sensoryFeedback(.selection, trigger: tapCount)
    }
}

extension AsyncButton where Label == Text {
    init(
        _ titleKey: String,
        role: ButtonRole? = nil,
        action: @escaping () async -> Void
    ) {
        self.init(role: role, action: action) { Text(titleKey) }
    }
}
