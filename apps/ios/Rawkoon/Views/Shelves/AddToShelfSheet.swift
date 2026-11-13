import RawkoonKit
import SwiftUI

/// The title page's "Add to shelf…" sheet: the shelves that take titles by hand,
/// each with a check when it holds this title, plus creating a new one.
struct AddToShelfSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    let item: LibraryMedia
    var onChange: () -> Void

    @State private var shelves: [ShelfMembership] = []
    @State private var loading = true
    @State private var busy = false
    @State private var newName = ""
    @State private var creating = false
    @State private var error: String?

    private var manual: [ShelfMembership] {
        shelves.filter { $0.orderMode == .manual }
    }

    var body: some View {
        NavigationStack {
            List {
                if loading {
                    HStack {
                        ProgressView()
                        Text("Loading shelves…")
                            .foregroundStyle(Theme.muted)
                    }
                } else if manual.isEmpty {
                    Text("No shelves take titles by hand yet.")
                        .foregroundStyle(Theme.muted)
                } else {
                    Section("Shelves") {
                        ForEach(manual) { shelf in
                            Button {
                                Task { await toggle(shelf) }
                            } label: {
                                HStack {
                                    Text(verbatim: shelf.name)
                                        .foregroundStyle(Theme.textStrong)
                                    Spacer()
                                    if shelf.holds {
                                        Image(systemName: "checkmark")
                                            .foregroundStyle(Theme.apricot)
                                    }
                                }
                            }
                            .disabled(busy)
                            .requiresConnection(model.isOffline)
                        }
                    }
                }
                Section {
                    HStack {
                        TextField("New shelf", text: $newName)
                        Button {
                            Task { await createAndAdd() }
                        } label: {
                            if creating {
                                ProgressView()
                            } else {
                                Text("Create")
                            }
                        }
                        .disabled(creating || newName.trimmingCharacters(in: .whitespaces).isEmpty)
                        .requiresConnection(model.isOffline)
                    }
                } footer: {
                    Text("A new shelf starts with this title on it.")
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.base)
            .navigationTitle("Add to shelf")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .task { await load() }
            .alert(
                "Couldn't change the shelf",
                isPresented: Binding(get: { error != nil }, set: {
                    if !$0 {
                        error = nil
                    }
                })
            ) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(error ?? "")
            }
        }
    }

    private func load() async {
        guard let client = model.api() else {
            error = String(localized: "Not signed in.")
            loading = false
            return
        }
        do {
            shelves = try await client.shelvesForTitle(tmdbId: item.tmdbId, type: item.type)
        } catch let apiError as APIError {
            error = apiError.userMessage(unauthorized: String(localized: "Sign in required."))
        } catch {
            self.error = String(localized: "Can't reach the server. Try again in a moment.")
        }
        loading = false
    }

    private func toggle(_ shelf: ShelfMembership) async {
        guard let client = model.api() else { return }
        busy = true
        defer { busy = false }
        do {
            if shelf.holds, let entryId = shelf.entryId {
                try await client.removeShelfEntry(shelfId: shelf.id, entryId: entryId)
                model.toast(String(localized: "Removed from \(shelf.name)."))
            } else {
                try await client.addShelfEntry(shelfId: shelf.id, tmdbId: item.tmdbId, type: item.type)
                model.toast(String(localized: "Added to \(shelf.name)."), style: .success)
            }
            onChange()
            await load()
        } catch let apiError as APIError {
            error = apiError.userMessage(unauthorized: String(localized: "Sign in required."))
        } catch {
            self.error = String(localized: "Can't reach the server. Try again in a moment.")
        }
    }

    private func createAndAdd() async {
        guard let client = model.api() else { return }
        creating = true
        defer { creating = false }
        do {
            let shelf = try await client.createShelf(name: newName.trimmingCharacters(in: .whitespaces))
            try await client.addShelfEntry(shelfId: shelf.id, tmdbId: item.tmdbId, type: item.type)
            newName = ""
            model.toast(String(localized: "Added to \(shelf.name)."), style: .success)
            onChange()
            await load()
        } catch let apiError as APIError {
            error = apiError.userMessage(unauthorized: String(localized: "Sign in required."))
        } catch {
            self.error = String(localized: "Can't reach the server. Try again in a moment.")
        }
    }
}
