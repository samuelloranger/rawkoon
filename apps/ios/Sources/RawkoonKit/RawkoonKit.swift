import Foundation

/// Marker for the pure core. This target must never import AVFoundation, UIKit,
/// URLSession or SwiftData: it is built and tested on Linux, where none exist.
public enum RawkoonKit {
    public static let name = "RawkoonKit"
}
