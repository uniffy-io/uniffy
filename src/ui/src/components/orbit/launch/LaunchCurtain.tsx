import { createPortal } from "react-dom";
import { useLaunchCurtain } from "@/components/orbit/launch/launchCurtain";
import "@/components/orbit/launch/launchCurtain.css";

/** The portal from the organization picker or the onboarding flow into the app. */
export function LaunchCurtain() {
  const origin = useLaunchCurtain();
  if (!origin) return null;
  return createPortal(<div className="orbit-curtain" aria-hidden />, document.body);
}
