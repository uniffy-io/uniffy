import { returnPathFrom } from "@/features/auth/utils/returnPath";

/**
 * Where a finished forced enrollment lands: the page the sign-in started from, else home, where
 * ProtectedRoute moves a session without an organization on to the welcome page.
 */
export function pathAfterEnrollment(state: unknown): string {
  return returnPathFrom(state) ?? "/";
}
