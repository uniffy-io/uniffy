import { useState, useEffect } from 'react';
import { createClient } from "@connectrpc/connect";
import { useNavigate } from 'react-router-dom';
import { AuthService } from "@/gen/auth/v1/auth_connect";
import { OrganizationInfo } from "@/gen/auth/v1/auth_pb";
import { Button } from "@/components/ui/button";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { setCredentials, logout } from "../store/authSlice";
import { resetSettings } from "@/features/settings/store/settingsSlice";
import { clearNotes } from "@/features/notes/store/notesSlice";
import { clearTree } from "@/features/notes/store/notesTreeSlice";
import { setAccentColor, setFontFamily } from "@/theme/themeSlice";
import { transport, setMemoryAccessToken, clearMemoryAccessToken } from "@/config";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

export default function OrganizationPicker() {
  useDocumentTitle('Select Organization');
  const [organizations, setOrganizations] = useState<OrganizationInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const accessToken = useAppSelector((state) => state.auth?.accessToken);
  const refreshToken = useAppSelector((state) => state.auth?.refreshToken);
  const user = useAppSelector((state) => state.auth?.user);

  useEffect(() => {
    if (!accessToken) {
      navigate('/auth');
      return;
    }

    const fetchOrgs = async () => {
      try {
        const client = createClient(AuthService, transport);
        const response = await client.listMyOrganizations(
          {},
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        setOrganizations(response.organizations);
      } catch (err: unknown) {
        console.error('Failed to list organizations:', err);
        setError('Failed to load organizations.');
      } finally {
        setLoading(false);
      }
    };

    fetchOrgs();
  }, [accessToken, navigate]);

  const handleSelectOrg = async (orgSlug: string) => {
    if (!refreshToken) {
      setError("Session expired. Please login again.");
      return;
    }

    setLoading(true);
    try {
      const client = createClient(AuthService, transport);
      // Refresh token with the selected organization slug to get an org-scoped token
      const response = await client.refreshToken({
        refreshToken: refreshToken,
        organizationSlug: orgSlug,
      });

      // Store access token in memory (security: not persisted to localStorage)
      setMemoryAccessToken(response.accessToken);

      // Update credentials with new token and organization ID
      // We assume user info is same, but we update tokens
      if (user) {
        // Sync theme preferences from user profile
        if (user.accentColor) {
          dispatch(setAccentColor(user.accentColor));
        }
        if (user.fontFamily) {
          dispatch(setFontFamily(user.fontFamily));
        }

        dispatch(setCredentials({
          user: user, // Keep existing user info
          accessToken: response.accessToken,
          refreshToken: response.refreshToken,
          organizationId: response.organizationId,
        }));
      }

      navigate('/');
    } catch (err: unknown) {
      console.error('Failed to select organization:', err);
      setError('Failed to switch to organization.');
      setLoading(false);
    }
  };

  const handleLogout = () => {
    // Clear memory access token (security: remove from memory)
    clearMemoryAccessToken();
    // Clear all user/org-specific state
    dispatch(logout());
    dispatch(resetSettings());
    dispatch(clearNotes());
    dispatch(clearTree());
    // Navigate to auth page
    navigate('/auth');
  };

  if (loading) {
    return <div className="text-center p-8">Loading organizations...</div>;
  }

  return (
    <div className="w-full max-w-md mx-auto p-8 border border-border rounded-xl shadow-sm bg-card text-card-foreground">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-2xl font-bold text-primary">Select Workspace</h1>
        <Button variant="ghost" size="sm" onClick={handleLogout}>Logout</Button>
      </div>

      {error && (
        <div className="bg-destructive/10 border border-destructive/20 text-destructive p-4 rounded mb-6 text-sm">
          {error}
        </div>
      )}

      {organizations.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-muted-foreground mb-4">You are not a member of any organization.</p>
          <Button variant="outline">Create New Organization</Button>
        </div>
      ) : (
        <div className="space-y-3">
          {organizations.map((org) => (
            <button
              key={org.id}
              onClick={() => handleSelectOrg(org.slug)}
              className="w-full text-left p-4 border border-input rounded hover:bg-accent hover:text-accent-foreground transition-colors flex justify-between items-center group"
            >
              <div>
                <div className="font-semibold">{org.name}</div>
                <div className="text-xs text-muted-foreground capitalize">{org.role.toLowerCase()}</div>
              </div>
              <div className="opacity-0 group-hover:opacity-100 transition-opacity text-primary">
                →
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
