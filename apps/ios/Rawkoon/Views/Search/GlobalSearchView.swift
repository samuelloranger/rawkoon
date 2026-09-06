import SwiftUI

/// The Search tab (Tab role .search). A working shell that hosts the app's
/// unified search; cross-entity scopes (titles / requests / go-to) are expanded
/// in the Search plan. Kept native: a .searchable NavigationStack, no custom bar.
struct GlobalSearchView: View {
    @Environment(AppModel.self) private var model
    @State private var query = ""

    var body: some View {
        NavigationStack {
            List {
                if query.isEmpty {
                    ContentUnavailableView("Search Rawkoon",
                        systemImage: "magnifyingglass",
                        description: Text("Find titles, requests, and sections."))
                }
                // Results wired in the Search plan.
            }
            .navigationTitle("Search")
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always))
        }
    }
}
