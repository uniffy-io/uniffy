// Derived from the Jitsi Meet SDK broadcast extension sample (Apache License 2.0).
import ReplayKit

private enum Constants {
  // Must match ios.entitlements["com.apple.security.application-groups"] and
  // RTCAppGroupIdentifier in app.json; both processes resolve the socket path
  // from it.
  static let appGroupIdentifier = "group.com.uniffy.app"
  // ReplayKit delivers up to 60 frames a second; every third is plenty for a
  // shared screen and keeps the extension well under its memory cap.
  static let frameDivisor = 3
}

// Runs in the extension process. Frames go over a unix socket in the App Group
// container to the app, where react-native-webrtc's ScreenCapturer turns them
// into a video track. The app learns about start and stop through Darwin
// notifications, since it cannot observe this process any other way.
class SampleHandler: RPBroadcastSampleHandler {
  private var clientConnection: SocketConnection?
  private var uploader: SampleUploader?
  private var frameCount = 0

  private var socketFilePath: String {
    let container = FileManager.default.containerURL(
      forSecurityApplicationGroupIdentifier: Constants.appGroupIdentifier
    )
    return container?.appendingPathComponent("rtc_SSFD").path ?? ""
  }

  override init() {
    super.init()
    if let connection = SocketConnection(filePath: socketFilePath) {
      clientConnection = connection
      setupConnection()
      uploader = SampleUploader(connection: connection)
    }
  }

  override func broadcastStarted(withSetupInfo setupInfo: [String: NSObject]?) {
    frameCount = 0
    DarwinNotificationCenter.shared.postNotification(.broadcastStarted)
    openConnection()
  }

  override func broadcastPaused() {}

  override func broadcastResumed() {}

  override func broadcastFinished() {
    DarwinNotificationCenter.shared.postNotification(.broadcastStopped)
    clientConnection?.close()
  }

  override func processSampleBuffer(_ sampleBuffer: CMSampleBuffer, with sampleBufferType: RPSampleBufferType) {
    guard sampleBufferType == .video else { return }
    frameCount += 1
    if frameCount % Constants.frameDivisor == 0 {
      uploader?.send(sample: sampleBuffer)
    }
  }
}

private extension SampleHandler {
  func setupConnection() {
    clientConnection?.didClose = { [weak self] error in
      if let error = error {
        self?.finishBroadcastWithError(error)
      } else {
        // The app closed the socket: the share was stopped from the call. An
        // NSError reads as a plain message in the system UI, an Error does not.
        let stopped = NSError(
          domain: RPRecordingErrorDomain,
          code: 10001,
          userInfo: [NSLocalizedDescriptionKey: "Screen sharing stopped"]
        )
        self?.finishBroadcastWithError(stopped)
      }
    }
  }

  // The app creates the socket only once it publishes the share, which happens
  // after this process reported itself started, so the connect has to retry.
  func openConnection() {
    let queue = DispatchQueue(label: "broadcast.connectTimer")
    let timer = DispatchSource.makeTimerSource(queue: queue)
    timer.schedule(deadline: .now(), repeating: .milliseconds(100), leeway: .milliseconds(500))
    timer.setEventHandler { [weak self] in
      guard self?.clientConnection?.open() == true else { return }
      timer.cancel()
    }
    timer.resume()
  }
}
