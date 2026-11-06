import SwiftUI
import UIKit

/// Paper Noir — the Rawkoon design system on iOS.
///
/// Paper Noir palette and Bricolage typography mirror `apps/web/src/index.css` so the native app and
/// the web PWA read as one product. The app is dark-only by design: audiobooks
/// and late-night queue-watching live at night.
enum Theme {
    // MARK: Surfaces

    static let base = Color(hex: 0x201F1C) // app background
    static let raised = Color(hex: 0x2C2B27) // cards, rows, sheets
    static let inset = Color(hex: 0x171714) // fields, insets
    static let well = Color(hex: 0x141411) // grooves & tracks
    static let border = Color(hex: 0x4C4941)
    static let borderStrong = Color(hex: 0x5A554C)
    static let tabBar = Color(hex: 0x302F2A) // floating tab bar
    static let tabPill = Color(hex: 0xF3EEE5).opacity(0.13) // active tab pill
    static let danger = Color(hex: 0xDF9B91) // errors retain a semantic red
    static let badge = Color(hex: 0xDF9B91) // unread badge

    // MARK: Accent (legacy names: parchment and bronze)

    static let apricot = Color(hex: 0xE6D8BF) // primary · play · active
    static let apricotSoft = Color(hex: 0xF2EADC)
    static let terracotta = Color(hex: 0xBDA586) // pressed · progress start
    static let terracottaDeep = Color(hex: 0xA78D70)

    // MARK: Semantic

    static let seed = Color(hex: 0xA8BBA0) // in library · seeders
    static let importing = Color(hex: 0xA7B9CC) // importing / renaming

    // MARK: Text

    static let textStrong = Color(hex: 0xF3EEE5) // titles
    static let text = Color(hex: 0xDDD7CC) // body
    static let muted = Color(hex: 0xB6AD9E) // secondary · captions
    /// Secondary text with contrast against both Paper Noir surfaces.
    static let faint = Color(hex: 0xB0A695)

    /// Ink used on top of the apricot accent (dark brown, high contrast).
    static let onAccent = Color(hex: 0x25221C)

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
    /// Bricolage Grotesque — the Paper Noir display face. Titles, headers, Now Playing only; never
    /// body copy. Falls back to the system design if the bundled face is
    /// unavailable, so the app is legible even before the font registers.
    static func display(_ size: CGFloat, weight: Weight = .semibold) -> Font {
        if UIFont(name: "BricolageGrotesque-SemiBold", size: size) != nil {
            return .custom("BricolageGrotesque-SemiBold", size: size).weight(weight)
        }
        return .system(size: size, weight: weight, design: .default)
    }

    /// Peer-level section headers across the app (Similar, Files, Chapters,
    /// Management, Home rails…). One token so section titles stop drifting
    /// between 16/17/19pt from screen to screen.
    static var sectionTitle: Font {
        display(17)
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
    /// large navigation titles in Bricolage Grotesque, parchment tint. Call once at launch.
    static func apply() {
        // Transparent so iOS 26's Liquid Glass bar and scroll-edge effect show;
        // an opaque ground hides both.
        let nav = UINavigationBarAppearance()
        nav.configureWithTransparentBackground()

        let strong = UIColor(Theme.textStrong)
        // Scaled like the segmented labels below, so titles follow Dynamic Type.
        let large = UIFontMetrics(forTextStyle: .largeTitle).scaledFont(
            for: UIFont(name: "BricolageGrotesque-SemiBold", size: 34)?.withWeight(.semibold)
                ?? UIFont.systemFont(ofSize: 34, weight: .semibold)
        )
        let inline = UIFontMetrics(forTextStyle: .headline).scaledFont(
            for: UIFont(name: "BricolageGrotesque-SemiBold", size: 17)?.withWeight(.semibold)
                ?? UIFont.systemFont(ofSize: 17, weight: .semibold)
        )
        nav.largeTitleTextAttributes = [.foregroundColor: strong, .font: large]
        nav.titleTextAttributes = [.foregroundColor: strong, .font: inline]

        #if targetEnvironment(macCatalyst)
            // A Mac window has no glass bar to read through, so scrolled content would show under the title.
            let bar = nav.copy() as? UINavigationBarAppearance ?? nav
            bar.backgroundColor = UIColor(Theme.base)
            bar.shadowColor = UIColor(Theme.border)
        #else
            let bar = nav
        #endif
        UINavigationBar.appearance().standardAppearance = bar
        UINavigationBar.appearance().scrollEdgeAppearance = bar
        UINavigationBar.appearance().compactAppearance = bar
        UINavigationBar.appearance().tintColor = UIColor(Theme.apricot)

        // Segmented controls keep the native glass track and thumb; only the
        // labels are themed. Fonts scale with Dynamic Type (via UIFontMetrics)
        // instead of a hard 13pt so labels don't truncate at larger text sizes.
        let segMetrics = UIFontMetrics(forTextStyle: .footnote)
        let seg = UISegmentedControl.appearance()
        seg.setTitleTextAttributes([
            .foregroundColor: UIColor(Theme.textStrong),
            .font: segMetrics.scaledFont(for: .systemFont(ofSize: 13, weight: .semibold)),
        ], for: .selected)
        seg.setTitleTextAttributes([
            .foregroundColor: UIColor(Theme.muted),
            .font: segMetrics.scaledFont(for: .systemFont(ofSize: 13, weight: .medium)),
        ], for: .normal)

        // SwiftUI Slider is a UISlider. Default tracks are system gray and
        // fight the well/apricot language every other progress uses.
        let slider = UISlider.appearance()
        slider.minimumTrackTintColor = UIColor(Theme.apricot)
        slider.maximumTrackTintColor = UIColor(Theme.well)
        slider.thumbTintColor = UIColor(Theme.textStrong)
    }
}

private extension UIFont {
    func withWeight(_ weight: UIFont.Weight) -> UIFont {
        let descriptor = fontDescriptor.addingAttributes([
            .traits: [UIFontDescriptor.TraitKey.weight: weight],
        ])
        return UIFont(descriptor: descriptor, size: pointSize)
    }
}
