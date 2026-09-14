// swift-tools-version: 6.4
import PackageDescription

let package = Package(
    name: "RawkoonKit",
    platforms: [.iOS(.v27), .macOS(.v14)],
    products: [.library(name: "RawkoonKit", targets: ["RawkoonKit"])],
    targets: [
        .target(name: "RawkoonKit", swiftSettings: [.swiftLanguageMode(.v6)]),
        .testTarget(
            name: "RawkoonKitTests",
            dependencies: ["RawkoonKit"],
            swiftSettings: [.swiftLanguageMode(.v6)]
        ),
    ]
)
