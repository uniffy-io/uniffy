import type { ThunkAction, UnknownAction } from "@reduxjs/toolkit";
import { Code, ConnectError } from "@connectrpc/connect";
import type { AppDispatch, RootState } from "@/app/store";
import { friendlyErrorMessage } from "@/config/errorMessages";
import { authApi } from "@/features/auth/api/authApi";
import { completeSignIn, signInResultFrom } from "@/features/auth/store/signInThunks";
import { toSlug } from "@/shared/utils/slug";

export interface DeploymentSetupForm {
  fullName: string;
  email: string;
  password: string;
  organizationName: string;
  organizationSlug: string;
}

export type DeploymentSetupOutcome =
  | { status: "signed-in" }
  | { status: "already-set-up"; message: string }
  | { status: "failed"; message: string };

const SETUP_FAILED = "Setup failed. Try again.";

/** Null when the config call fails, so the page stays where it is instead of guessing. */
export async function readSetupRequired(): Promise<boolean | null> {
  try {
    const response = await authApi.getAuthConfig();
    return response.setupRequired;
  } catch {
    return null;
  }
}

/**
 * Creates the operator and the first organization, then signs in on the returned session. Settles
 * with an outcome instead of rejecting, so the page decides where each message goes.
 */
export function setUpDeployment(
  form: DeploymentSetupForm,
): ThunkAction<Promise<DeploymentSetupOutcome>, RootState, unknown, UnknownAction> {
  return async (dispatch) => {
    try {
      const response = await authApi.setupDeployment({
        email: form.email.trim(),
        password: form.password,
        fullName: form.fullName.trim() || undefined,
        organizationName: form.organizationName.trim(),
        organizationSlug: toSlug(form.organizationSlug) || undefined,
      });
      if (!response.authResult) return { status: "failed", message: SETUP_FAILED };
      await (dispatch as AppDispatch)(
        completeSignIn(signInResultFrom(response.authResult)),
      ).unwrap();
      return { status: "signed-in" };
    } catch (error) {
      const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
      const message = friendlyErrorMessage(raw) ?? SETUP_FAILED;
      if (error instanceof ConnectError && error.code === Code.FailedPrecondition) {
        return { status: "already-set-up", message };
      }
      return { status: "failed", message };
    }
  };
}
