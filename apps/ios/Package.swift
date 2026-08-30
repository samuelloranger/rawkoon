// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "RawkoonKit",
    platforms: [.iOS(.v18), .macOS(.v14)],
    products: [.library(name: "RawkoonKit", targets: ["RawkoonKit"])],
    targets: [
        .target(name: "RawkoonKit", swiftSettings: [.swiftLanguageMode(.v5)]),
        .testTarget(
            name: "RawkoonKitTests",
            dependencies: ["RawkoonKit"],
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
    ]
)
