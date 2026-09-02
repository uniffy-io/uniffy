import ExpoModulesCore
import ReplayKit

// iOS captures the screen in a separate broadcast extension process, which only
// starts once the user taps Start in the system picker. getDisplayMedia resolves
// regardless, with a track that never receives a frame, so the app has to wait
// for the extension itself before publishing. The extension announces itself
// with Darwin notifications; this module presents the picker and turns those
// notifications into one promise.
public class ScreenSharePickerModule: Module {
  private static let startedNotification = "iOS_BroadcastStarted"
  private static let stoppedNotification = "iOS_BroadcastStopped"
  // Written into the app's Info.plist by app.json; react-native-webrtc reads the
  // same keys to know which extension the picker should offer and where the
  // frame socket lives.
  private static let extensionKey = "RTCScreenSharingExtension"
  private static let appGroupKey = "RTCAppGroupIdentifier"

  private var pending: Promise?
  private var timeout: DispatchWorkItem?
  private var picker: RPSystemBroadcastPickerView?
  private var observing = false

  public func definition() -> ModuleDefinition {
    Name("ScreenSharePicker")

    Function("isAvailable") { () -> Bool in
      return Self.preferredExtension != nil && Self.appGroupReachable
    }

    AsyncFunction("present") { (timeoutMs: Int, promise: Promise) in
      self.present(timeoutMs: timeoutMs, promise: promise)
    }.runOnQueue(.main)

    OnDestroy {
      self.stopObserving()
    }
  }

  private static var preferredExtension: String? {
    return Bundle.main.object(forInfoDictionaryKey: extensionKey) as? String
  }

  // The plist keys travel with the app config, but the shared container only
  // exists when the binary was signed with the App Group entitlement. A build
  // without it (a Personal Team, for one) would still start the extension and
  // publish a share that never receives a frame, so the container is part of
  // "available".
  private static var appGroupReachable: Bool {
    guard let group = Bundle.main.object(forInfoDictionaryKey: appGroupKey) as? String,
      let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)
    else {
      return false
    }
    return FileManager.default.fileExists(atPath: container.path)
  }

  private func present(timeoutMs: Int, promise: Promise) {
    guard let preferredExtension = Self.preferredExtension, Self.appGroupReachable else {
      promise.reject("E_UNAVAILABLE", "This build cannot share its screen")
      return
    }
    if pending != nil {
      promise.reject("E_BUSY", "The broadcast picker is already open")
      return
    }
    guard let window = UIApplication.shared.connectedScenes
      .compactMap({ $0 as? UIWindowScene })
      .flatMap({ $0.windows })
      .first(where: { $0.isKeyWindow })
    else {
      promise.reject("E_NO_WINDOW", "No window to present the picker from")
      return
    }

    startObserving()

    // The system view is a button that presents the picker sheet when tapped.
    // It has to be in a window for the sheet to appear, but it needs no size
    // and no visibility of its own: the tap is sent programmatically.
    let picker = RPSystemBroadcastPickerView(frame: CGRect(x: 0, y: 0, width: 1, height: 1))
    picker.preferredExtension = preferredExtension
    picker.showsMicrophoneButton = false
    picker.isUserInteractionEnabled = false
    picker.alpha = 0
    window.addSubview(picker)
    self.picker = picker
    self.pending = promise

    guard let button = picker.subviews.compactMap({ $0 as? UIButton }).first else {
      finish { promise.reject("E_PICKER", "The system picker exposed no button") }
      return
    }

    let timeout = DispatchWorkItem { [weak self] in
      self?.finish { promise.reject("E_TIMEOUT", "The broadcast was not started") }
    }
    self.timeout = timeout
    DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(timeoutMs), execute: timeout)

    button.sendActions(for: .touchUpInside)
  }

  private func finish(_ settle: () -> Void) {
    timeout?.cancel()
    timeout = nil
    picker?.removeFromSuperview()
    picker = nil
    pending = nil
    settle()
  }

  private func handle(notification name: String) {
    DispatchQueue.main.async { [weak self] in
      guard let self, let promise = self.pending else { return }
      if name == Self.startedNotification {
        self.finish { promise.resolve() }
      } else if name == Self.stoppedNotification {
        self.finish { promise.reject("E_CANCELLED", "The broadcast stopped before it started") }
      }
    }
  }

  private func startObserving() {
    if observing { return }
    observing = true
    let center = CFNotificationCenterGetDarwinNotifyCenter()
    let observer = Unmanaged.passUnretained(self).toOpaque()
    for name in [Self.startedNotification, Self.stoppedNotification] {
      CFNotificationCenterAddObserver(
        center,
        observer,
        { _, observer, name, _, _ in
          guard let observer, let name else { return }
          let module = Unmanaged<ScreenSharePickerModule>.fromOpaque(observer).takeUnretainedValue()
          module.handle(notification: name.rawValue as String)
        },
        name as CFString,
        nil,
        .deliverImmediately
      )
    }
  }

  private func stopObserving() {
    guard observing else { return }
    observing = false
    let observer = Unmanaged.passUnretained(self).toOpaque()
    CFNotificationCenterRemoveEveryObserver(CFNotificationCenterGetDarwinNotifyCenter(), observer)
  }
}
