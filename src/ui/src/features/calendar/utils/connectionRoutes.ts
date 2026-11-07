/** Query parameter the calendar page reads to open the connected accounts dialog. */
export const CONNECTIONS_PARAM = "connections";

const ALL_CONNECTIONS = "all";

/** The calendar page with the connected accounts dialog open, on one account when named. */
export function connectionsPath(connectionId?: string, basePath = "/calendar"): string {
  const [path, query = ""] = basePath.split("?", 2);
  const params = new URLSearchParams(query);
  params.set(CONNECTIONS_PARAM, connectionId || ALL_CONNECTIONS);
  return `${path}?${params.toString()}`;
}

/** The account a `?connections=` value names; null opens the dialog on every account. */
export function focusedConnectionId(value: string): string | null {
  return value === ALL_CONNECTIONS ? null : value;
}
