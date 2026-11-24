// Disposable macOS window for the desktop-control trial. It never activates, so it stays
// behind whatever the person is using, and it writes what reaches it to the result file.
import AppKit

let environment = ProcessInfo.processInfo.environment
let result = URL(fileURLWithPath: environment["JACKALOPE_DESKTOP_FIXTURE_RESULT"] ?? "/dev/null")
func report(_ text: String) { try? text.write(to: result, atomically: true, encoding: .utf8) }

final class Fixture: NSObject, NSApplicationDelegate, NSTextFieldDelegate {
    var window: NSWindow!
    let field = NSTextField(frame: NSRect(x: 24, y: 90, width: 420, height: 28))
    func applicationDidFinishLaunching(_ notification: Notification) {
        window = NSWindow(contentRect: NSRect(x: 80, y: 80, width: 480, height: 180), styleMask: [.titled], backing: .buffered, defer: false)
        window.title = environment["JACKALOPE_DESKTOP_FIXTURE_TITLE"] ?? "Jackalope desktop fixture"
        field.delegate = self
        field.setAccessibilityLabel("Trial text")
        let button = NSButton(title: "Fixture button", target: self, action: #selector(press))
        button.frame = NSRect(x: 24, y: 30, width: 160, height: 32)
        window.contentView?.addSubview(field)
        window.contentView?.addSubview(button)
        // Visible on the Space the person is using, even beside a full-screen app.
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        window.orderFrontRegardless()
        // The fixture closes itself so an interrupted run never leaves a window behind.
        DispatchQueue.main.asyncAfter(deadline: .now() + 120) { NSApp.terminate(nil) }
    }
    @objc func press() { report("button invoked") }
    func controlTextDidChange(_ notification: Notification) { report(field.stringValue) }
}

let app = NSApplication.shared
let fixture = Fixture()
app.delegate = fixture
app.setActivationPolicy(.regular)
app.run()
