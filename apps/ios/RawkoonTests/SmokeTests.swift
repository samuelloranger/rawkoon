@testable import Rawkoon
import Testing

struct SmokeTests {
    @Test func appModuleLinks() {
        // Proves the RawkoonTests bundle compiles against @testable import Rawkoon.
        // A real assertion lands with the first view-model test in Task 3.
        #expect(Bool(true))
    }
}
