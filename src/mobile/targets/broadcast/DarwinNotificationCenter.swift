// Derived from the Jitsi Meet SDK broadcast extension sample (Apache License 2.0).
import Foundation

// The only channel from the extension process to the app that needs no socket:
// the app's ScreenSharePicker module observes these two names.
enum DarwinNotification: String {
  case broadcastStarted = "iOS_BroadcastStarted"
  case broadcastStopped = "iOS_BroadcastStopped"
}

class DarwinNotificationCenter {
  static let shared = DarwinNotificationCenter()

  private let notificationCenter: CFNotificationCenter

  init() {
    notificationCenter = CFNotificationCenterGetDarwinNotifyCenter()
  }

  func postNotification(_ name: DarwinNotification) {
    CFNotificationCenterPostNotification(
      notificationCenter,
      CFNotificationName(rawValue: name.rawValue as CFString),
      nil,
      nil,
      true
    )
  }
}
