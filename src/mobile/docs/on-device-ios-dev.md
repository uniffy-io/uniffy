# Running the mobile app on a physical iPhone (macOS)

How to get the Uniffy dev build onto an iPhone from a Mac, talking to the staging backend, and
what the calls feature needs from the native side. Follow **Each session** every time; the
**One-time** section explains the prerequisites and the why.

## Reference values

| Thing | Value |
|---|---|
| App bundle id | `com.uniffy.app` |
| Broadcast extension bundle id | `com.uniffy.app.broadcast` |
| App Group | `group.com.uniffy.app` |
| App URL scheme | `uniffy` |
| Metro port | `8081` |
| Default server | `https://staging.uniffy.io` (the login screen's preset) |

## One-time (per Mac)

1. Xcode with the command line tools, license accepted. An iOS 26 device needs Xcode 26.
2. An Apple Developer Program team. The broadcast extension needs an App Group, which a free
   Personal Team cannot provision; put the team id in `app.json` under `ios.appleTeamId` so
   `expo run:ios` and the extension target sign without prompting.
3. `brew install node@22 watchman cocoapods`, then `corepack enable` and
   `corepack prepare pnpm@11.20.0 --activate`.
4. On the iPhone: Settings, Privacy & Security, Developer Mode on. Same Wi-Fi as the Mac.
5. Code and dependencies (the Mac is a local stack; no containers run here):

   ```bash
   git clone git@github.com:uniffy-io/uniffy.git && cd uniffy
   pnpm install --filter uniffy-mobile...
   ```

   The generated TypeScript proto is committed, so no codegen is needed on the Mac.

## Each session

1. **Build and install** (regenerates the gitignored `ios/`, installs pods, builds, installs the
   dev client, starts Metro). Needed again after any native change: `app.json`, `modules/`,
   `targets/`, or a dependency with native code.

   ```bash
   cd src/mobile
   npx expo run:ios --device
   ```

   Pick the phone when asked. If signing fails, open `ios/Uniffy.xcworkspace`, select the
   Uniffy target and the UniffyBroadcast target, and set the team on both.

2. **JS-only changes** reload over Metro. With the dev client already installed:

   ```bash
   cd src/mobile
   npx expo start --dev-client
   ```

   Open the app; it connects to Metro over the LAN.

3. **Log in** against staging (the default server URL) and run the "Calls: mobile client"
   section of `/TESTING.md`.

## Screen sharing on iOS

iOS captures the screen in a separate ReplayKit Broadcast Upload Extension process. The pieces:

- `targets/broadcast/` - the extension target, generated into the Xcode project by
  `@bacons/apple-targets` at prebuild. Its `SampleHandler` sends frames over a unix socket in the
  App Group container to the app, where `@livekit/react-native-webrtc` turns them into a track.
- `modules/screen-share-picker/` - a local Expo module that presents the system broadcast picker
  and resolves once the extension reports it has started. The share button only appears when the
  installed binary carries the extension (`RTCScreenSharingExtension` in the app's Info.plist).
- `app.json` - the App Group entitlement and the two Info.plist keys react-native-webrtc reads.

Nothing in the flow is app-visible before the user taps Start in the picker. Stopping happens from
the red status pill, from the in-call button, or when the call ends; each path closes the socket
and the other side follows.

## Troubleshooting

- **No share button in a call** - the installed binary predates the extension. Rebuild with
  `npx expo run:ios --device`; a Metro reload cannot add a target.
- **Picker shows but no "Uniffy" entry** - the extension target did not sign or did not install.
  Check both targets in Xcode share the team and that the App Group is enabled on each.
- **Broadcast starts, remote side sees nothing** - the App Group differs between the app and the
  extension. `RTCAppGroupIdentifier` in `app.json` and `Constants.appGroupIdentifier` in
  `targets/broadcast/SampleHandler.swift` must be the same string.
- **Blank camera preview in the pre-join** - the pre-join must be a flow child in `_layout`, not
  a Modal; RTCView paints no frames inside a native Modal on the iOS new architecture.
- **Signing prompt every build** - set `ios.appleTeamId` in `app.json`.
