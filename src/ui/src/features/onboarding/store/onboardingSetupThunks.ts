import { createAsyncThunk, type ThunkAction, type UnknownAction } from "@reduxjs/toolkit";
import type { OrganizationRole } from "@uniffy/proto/common/v1/common_pb";
import type { AppDispatch, RootState } from "@/app/store";
import { friendlyErrorMessage } from "@/config/errorMessages";
import { invitationsApi } from "@/features/admin/api/invitationsApi";
import {
  fetchRuntimeSettings,
  saveRuntimeSettings,
} from "@/features/admin/store/agentRuntimeSettingsThunks";
import {
  addProviderKey,
  fetchModelsForKey,
  removeProviderKey,
} from "@/features/agents/store/agentProvidersThunks";

const thunk = createAsyncThunk.withTypes<{
  state: RootState;
  dispatch: AppDispatch;
  rejectValue: string;
}>();

export type ProviderConnection =
  | { status: "connected"; keyId: string; modelName: string | null }
  | { status: "rejected"; keyId: string; error: string }
  | { status: "failed" };

/**
 * Adds the owner's first provider key and, while the org has no default model, points the
 * default at the catalog's pick for that provider so NavigatorAgent can answer right away.
 * A key the provider rejected on the previous attempt is removed first, so retries leave no
 * dead rows behind. Every step is an existing thunk, so failures toast once, from that thunk.
 */
export function connectProvider(args: {
  provider: string;
  label: string;
  credential: string;
  replaceKeyId: string | null;
}): ThunkAction<Promise<ProviderConnection>, RootState, unknown, UnknownAction> {
  return async (dispatch) => {
    try {
      if (args.replaceKeyId) await dispatch(removeProviderKey(args.replaceKeyId)).unwrap();
      const key = await dispatch(
        addProviderKey({ provider: args.provider, label: args.label, credential: args.credential }),
      ).unwrap();
      if (!key.isValid) return { status: "rejected", keyId: key.id, error: key.lastError ?? "" };

      const runtime = await dispatch(fetchRuntimeSettings()).unwrap();
      if (runtime.settings.defaultProviderKeyId) {
        return { status: "connected", keyId: key.id, modelName: null };
      }
      const { models } = await dispatch(fetchModelsForKey({ keyId: key.id, force: true })).unwrap();
      const usable = models.filter((model) => model.supportsTools && !model.deprecated);
      const model = usable.find((entry) => entry.providerDefault) ?? usable[0];
      if (!model) return { status: "connected", keyId: key.id, modelName: null };
      await dispatch(
        saveRuntimeSettings({
          ...runtime.settings,
          defaultProviderKeyId: key.id,
          defaultChatModel: model.id,
        }),
      ).unwrap();
      return { status: "connected", keyId: key.id, modelName: model.displayName };
    } catch {
      return { status: "failed" };
    }
  };
}

export interface InviteOutcome {
  email: string;
  /** Null when the invitation went out; otherwise the message to show beside that address. */
  error: string | null;
}

/** One invitation per address; each failure stays beside its address instead of a toast per row. */
export const inviteTeam = thunk<InviteOutcome[], { emails: string[]; role: OrganizationRole }>(
  "onboarding/inviteTeam",
  async ({ emails, role }, { getState }) => {
    const organizationId = getState().auth.currentOrganizationId ?? "";
    const outcomes: InviteOutcome[] = [];
    for (const email of emails) {
      try {
        await invitationsApi.invite({ organizationId, email, role });
        outcomes.push({ email, error: null });
      } catch (error) {
        const message = error instanceof Error ? friendlyErrorMessage(error.message) : null;
        outcomes.push({ email, error: message ?? "Could not invite this address." });
      }
    }
    return outcomes;
  },
);
