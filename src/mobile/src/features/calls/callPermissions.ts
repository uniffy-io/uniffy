import { PermissionsAndroid, Platform, type Permission } from "react-native";

export interface CallPermissionResult {
  micGranted: boolean;
  cameraGranted: boolean;
}

const ANDROID_NOTIFICATION_PERMISSION_SDK = 33;

const FOREGROUND_SERVICE_MEDIA_PROJECTION =
  "android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION" as Permission;

/**
 * Screen capture starts react-native-webrtc's mediaProjection foreground service,
 * and Android kills the process outright when the manifest does not carry this
 * permission - a SecurityException on the service thread, which no JS catch can
 * reach. A dev client built before the permission was added runs this bundle, so
 * the control has to be gated on the installed APK rather than on the platform.
 */
export async function isScreenSharePermitted(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  try {
    return await PermissionsAndroid.check(FOREGROUND_SERVICE_MEDIA_PROJECTION);
  } catch {
    return false;
  }
}

// iOS prompts natively from getUserMedia inside the WebRTC stack; Android
// requires an explicit runtime request before capture starts.
export async function ensureCallPermissions(request: {
  mic: boolean;
  camera: boolean;
}): Promise<CallPermissionResult> {
  if (Platform.OS !== "android") {
    return { micGranted: true, cameraGranted: true };
  }
  const wanted: Permission[] = [];
  if (request.mic) wanted.push(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
  if (request.camera) wanted.push(PermissionsAndroid.PERMISSIONS.CAMERA);
  // Asked for on every join, not only when capturing: the call's foreground
  // service posts an ongoing notification, and Android 13 suppresses it without
  // this grant - leaving the app holding the microphone with nothing on screen
  // to say so and no way back into the call.
  if (Number(Platform.Version) >= ANDROID_NOTIFICATION_PERMISSION_SDK) {
    wanted.push(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  }
  if (wanted.length === 0) return { micGranted: true, cameraGranted: true };
  try {
    const results = await PermissionsAndroid.requestMultiple(wanted);
    return {
      micGranted:
        !request.mic ||
        results[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] === PermissionsAndroid.RESULTS.GRANTED,
      cameraGranted:
        !request.camera ||
        results[PermissionsAndroid.PERMISSIONS.CAMERA] === PermissionsAndroid.RESULTS.GRANTED,
    };
  } catch {
    return { micGranted: false, cameraGranted: false };
  }
}
