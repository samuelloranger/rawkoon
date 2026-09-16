import SwiftUI

/// Admin-only diagnostic screen for the two live SSE connections
/// (`/api/library/events`, `/api/notifications/stream`). Reached via a hidden
/// long-press on the Settings version row — never listed as a normal
/// destination. Lets an admin watch connection state and raw events live,
/// force a reconnect to reproduce the drop/reconnect path on demand, and fire
/// synthetic test events through the real SSE bus (server-side, so the same
/// trigger works from a plain authenticated curl call too).
struct SSEDebugView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    @State private var mediaId = "1"
    @State private var bookId = "1"
    @State private var busy = false
    @State private var errorMessage: String?

    var body: some View {
        Form {
            Section("Connection status") {
                statusRow("Library events", model.libraryStreamStatus)
                statusRow("Notifications", model.notificationStreamStatus)

                Button("Force reconnect both streams") {
                    model.forceReconnectSSE()
                }
                .disabled(busy)
            }

            Section("Trigger a test event") {
                LabeledContent("Media id") {
                    TextField("id", text: $mediaId)
                        .keyboardType(.numberPad)
                        .multilineTextAlignment(.trailing)
                }
                Button("Emit media event") {
                    trigger(kind: "media", rawId: mediaId)
                }
                .disabled(busy || Int(mediaId) == nil)

                LabeledContent("Book id") {
                    TextField("id", text: $bookId)
                        .keyboardType(.numberPad)
                        .multilineTextAlignment(.trailing)
                }
                Button("Emit book event") {
                    trigger(kind: "book", rawId: bookId)
                }
                .disabled(busy || Int(bookId) == nil)

                Button("Send test notification") {
                    sendTestNotification()
                }
                .disabled(busy)

                if let errorMessage {
                    Text(errorMessage)
                        .font(.caption)
                        .foregroundStyle(Theme.terracotta)
                }
            }

            Section("Live event log (\(model.sseDebugLog.count))") {
                if model.sseDebugLog.isEmpty {
                    Text("No events yet.")
                        .foregroundStyle(Theme.faint)
                } else {
                    ForEach(model.sseDebugLog) { entry in
                        VStack(alignment: .leading, spacing: 2) {
                            Text("\(entry.stream) · \(entry.timestamp.formatted(date: .omitted, time: .standard))")
                                .font(.system(.caption2, design: .monospaced))
                                .foregroundStyle(Theme.faint)
                            Text(entry.summary)
                                .font(.system(.caption, design: .monospaced))
                        }
                    }
                }
            }
        }
        .navigationTitle("SSE Debug")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Done") { dismiss() }
            }
        }
    }

    @ViewBuilder
    private func statusRow(_ label: String, _ status: SSEStreamStatus) -> some View {
        LabeledContent(label) {
            Text(statusText(status))
                .foregroundStyle(statusColor(status))
        }
    }

    private func statusText(_ status: SSEStreamStatus) -> String {
        switch status {
        case .idle: "idle"
        case .connecting: "connecting…"
        case .connected: "connected"
        case .reconnecting: "reconnecting…"
        }
    }

    private func statusColor(_ status: SSEStreamStatus) -> Color {
        switch status {
        case .idle: Theme.faint
        case .connecting, .reconnecting: Theme.apricot
        case .connected: .green
        }
    }

    private func trigger(kind: String, rawId: String) {
        guard let id = Int(rawId), let client = model.api() else { return }
        errorMessage = nil
        busy = true
        Task {
            defer { busy = false }
            do {
                try await client.triggerSSETest(kind: kind, id: id)
            } catch {
                errorMessage = settingsErrorMessage(error)
            }
        }
    }

    private func sendTestNotification() {
        guard let client = model.api() else { return }
        errorMessage = nil
        busy = true
        Task {
            defer { busy = false }
            do {
                try await client.sendTestNotification()
            } catch {
                errorMessage = settingsErrorMessage(error)
            }
        }
    }
}
