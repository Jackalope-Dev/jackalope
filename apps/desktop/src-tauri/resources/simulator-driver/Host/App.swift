import SwiftUI

/// The UI-testing bundle needs a host app; the driver acts on other apps.
@main
struct HostApp: App {
  var body: some Scene {
    WindowGroup { Text("Jackalope simulator driver") }
  }
}
