import SwiftUI

struct NotificationsSettingsView: View {
    @EnvironmentObject private var model: AppModel

    private static let allKeys: [String] = [
        "library_downloaded", "library_grabbed", "library_failed", "library_grab_skipped", "library_attention",
        "book_downloaded", "book_grabbed", "book_failed", "book_search_skipped", "book_author_releases",
        "request_pending", "request_decided", "request_available",
        "movie_release_reminder", "app_update", "github_release",
    ]

    private struct Row: Identifiable {
        let key: String
        let label: String
        var id: String {
            key
        }
    }

    private let libraryRows: [Row] = [
        Row(key: "library_downloaded", label: "Download complete"),
        Row(key: "library_grabbed", label: "Release grabbed"),
        Row(key: "library_failed", label: "Download failed"),
        Row(key: "library_grab_skipped", label: "Grab skipped"),
        Row(key: "library_attention", label: "Needs attention"),
    ]

    private let bookRows: [Row] = [
        Row(key: "book_downloaded", label: "Download complete"),
        Row(key: "book_grabbed", label: "Release grabbed"),
        Row(key: "book_failed", label: "Download failed"),
        Row(key: "book_search_skipped", label: "Search skipped"),
        Row(key: "book_author_releases", label: "New author releases"),
    ]

    private let requestRows: [Row] = [
        Row(key: "request_pending", label: "New request pending"),
        Row(key: "request_decided", label: "Request approved or denied"),
        Row(key: "request_available", label: "Requested title available"),
    ]

    private let otherRows: [Row] = [
        Row(key: "movie_release_reminder", label: "Upcoming release reminders"),
        Row(key: "app_update", label: "App updated"),
        Row(key: "github_release", label: "New Rawkoon release"),
    ]

    @State private var prefs: [String: Bool] = Dictionary(uniqueKeysWithValues: NotificationsSettingsView.allKeys.map { ($0, true) })
    @State private var isLoading = true
    @State private var saveError: String?

    var body: some View {
        Form {
            if isLoading {
                Section {
                    HStack {
                        Spacer()
                        ProgressView().tint(Theme.apricot)
                        Spacer()
                    }
                }
                .listRowBackground(Theme.raised)
            }

            Section("Library") {
                ForEach(libraryRows) { row in
                    toggleRow(row)
                }
            }
            .listRowBackground(Theme.raised)

            Section("Books") {
                ForEach(bookRows) { row in
                    toggleRow(row)
                }
            }
            .listRowBackground(Theme.raised)

            Section("Requests") {
                ForEach(requestRows) { row in
                    toggleRow(row)
                }
            }
            .listRowBackground(Theme.raised)

            Section("Other") {
                ForEach(otherRows) { row in
                    toggleRow(row)
                }
            }
            .listRowBackground(Theme.raised)

            if let saveError {
                Section {
                    Text(saveError)
                        .font(.footnote)
                        .foregroundStyle(Theme.terracotta)
                }
                .listRowBackground(Theme.raised)
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.base)
        .tint(Theme.apricot)
        .navigationTitle("Notifications")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await loadPrefs()
        }
    }

    private func toggleRow(_ row: Row) -> some View {
        Toggle(row.label, isOn: Binding(
            get: { prefs[row.key] ?? true },
            set: { newValue in
                let previousValue = prefs[row.key] ?? true
                prefs[row.key] = newValue
                Task { await savePrefs(key: row.key, previousValue: previousValue) }
            }
        ))
    }

    private func loadPrefs() async {
        defer { isLoading = false }
        guard let client = model.api() else { return }
        let session = try? await client.currentUser()
        guard let user = session?.user else { return }
        guard let serverPrefs = user.notificationPreferences else { return }
        for key in NotificationsSettingsView.allKeys {
            if let value = serverPrefs[key] {
                prefs[key] = value
            }
        }
    }

    private func savePrefs(key: String, previousValue: Bool) async {
        guard let client = model.api() else { return }
        do {
            try await client.updateNotificationPrefs(prefs)
            saveError = nil
        } catch {
            prefs[key] = previousValue
            saveError = "Couldn't save your notification preferences."
        }
    }
}
