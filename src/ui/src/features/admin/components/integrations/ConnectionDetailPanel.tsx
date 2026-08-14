import { createElement } from "react";
import { CheckCircle, Plugs, XCircle } from "@phosphor-icons/react";
import { formatRelativeTime } from "@/shared/utils/dateFormatting";
import {
  integrationIcon,
  integrationLabel,
} from "@/features/integrations/config/integrationBrands";
import type { ConnectionPlain } from "@/features/integrations/store/integrationsThunks";

function protoTimestampToDateStr(ts?: { seconds: number; nanos: number }): string | undefined {
  if (!ts) return undefined;
  return new Date(ts.seconds * 1000).toISOString();
}

export function ConnectionDetailPanel({ connection }: { connection: ConnectionPlain }) {
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <h3 className="font-medium text-foreground mb-4">Connection Details</h3>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Provider</span>
          <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            {createElement(integrationIcon(connection.provider) ?? Plugs, { size: 16 })}
            {integrationLabel(connection.provider)}
          </span>
        </div>
        {connection.accountLogin && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Account</span>
            <span className="text-sm font-mono text-muted-foreground">
              {connection.accountLogin}
            </span>
          </div>
        )}
        {connection.baseUrl && (
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-muted-foreground shrink-0">API base URL</span>
            <span className="text-sm font-mono text-muted-foreground truncate">
              {connection.baseUrl}
            </span>
          </div>
        )}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <span className="text-sm text-muted-foreground">Hint</span>
            <span className="block text-xs text-muted-foreground">
              The full credential is write-once and cannot be read back.
            </span>
          </div>
          <span className="text-sm font-mono text-muted-foreground shrink-0">
            {connection.credentialHint || "***"}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Status</span>
          <div className="flex items-center gap-1.5">
            {!connection.isEnabled ? (
              <>
                <XCircle size={16} weight="fill" className="text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Disabled</span>
              </>
            ) : connection.isValid ? (
              <>
                <CheckCircle
                  size={16}
                  weight="fill"
                  className="text-green-600 dark:text-green-400"
                />
                <span className="text-xs text-green-600 dark:text-green-400">Valid</span>
              </>
            ) : (
              <>
                <XCircle size={16} weight="fill" className="text-red-600 dark:text-red-400" />
                <span className="text-xs text-red-600 dark:text-red-400">Rejected by provider</span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Last Used</span>
          <span className="text-sm text-muted-foreground">
            {formatRelativeTime(protoTimestampToDateStr(connection.lastUsedAt)) || "Never"}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Last Validated</span>
          <span className="text-sm text-muted-foreground">
            {formatRelativeTime(protoTimestampToDateStr(connection.lastValidatedAt)) || "Never"}
          </span>
        </div>
        {!connection.isValid && connection.lastError && (
          <div className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-100 dark:bg-red-900/30 p-3">
            <XCircle
              size={16}
              weight="fill"
              className="text-red-600 dark:text-red-400 shrink-0 mt-0.5"
            />
            <p className="text-xs text-red-800 dark:text-red-400 break-words">
              {connection.lastError}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
