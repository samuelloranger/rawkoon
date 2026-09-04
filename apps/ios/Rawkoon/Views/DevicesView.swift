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
    @State private var removing = false

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
                    Text("iOS \(UIDevice.current.systemVersion) • this device")
                        .font(.footnote)
                        .foregroundStyle(Theme.muted)
                }
            }
            .listRowBackground(Theme.raised)

            if !otherApns.isEmpty {
                Section("Other iOS devices") {
                    ForEach(otherApns) { device in
                        deviceRow(
                            name: device.deviceName ?? String(localized: "iPhone"),
                            verbatimSubtitle: iosSubtitle(device)
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
                .disabled(removing)
            Button("Cancel", role: .cancel) { pending = nil }
        } message: { _ in
            Text("It will stop receiving notifications.")
        }
    }

    private func deviceRow(
        name: String,
        subtitle: LocalizedStringKey,
        onDelete: @escaping () -> Void
    ) -> some View {
        deviceRowContent(name: name, subtitle: Text(subtitle), onDelete: onDelete)
    }

    private func deviceRow(
        name: String,
        verbatimSubtitle: String,
        onDelete: @escaping () -> Void
    ) -> some View {
        deviceRowContent(name: name, subtitle: Text(verbatim: verbatimSubtitle), onDelete: onDelete)
    }

    private func deviceRowContent(
        name: String,
        subtitle: Text,
        onDelete: @escaping () -> Void
    ) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(name).foregroundStyle(Theme.text)
            subtitle
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
        var failed = false
        do {
            apns = try await client.apnsDevices().devices
        } catch {
            failed = true
        }
        do {
            web = try await client.webPushDevices().devices
        } catch {
            failed = true
        }
        if failed {
            model.toast(String(localized: "Couldn't refresh all devices."), style: .error)
        }
        loading = false
    }

    private func remove(_ item: PendingDelete) async {
        pending = nil
        guard let client = model.api(), !removing else { return }
        removing = true
        defer { removing = false }
        do {
            // Remove from the local list on a confirmed delete rather than
            // re-fetching: a failed refetch must not resurrect a device that
            // the server already deleted, nor overwrite the success toast with
            // its own "couldn't refresh" error.
            switch item.kind {
            case .apns:
                try await client.deleteApnsDevice(id: item.deviceId)
                apns.removeAll { $0.id == item.deviceId }
            case .web:
                try await client.deleteWebPushDevice(id: item.deviceId)
                web.removeAll { $0.id == item.deviceId }
            }
            model.toast(String(localized: "Device removed."), style: .success)
        } catch {
            model.toast(String(localized: "Couldn't remove device."), style: .error)
        }
    }
}
