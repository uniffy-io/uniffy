let held = false;

/**
 * Accepting an invitation and picking an organization both switch the session, and the last switch
 * to finish wins, so every screen shares this one claim. Returns the release, or null while another
 * action holds it.
 */
export function claimOrganizationSwitch(): (() => void) | null {
  if (held) return null;
  held = true;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    held = false;
  };
}
