import SwiftUI
import UIKit

/// Cozy Dusk — the Rawkoon design system on iOS.
///
/// Palette and typography mirror `apps/web/src/index.css` so the native app and
/// the web PWA read as one product. The app is dark-only by design: audiobooks
/// and late-night queue-watching live at night.
enum Theme {
    // MARK: Surfaces
    static let base = Color(hex: 0x1C1715)          // app background
    static let raised = Color(hex: 0x241E1B)        // cards, rows, sheets
    static let inset = Color(hex: 0x171311)         // fields, insets
    static let well = Color(hex: 0x141010)          // grooves & tracks
    static let border = Color(hex: 0x322A25)
    static let borderStrong = Color(hex: 0x3A2F27)

    // MARK: Accent
    static let apricot = Color(hex: 0xE8A06A)        // primary · play · active
    static let apricotSoft = Color(hex: 0xF0BF93)
    static let terracotta = Color(hex: 0xCF6A4E)     // pressed · progress start
    static let terracottaDeep = Color(hex: 0xAD5440)

    // MARK: Semantic
    static let seed = Color(hex: 0x86B98A)           // in library · seeders
    static let importing = Color(hex: 0x8FB6D6)      // importing / renaming

    // MARK: Text
    static let textStrong = Color(hex: 0xF4ECE4)     // titles
    static let text = Color(hex: 0xE3D8CF)           // body
    static let muted = Color(hex: 0xAA9A8C)          // secondary · captions
    static let faint = Color(hex: 0x9D8775)          // faintest readable

    /// Ink used on top of the apricot accent (dark brown, high contrast).
    static let onAccent = Color(hex: 0x2A1A10)

    // MARK: Gradients
    /// Progress fills: terracotta → apricot, left to right.
    static let progress = LinearGradient(
        colors: [terracotta, apricot],
        startPoint: .leading, endPoint: .trailing
    )

    /// Now Playing "dusk glow" ground — a lamp behind the cover.
    static let duskGlow = RadialGradient(
        colors: [apricot.opacity(0.30), .clear],
        center: .init(x: 0.5, y: 0.08), startRadius: 0, endRadius: 260
    )
}

// MARK: - Typography

extension Font {
    /// Fraunces — the display serif. Titles, headers, Now Playing only; never
    /// body copy. Falls back to the system serif design if the bundled face is
    /// unavailable, so the app is legible even before the font registers.
    static func display(_ size: CGFloat, weight: Weight = .semibold) -> Font {
        if UIFont(name: "Fraunces", size: size) != nil {
            return .custom("Fraunces", size: size).weight(weight)
        }
        return .system(size: size, weight: weight, design: .serif)
    }
}

// MARK: - Color hex helper

extension Color {
    init(hex: UInt32, alpha: Double = 1) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: alpha
        )
    }
}

// MARK: - Global appearance

enum Appearance {
    /// Applies the Cozy Dusk look to the UIKit-backed bars that SwiftUI wraps:
    /// large navigation titles in Fraunces, warm-brown bar grounds, apricot tint.
    /// Call once at launch.
    static func apply() {
        let nav = UINavigationBarAppearance()
        nav.configureWithOpaqueBackground()
        nav.backgroundColor = UIColor(Theme.base)
        nav.shadowColor = UIColor(Theme.border)

        let strong = UIColor(Theme.textStrong)
        let large = UIFont(name: "Fraunces", size: 34)?.withWeight(.semibold)
            ?? UIFont.systemFont(ofSize: 34, weight: .semibold)
        let inline = UIFont(name: "Fraunces", size: 17)?.withWeight(.semibold)
            ?? UIFont.systemFont(ofSize: 17, weight: .semibold)
        nav.largeTitleTextAttributes = [.foregroundColor: strong, .font: large]
        nav.titleTextAttributes = [.foregroundColor: strong, .font: inline]

        UINavigationBar.appearance().standardAppearance = nav
        UINavigationBar.appearance().scrollEdgeAppearance = nav
        UINavigationBar.appearance().compactAppearance = nav
        UINavigationBar.appearance().tintColor = UIColor(Theme.apricot)
    }
}

private extension UIFont {
    func withWeight(_ weight: UIFont.Weight) -> UIFont {
        let descriptor = fontDescriptor.addingAttributes([
            .traits: [UIFontDescriptor.TraitKey.weight: weight]
        ])
        return UIFont(descriptor: descriptor, size: pointSize)
    }
}
