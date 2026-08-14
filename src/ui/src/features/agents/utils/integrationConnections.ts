/** Provider id -> pinned org connection id. Empty means automatic resolution. */
export type IntegrationConnectionPins = Record<string, string>;

export const parseIntegrationConnections = (json: string): IntegrationConnectionPins => {
  if (!json) return {};
  try {
    const raw: unknown = JSON.parse(json);
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
    const pins: IntegrationConnectionPins = {};
    for (const [provider, connectionId] of Object.entries(raw)) {
      if (typeof connectionId === "string" && connectionId) {
        pins[provider] = connectionId;
      }
    }
    return pins;
  } catch {
    return {};
  }
};
