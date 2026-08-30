import SwiftUI

// STUB — replaced by the Activity page implementation.
// Tab root. Download queue + activity feed + calendar.
struct ActivityView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        ScrollView {
            ContentUnavailableView(
                "Activity",
                systemImage: "arrow.down.circle",
                description: Text("Downloads, history, and what's coming up.")
            )
            .padding(.top, 80)
        }
        .background(Theme.base)
        .navigationTitle("Activity")
    }
}
