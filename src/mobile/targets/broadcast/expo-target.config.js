// ReplayKit Broadcast Upload Extension. Every Swift file in this folder is
// compiled into the target, and the bundle id extends the app's own. The App
// Group is stated here rather than mirrored from app.json: the extension and
// the app resolve the frame socket from it, so both must carry the same group
// (also the constant in SampleHandler.swift).
/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = {
  type: "broadcast-upload",
  name: "UniffyBroadcast",
  displayName: "Uniffy",
  bundleIdentifier: ".broadcast",
  deploymentTarget: "15.1",
  frameworks: ["ReplayKit"],
  entitlements: {
    "com.apple.security.application-groups": ["group.com.uniffy.app"],
  },
};
