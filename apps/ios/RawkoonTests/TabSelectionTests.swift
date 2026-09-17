@testable import Rawkoon
import Testing

struct TabSelectionTests {
    @Test func homeStaysForEveryone() {
        #expect(RootTabSelection.validated("home", isAdmin: true) == "home")
        #expect(RootTabSelection.validated("home", isAdmin: false) == "home")
    }

    @Test func alwaysVisibleTabsSurvive() {
        for tab in ["discover", "library", "books", "settings"] {
            #expect(RootTabSelection.validated(tab, isAdmin: false) == tab)
            #expect(RootTabSelection.validated(tab, isAdmin: true) == tab)
        }
    }

    @Test func unknownFallsBackToLibrary() {
        #expect(RootTabSelection.validated("nope", isAdmin: true) == "library")
        #expect(RootTabSelection.validated("", isAdmin: false) == "library")
    }
}
