import { useCallback, useEffect, useState } from "react";
import { ChatCircle, Warning } from "@phosphor-icons/react";
import { toast } from "sonner";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";
import { friendlyErrorMessage } from "@/config";
import { chatApi } from "@/features/chat/api/chatApi";
import { setBroadcastPolicy } from "@/features/chat/store/chatChannelsSlice";
import { NumberInput } from "@/components/ui/number-input";
import { Select, type SelectOption } from "@/components/ui/select";
import { ChatBroadcastMinRole } from "@uniffy/proto/chat/v1/chat_pb";

interface PolicyForm {
  broadcastMinRole: ChatBroadcastMinRole;
  broadcastConfirmThreshold: number;
}

const MIN_ROLE_OPTIONS: SelectOption<ChatBroadcastMinRole>[] = [
  { value: ChatBroadcastMinRole.MEMBER, label: "Every channel member" },
  { value: ChatBroadcastMinRole.ADMIN, label: "Channel and org admins only" },
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
      const response = await chatApi.updateChatPolicy({ organizationId, ...form });
      const policy = response.policy;
      if (policy) {
        setForm({
          broadcastMinRole: policy.broadcastMinRole,
          broadcastConfirmThreshold: policy.broadcastConfirmThreshold,
        });
        // Keep the composer's gate in sync without a reload.
        dispatch(
          setBroadcastPolicy({
            minRole: policy.broadcastMinRole === ChatBroadcastMinRole.ADMIN ? "admin" : "member",
            confirmThreshold: policy.broadcastConfirmThreshold,
          }),
        );
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
          policy decisions.
        </p>
      </div>

      {error && (
        <div className="p-4 rounded-lg border border-border">
          <div className="flex items-center gap-2 text-sm" style={{ color: "var(--status-error)" }}>
            <Warning size={20} weight="fill" />
            {error}
          </div>
        </div>
      )}

      {loading || !form ? (
        <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          Loading...
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card divide-y divide-border">
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
