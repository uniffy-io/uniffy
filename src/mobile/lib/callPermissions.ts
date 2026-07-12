import { PermissionsAndroid, Platform, type Permission } from "react-native";

export interface CallPermissionResult {
  micGranted: boolean;
  cameraGranted: boolean;
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
