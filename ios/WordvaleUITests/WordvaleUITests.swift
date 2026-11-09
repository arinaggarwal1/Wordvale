import XCTest

final class WordvaleUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor
    func testNativeNavigationAndTranscriptionControls() throws {
        let app = XCUIApplication()
        app.launch()

        XCTAssertTrue(app.navigationBars["Wordvale"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["recordAudio"].exists)
        XCTAssertTrue(app.buttons["importAudio"].exists)
        capture(app, name: "Transcribe")

        app.buttons["transcriptionSettings"].tap()
        XCTAssertTrue(app.navigationBars["Transcription settings"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.switches["wordTimestampsToggle"].exists)
        XCTAssertTrue(app.switches["translateToggle"].exists)
        let timestampSwitch = app.switches["wordTimestampsToggle"]
        let originalValue = timestampSwitch.value as? String
        // SwiftUI exposes the entire labeled row as the switch accessibility
        // element. Tap the trailing switch track, not the center of its label.
        timestampSwitch.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
        capture(app, name: "Word timestamps enabled")
        XCTAssertNotEqual(timestampSwitch.value as? String, originalValue)
        timestampSwitch.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
        XCTAssertEqual(timestampSwitch.value as? String, originalValue)
        capture(app, name: "Settings")

        app.tabBars.buttons["Library"].tap()
        XCTAssertTrue(app.navigationBars["Library"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.searchFields.firstMatch.exists)
        capture(app, name: "Library")

        app.tabBars.buttons["Models"].tap()
        XCTAssertTrue(app.navigationBars["Models"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Download once. Transcribe offline."].exists)
        XCTAssertTrue(app.staticTexts["Base"].exists)
        capture(app, name: "Models")
    }

    @MainActor
    func testFileImporterCanBeCancelled() throws {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.buttons["importAudio"].waitForExistence(timeout: 10))
        app.buttons["importAudio"].tap()
        let cancel = app.buttons["Cancel"].firstMatch
        XCTAssertTrue(cancel.waitForExistence(timeout: 10))
        cancel.tap()
        XCTAssertTrue(app.buttons["recordAudio"].waitForExistence(timeout: 5))
    }

    @MainActor
    private func capture(_ app: XCUIApplication, name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
