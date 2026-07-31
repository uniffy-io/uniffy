import { ArrowRight, Key, Warning } from "@phosphor-icons/react";
import { useNavigate } from "react-router-dom";
import { useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import {
    selectProviderKeys,
    selectProviderKeysLoaded,
    selectUsableProviderKeys,
} from "@/features/agents/store/agentProvidersSlice";
import { useAgentsBuilderAccess } from "@/features/agents/hooks/useAgentsBuilderAccess";

/**
 * Nothing in the builder can run without one enabled, valid provider key, and a
 * fresh org has none. Keys are org-admin-only, so an AGENTS domain admin gets
 * the same warning without an action they cannot perform.
 */
export function ProviderKeyNotice() {
    const navigate = useNavigate();
    const keysLoaded = useAppSelector(selectProviderKeysLoaded);
    const allKeys = useAppSelector(selectProviderKeys);
    const usableKeys = useAppSelector(selectUsableProviderKeys);
    const { isOrgAdmin } = useAgentsBuilderAccess();

    if (!keysLoaded || usableKeys.length > 0) return null;

    const hasAnyKey = Object.keys(allKeys).length > 0;

    return (
        <div
            className="flex flex-wrap items-center gap-3 border-b border-yellow-300 bg-yellow-100 px-4 py-3 text-yellow-800 dark:border-yellow-900/50 dark:bg-yellow-900/30 dark:text-yellow-400"
            data-testid="agents-provider-key-notice"
            data-notice-kind={hasAnyKey ? "unusable" : "missing"}
        >
            {hasAnyKey ? (
                <Warning size={18} weight="fill" className="shrink-0" />
            ) : (
                <Key size={18} weight="fill" className="shrink-0" />
            )}
            <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                    {hasAnyKey
                        ? "No usable provider key"
                        : "Agents need a provider key to run"}
                </p>
                <p className="mt-0.5 text-xs opacity-90">
                    {hasAnyKey
                        ? "Every key is disabled or failed its last check. Agents cannot answer until one is enabled and valid."
                        : "Connect at least one LLM provider key. Until then agents can be built, but they cannot answer a message."}
                    {!isOrgAdmin && " Ask an organization admin to set this up."}
                </p>
            </div>
            {isOrgAdmin && (
                <Button
                    size="md"
                    variant="warning"
                    onClick={() => navigate("/admin/agents?tab=keys")}
                    data-testid="agents-provider-key-notice-action"
                >
                    <Key size={14} weight="bold" />
                    {hasAnyKey ? "Review keys" : "Add a provider key"}
                    <ArrowRight size={14} />
                </Button>
            )}
        </div>
    );
}
