// ReplayKit Broadcast Upload Extension. Every Swift file in this folder is
// compiled into the target; the App Group is mirrored from app.json's
// ios.entitlements, and the bundle id extends the app's own.
/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = {
  type: "broadcast-upload",
  name: "UniffyBroadcast",
  displayName: "Uniffy",
  bundleIdentifier: ".broadcast",
  deploymentTarget: "15.1",
  frameworks: ["ReplayKit"],
};
