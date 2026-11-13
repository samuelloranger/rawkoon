import RawkoonKit
import SwiftUI

/// Every shelf as its cover card. Administrators create one here (empty or from
/// a recipe), open its editor, and delete it; everyone else browses.
struct ShelvesView: View {
    @Environment(AppModel.self) private var model

    @State private var shelves: [ShelfSummary] = []
    @State private var loading = true
    @State private var error: String?
    @State private var newShelfOpen = false
    @State private var deleteTarget: ShelfSummary?

    private enum Phase: Equatable { case loading, offline, error, empty, list }

    private var phase: Phase {
        if loading, shelves.isEmpty {
            return .loading
        }
        if shelves.isEmpty, error != nil {
            return model.isOffline ? .offline : .error
        }
        return shelves.isEmpty ? .empty : .list
    }

    private let columns = [GridItem(.adaptive(minimum: 170), spacing: 12)]

    var body: some View {
        ScrollView {
            content
                .padding(.top, 12)
                .padding(.bottom, 32)
                .rawkoonMotion(RawkoonMotion.spring, value: phase)
        }
        .reportsTabBarScroll()
        .refreshable { await load() }
        .background(Theme.base)
        .navigationTitle("Shelves")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if model.isAdmin {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        newShelfOpen = true
                    } label: {
                        Label("New shelf", systemImage: "plus")
                    }
                    .requiresConnection(model.isOffline)
                }
            }
        }
        .sheet(isPresented: $newShelfOpen) {
            NewShelfSheet { _ in
                Task { await load() }
            }
            .environment(model)
        }
        .confirmationDialog(
            deleteTarget.map { String(localized: "Delete “\($0.name)”?") } ?? "",
            isPresented: Binding(
                get: { deleteTarget != nil },
                set: {
                    if !$0 {
                        deleteTarget = nil
                    }
                }
            ),
            titleVisibility: .visible
        ) {
            Button("Delete shelf", role: .destructive) {
                if let target = deleteTarget {
                    Task { await delete(target) }
                }
                deleteTarget = nil
            }
        } message: {
            Text("Its titles are removed from the shelf; they stay in the library.")
        }
        .task {
            await load()
        }
        .onChange(of: model.isOffline) { _, offline in
            guard !offline, shelves.isEmpty || error != nil else { return }
            Task { await load() }
        }
    }

    @ViewBuilder private var content: some View {
        switch phase {
        case .loading:
            LazyVGrid(columns: columns, spacing: 14) {
                ForEach(0 ..< 4, id: \.self) { _ in
                    ShimmerView(cornerRadius: 14).aspectRatio(16.0 / 9.0, contentMode: .fit)
                }
            }
            .padding(.horizontal, 16)
            .allowsHitTesting(false)
            .transition(.rawkoonSwap)
        case .offline:
            ContentUnavailableView(
                "You're offline",
                systemImage: "wifi.slash",
                description: Text("This will load when you're back online.")
            )
            .rawkoonLivingSymbol(.error)
            .padding(.top, 16)
        case .error:
            ContentUnavailableView(
                "Couldn't load shelves",
                systemImage: "wifi.slash",
                description: Text(error ?? "")
            )
            .rawkoonLivingSymbol(.error)
            .padding(.top, 16)
        case .empty:
            ContentUnavailableView(
                "No shelves yet",
                systemImage: "square.stack",
                description: Text(
                    model.isAdmin
                        ? "Create one here, or start from a recipe and edit it afterwards."
                        : "An administrator hasn't added any shelves yet."
                )
            )
            .rawkoonLivingSymbol(.empty)
            .padding(.top, 28)
        case .list:
            LazyVGrid(columns: columns, spacing: 14) {
                ForEach(shelves) { shelf in
                    NavigationLink {
                        ShelfDetailView(shelfId: shelf.id)
                    } label: {
                        ShelfCoverView(shelf: shelf)
                    }
                    .buttonStyle(.rawkoonPressable)
                    .rawkoonEntrance(id: shelf.id)
                    .contextMenu {
                        if model.isAdmin {
                            Button {
                                deleteTarget = shelf
                            } label: {
                                Label("Delete shelf", systemImage: "trash")
                            }
                            .requiresConnection(model.isOffline)
                        }
                    }
                }
            }
            .padding(.horizontal, 16)
            .rawkoonEntranceScope()
            .transition(.rawkoonSwap)
        }
    }

    private func load() async {
        guard let client = model.api() else {
            error = String(localized: "Not signed in.")
            loading = false
            return
        }
        do {
            shelves = try await client.shelves(includeAll: model.isAdmin)
            error = nil
        } catch is CancellationError {
            return
        } catch let apiError as APIError {
            error = apiError.userMessage(unauthorized: String(localized: "Sign in required."))
        } catch {
            self.error = String(localized: "Can't reach the server. Try again in a moment.")
        }
        loading = false
    }

    private func delete(_ shelf: ShelfSummary) async {
        guard let client = model.api() else { return }
        let before = shelves
        shelves.removeAll { $0.id == shelf.id }
        do {
            try await client.deleteShelf(id: shelf.id)
            model.toast(String(localized: "Shelf deleted."))
        } catch {
            shelves = before
            model.toast(String(localized: "Couldn't delete the shelf."), style: .error)
        }
    }
}
