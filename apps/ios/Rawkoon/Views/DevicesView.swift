import SwiftUI
import UIKit

/// The devices that receive notifications for the signed-in user: this iPhone,
/// other registered iOS devices, and web browsers. Read + single-delete only
/// (spec §5 Phase 1). Not admin-gated — every signed-in user reaches it.
struct DevicesView: View {
    @Environment(AppModel.self) private var model

    @State private var apns: [ApnsDeviceDTO] = []
    @State private var web: [WebPushDeviceDTO] = []
    @State private var loading = true
    @State private var pending: PendingDelete?

    private struct PendingDelete: Identifiable {
        let id = UUID()
        let kind: Kind
        let deviceId: Int
        enum Kind { case apns, web }
    }

    private var thisDeviceName: String {
        UIDevice.current.name
    }

    /// APNS rows that are not this device (matched by name — the token isn't returned).
    private var otherApns: [ApnsDeviceDTO] {
        apns.filter { $0.deviceName != thisDeviceName }
    }

    var body: some View {
        Form {
            Section("This device") {
                VStack(alignment: .leading, spacing: 2) {
                    Text(thisDeviceName)
                        .foregroundStyle(Theme.text)
                    Text("iOS \(UIDevice.current.systemVersion) \u{2022} this device")
                        .font(.footnote)
                        .foregroundStyle(Theme.muted)
                }
            }
            .listRowBackground(Theme.raised)

            if !otherApns.isEmpty {
                Section("Other iOS devices") {
                    ForEach(otherApns) { device in
                        deviceRow(
                            name: device.deviceName ?? "iPhone",
                            subtitle: iosSubtitle(device)
                        ) {
                            pending = PendingDelete(kind: .apns, deviceId: device.id)
                        }
                    }
                }
                .listRowBackground(Theme.raised)
            }

            if !web.isEmpty {
                Section("Web browsers") {
                    ForEach(web) { device in
                        deviceRow(name: webName(device), subtitle: "Web push") {
                            pending = PendingDelete(kind: .web, deviceId: device.id)
                        }
                    }
                }
                .listRowBackground(Theme.raised)
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.base)
        .tint(Theme.apricot)
        .navigationTitle("Devices")
        .navigationBarTitleDisplayMode(.inline)
        .overlay {
            if loading, apns.isEmpty, web.isEmpty {
                ProgressView().tint(Theme.apricot)
            }
        }
        .task { await load() }
        .refreshable { await load() }
        .confirmationDialog(
            "Remove this device?",
            isPresented: Binding(
                get: { pending != nil },
                set: {
                    if !$0 {
                        pending = nil
                    }
                }
            ),
            titleVisibility: .visible,
            presenting: pending
        ) { item in
            Button("Remove", role: .destructive) { Task { await remove(item) } }
            Button("Cancel", role: .cancel) { pending = nil }
        } message: { _ in
            Text("It will stop receiving notifications.")
        }
    }

    private func deviceRow(
        name: String,
        subtitle: String,
        onDelete: @escaping () -> Void
    ) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(name).foregroundStyle(Theme.text)
            Text(subtitle)
                .font(.footnote)
                .foregroundStyle(Theme.muted)
        }
        .swipeActions {
            Button("Remove", role: .destructive, action: onDelete)
        }
    }

    private func iosSubtitle(_ device: ApnsDeviceDTO) -> String {
        [
            device.osVersion.map { "iOS \($0)" },
            device.appVersion.map { "Rawkoon \($0)" },
        ]
        .compactMap(\.self)
        .joined(separator: " \u{2022} ")
    }

    private func webName(_ device: WebPushDeviceDTO) -> String {
        if let name = device.deviceName, !name.isEmpty {
            return name
        }
        let parts = [device.browserName, device.osName].compactMap(\.self)
        return parts.isEmpty ? "Browser" : parts.joined(separator: " \u{2022} ")
    }

    private func load() async {
        guard let client = model.api() else {
            loading = false
            return
        }
        // Load independently so one failing list doesn't blank the other.
        if let response = try? await client.apnsDevices() {
            apns = response.devices
        }
        if let response = try? await client.webPushDevices() {
            web = response.devices
        }
        loading = false
    }

    private func remove(_ item: PendingDelete) async {
        pending = nil
        guard let client = model.api() else { return }
        switch item.kind {
        case .apns: try? await client.deleteApnsDevice(id: item.deviceId)
        case .web: try? await client.deleteWebPushDevice(id: item.deviceId)
        }
        await load()
    }
}
