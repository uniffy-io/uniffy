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
  fetchProviderKeys,
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
  | { status: "no_models"; keyId: string }
  | { status: "failed"; keyId: string | null };

type ProviderConnectionRequest =
  | { keyId: string }
  | { provider: string; label: string; credential: string; replaceKeyId: string | null };

/** Retain a saved key across setup failures so retries never create duplicate keys. */
export function connectProvider(
  args: ProviderConnectionRequest,
): ThunkAction<Promise<ProviderConnection>, RootState, unknown, UnknownAction> {
  return async (dispatch, getState) => {
    let keyId: string | null = "keyId" in args ? args.keyId : null;
    try {
      const state = getState();
      if (
        state.agentProviders.organizationId !== state.auth.currentOrganizationId ||
        (keyId && !state.agentProviders.providerKeys[keyId])
      )
        await dispatch(fetchProviderKeys({ force: true })).unwrap();
      if (!("keyId" in args) && args.replaceKeyId)
        await dispatch(removeProviderKey(args.replaceKeyId)).unwrap();
      const key =
        "keyId" in args
          ? getState().agentProviders.providerKeys[args.keyId]
          : await dispatch(
              addProviderKey({
                provider: args.provider,
                label: args.label,
                credential: args.credential,
              }),
            ).unwrap();
      if (!key || !key.isEnabled) return { status: "failed", keyId };
      if (!key.isValid) return { status: "rejected", keyId: key.id, error: key.lastError ?? "" };
      keyId = key.id;

      const runtime = await dispatch(fetchRuntimeSettings()).unwrap();
      const configuredKey =
        getState().agentProviders.providerKeys[runtime.settings.defaultProviderKeyId];
      if (configuredKey?.isValid && configuredKey.isEnabled && runtime.settings.defaultChatModel) {
        return { status: "connected", keyId: configuredKey.id, modelName: null };
      }
      const { models } = await dispatch(fetchModelsForKey({ keyId: key.id, force: true })).unwrap();
      const usable = models.filter((model) => model.supportsTools && !model.deprecated);
      const model = usable.find((entry) => entry.providerDefault) ?? usable[0];
      if (!model) return { status: "no_models", keyId: key.id };
      await dispatch(
        saveRuntimeSettings({
          ...runtime.settings,
          defaultProviderKeyId: key.id,
          defaultChatModel: model.id,
        }),
      ).unwrap();
      return { status: "connected", keyId: key.id, modelName: model.displayName };
    } catch {
      return { status: "failed", keyId };
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
