import SwiftUI

#if !targetEnvironment(macCatalyst)
    import GoogleCast

    /// The SDK's device picker. It hides itself while no receiver is on the network.
    struct CastButton: UIViewRepresentable {
        func makeUIView(context _: Context) -> GCKUICastButton {
            let button = GCKUICastButton(frame: CGRect(x: 0, y: 0, width: 24, height: 24))
            button.tintColor = UIColor(Theme.textStrong)
            return button
        }

        func updateUIView(_: GCKUICastButton, context _: Context) {}
    }

    /// Says where the book is playing while a receiver has it.
    struct CastingPill: View {
        let deviceName: String

        var body: some View {
            Label {
                Text("Playing on \(deviceName)")
                    .lineLimit(1)
            } icon: {
                Image(systemName: "tv.and.hifispeaker.fill")
            }
            .font(.footnote.weight(.semibold))
            .foregroundStyle(Theme.textStrong)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .glassEffect(.regular, in: .capsule)
            .accessibilityElement(children: .combine)
        }
    }
#endif

extension View {
    /// Shows why casting stopped. A no-op on Mac, which has no Cast.
    func castErrorAlert() -> some View {
        #if targetEnvironment(macCatalyst)
            self
        #else
            alert(
                "Casting stopped",
                isPresented: Binding(
                    get: { CastController.shared.castError != nil },
                    set: {
                        if !$0 {
                            CastController.shared.castError = nil
                        }
                    }
                )
            ) {
                Button("OK", role: .cancel) { CastController.shared.castError = nil }
            } message: {
                if let message = CastController.shared.castError {
                    Text(message)
                }
            }
        #endif
    }
}
