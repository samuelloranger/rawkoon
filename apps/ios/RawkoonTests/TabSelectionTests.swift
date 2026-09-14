@testable import Rawkoon
import Testing

struct TabSelectionTests {
    @Test func homeStaysForAdmin() {
        #expect(RootTabSelection.validated("home", isAdmin: true) == "home")
    }

    @Test func homeFallsBackWhenNotAdmin() {
        #expect(RootTabSelection.validated("home", isAdmin: false) == "library")
    }

    @Test func alwaysVisibleTabsSurvive() {
        for tab in ["discover", "library", "activity", "settings"] {
            #expect(RootTabSelection.validated(tab, isAdmin: false) == tab)
            #expect(RootTabSelection.validated(tab, isAdmin: true) == tab)
        }
    }

    @Test func unknownFallsBackToLibrary() {
        #expect(RootTabSelection.validated("nope", isAdmin: true) == "library")
        #expect(RootTabSelection.validated("", isAdmin: false) == "library")
    }
}
