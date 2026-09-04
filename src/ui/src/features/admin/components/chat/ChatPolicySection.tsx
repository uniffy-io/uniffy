import { useCallback, useEffect, useState } from "react";
import { ChatCircle, Warning } from "@phosphor-icons/react";
import { toast } from "sonner";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";
import { friendlyErrorMessage } from "@/config";
import { chatApi } from "@/features/chat/api/chatApi";
import { setOrgChatPolicy } from "@/features/chat/store/chatChannelsSlice";
import { chatPolicyToPlain } from "@/features/chat/store/chatThunks";
import { NumberInput } from "@/components/ui/number-input";
import { Select, type SelectOption } from "@/components/ui/select";
import { ChatBroadcastMinRole, ChatEditHistoryVisibility } from "@uniffy/proto/chat/v1/chat_pb";

interface PolicyForm {
  broadcastMinRole: ChatBroadcastMinRole;
  broadcastConfirmThreshold: number;
  editWindowMinutes: number | null;
  editHistoryVisibleTo: ChatEditHistoryVisibility;
  // Toggled on the admin Agents page; carried here so a full-policy save
  // round-trips it (proto3 bool would otherwise reset it to false).
  agentsEnabled: boolean;
}

const MIN_ROLE_OPTIONS: SelectOption<ChatBroadcastMinRole>[] = [
  { value: ChatBroadcastMinRole.MEMBER, label: "Every channel member" },
  { value: ChatBroadcastMinRole.ADMIN, label: "Channel and org admins only" },
];

const UNLIMITED_EDIT_WINDOW = "unlimited";

const EDIT_WINDOW_PRESETS: SelectOption<string>[] = [
  { value: "0", label: "Editing disabled" },
  { value: "5", label: "5 minutes" },
  { value: "15", label: "15 minutes" },
  { value: "60", label: "1 hour" },
  { value: "1440", label: "24 hours" },
  { value: UNLIMITED_EDIT_WINDOW, label: "Unlimited" },
];

function editWindowOptions(current: number | null): SelectOption<string>[] {
  if (current === null || EDIT_WINDOW_PRESETS.some((o) => o.value === String(current))) {
    return EDIT_WINDOW_PRESETS;
  }
  return [...EDIT_WINDOW_PRESETS, { value: String(current), label: `${current} minutes` }];
}

const EDIT_HISTORY_OPTIONS: SelectOption<ChatEditHistoryVisibility>[] = [
  { value: ChatEditHistoryVisibility.ADMINS, label: "Sender and admins" },
  { value: ChatEditHistoryVisibility.EVERYONE, label: "Everyone in the channel" },
];

export function ChatPolicySection() {
  useDocumentTitle("Chat");
  const dispatch = useAppDispatch();
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const role = useAppSelector((state) => state.auth.currentOrganizationRole);
  const isAdmin = role === "OWNER" || role === "ADMIN";

  const [form, setForm] = useState<PolicyForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await chatApi.getChatPolicy({ organizationId });
      const policy = response.policy;
      setForm(
        policy
          ? {
              broadcastMinRole: policy.broadcastMinRole,
              broadcastConfirmThreshold: policy.broadcastConfirmThreshold,
              editWindowMinutes: policy.editWindowMinutes ?? null,
              editHistoryVisibleTo: policy.editHistoryVisibleTo,
              agentsEnabled: policy.agentsEnabled,
            }
          : null,
      );
    } catch (err) {
      setError(
        friendlyErrorMessage(err instanceof Error ? err.message : String(err)) ??
          "Could not load chat policy",
      );
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    // eslint-disable-next-line react/react-compiler -- fetch on mount; reload raises the loading flag before awaiting the API
    void reload();
  }, [reload]);

  const save = async () => {
    if (!organizationId || !form || saving) return;
    setSaving(true);
    try {
      const response = await chatApi.updateChatPolicy({
        organizationId,
        broadcastMinRole: form.broadcastMinRole,
        broadcastConfirmThreshold: form.broadcastConfirmThreshold,
        editWindowMinutes: form.editWindowMinutes ?? undefined,
        editHistoryVisibleTo: form.editHistoryVisibleTo,
        agentsEnabled: form.agentsEnabled,
      });
      const policy = response.policy;
      if (policy) {
        setForm({
          broadcastMinRole: policy.broadcastMinRole,
          broadcastConfirmThreshold: policy.broadcastConfirmThreshold,
          editWindowMinutes: policy.editWindowMinutes ?? null,
          editHistoryVisibleTo: policy.editHistoryVisibleTo,
          agentsEnabled: policy.agentsEnabled,
        });
        // Keep the chat surfaces' gates in sync without a reload.
        dispatch(setOrgChatPolicy(chatPolicyToPlain(policy)));
      }
      toast.success("Chat policy saved");
    } catch (err) {
      toast.error(
        friendlyErrorMessage(err instanceof Error ? err.message : String(err)) ??
          "Could not save chat policy",
      );
    } finally {
      setSaving(false);
    }
  };

  const disabled = !isAdmin || saving;

  return (
    <div className="space-y-6 w-full mx-auto max-w-3xl">
      <div>
        <div className="flex items-center gap-3 mb-2">
          <ChatCircle size={24} weight="duotone" className="text-primary shrink-0" />
          <h1 className="text-xl md:text-2xl font-bold">Chat</h1>
        </div>
        <p className="text-muted-foreground text-sm">
          Organization-wide chat behavior. Broadcast mentions (@channel, @here) notify a whole
          channel at once, so who may send them and when the composer asks for confirmation are
          policy decisions. Message editing follows the same idea: the edit window and edit-history
          visibility apply to every channel.
        </p>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-surface shadow-edge">
          <div className="flex items-center gap-2 text-sm" style={{ color: "var(--status-error)" }}>
            <Warning size={20} weight="fill" />
            {error}
          </div>
        </div>
      )}

      {loading || !form ? (
        <div className="rounded-xl bg-surface shadow-edge p-6 text-sm text-muted-foreground">
          Loading...
        </div>
      ) : (
        <div className="rounded-xl bg-surface shadow-edge divide-y divide-border">
          <div className="flex items-start gap-4 p-5">
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-foreground">
                Who can send broadcast mentions
              </h3>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                @channel pings every member and @here everyone online. Restricting them to admins
                keeps large channels quiet.
              </p>
            </div>
            <div className="shrink-0">
              <Select
                value={form.broadcastMinRole}
                onChange={(v) =>
                  setForm((prev) => (prev ? { ...prev, broadcastMinRole: v } : prev))
                }
                options={MIN_ROLE_OPTIONS}
                disabled={disabled}
                triggerClassName="w-full sm:w-64"
              />
            </div>
          </div>

          <div className="flex items-start gap-4 p-5">
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-foreground">Confirmation threshold</h3>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                Channels with more members than this ask the sender to confirm before a broadcast
                mention goes out. 0 always asks.
              </p>
            </div>
            <div className="shrink-0">
              <NumberInput
                value={form.broadcastConfirmThreshold}
                min={0}
                max={10000}
                disabled={disabled}
                onChange={(e) => {
                  const parsed = Number(e.target.value);
                  if (Number.isNaN(parsed)) return;
                  const clamped = Math.min(10000, Math.max(0, Math.round(parsed)));
                  setForm((prev) =>
                    prev ? { ...prev, broadcastConfirmThreshold: clamped } : prev,
                  );
                }}
                className="w-28"
              />
            </div>
          </div>

          <div className="flex items-start gap-4 p-5">
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-foreground">Message edit window</h3>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                How long senders may edit a message after posting it. Every edit keeps the prior
                version in the message's edit history.
              </p>
            </div>
            <div className="shrink-0">
              <Select
                value={
                  form.editWindowMinutes === null
                    ? UNLIMITED_EDIT_WINDOW
                    : String(form.editWindowMinutes)
                }
                onChange={(v) =>
                  setForm((prev) =>
                    prev
                      ? {
                          ...prev,
                          editWindowMinutes: v === UNLIMITED_EDIT_WINDOW ? null : Number(v),
                        }
                      : prev,
                  )
                }
                options={editWindowOptions(form.editWindowMinutes)}
                disabled={disabled}
                triggerClassName="w-full sm:w-64"
              />
            </div>
          </div>

          <div className="flex items-start gap-4 p-5">
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-foreground">Who can view edit history</h3>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                The sender, channel admins, and org admins always can. Opening it to everyone lets
                any member who can read the message see its prior versions.
              </p>
            </div>
            <div className="shrink-0">
              <Select
                value={form.editHistoryVisibleTo}
                onChange={(v) =>
                  setForm((prev) => (prev ? { ...prev, editHistoryVisibleTo: v } : prev))
                }
                options={EDIT_HISTORY_OPTIONS}
                disabled={disabled}
                triggerClassName="w-full sm:w-64"
              />
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={disabled || !form}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? "Saving..." : "Save changes"}
        </button>
        {!isAdmin && (
          <span className="text-xs text-muted-foreground">
            You need owner or admin role to change these settings.
          </span>
        )}
      </div>
    </div>
  );
}
