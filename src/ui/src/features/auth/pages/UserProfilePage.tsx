import { useState, useEffect } from 'react';
import { UserCircleIcon } from '@heroicons/react/24/outline';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { setCredentials } from '@/features/auth/store/authSlice';
import { setAccentColor, setFontFamily } from '@/theme/themeSlice';
import { AccentColorPicker } from '@/components/ui/accent-color-picker';
import { FontPicker } from '@/components/ui/font-picker';
import { createClient } from '@connectrpc/connect';
import { AuthService } from '@/gen/auth/v1/auth_connect';
import { transport } from '@/config/api';

export default function UserProfilePage() {
  const dispatch = useAppDispatch();
  const { user, accessToken, refreshToken, currentOrganizationId } = useAppSelector((state) => state.auth);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const client = createClient(AuthService, transport);

  // Set accent color and font from user data on mount
  useEffect(() => {
    if (user?.accentColor) {
      dispatch(setAccentColor(user.accentColor));
    }
    if (user?.fontFamily) {
      dispatch(setFontFamily(user.fontFamily));
    }
  }, [user?.accentColor, user?.fontFamily, dispatch]);

  const handleAccentColorChange = async (color: string) => {
    if (!user || !accessToken) return;

    setSaving(true);
    setSaveMessage(null);

    try {
      // Update Redux state immediately for instant UI feedback
      dispatch(setAccentColor(color || null));

      // Call API to persist the change with authentication header
      const response = await client.updateMyProfile(
        {
          accentColor: color || '',
        },
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      // Convert protobuf response to plain object for Redux
      const plainUser = {
        id: response.id,
        email: response.email,
        username: response.username,
        fullName: response.fullName,
        isActive: response.isActive,
        isSystemAdmin: response.isSystemAdmin,
        emailVerified: response.emailVerified,
        accentColor: response.accentColor,
        fontFamily: response.fontFamily,
      };

      // Update user data in Redux with the updated info
      if (accessToken && refreshToken) {
        dispatch(setCredentials({
          user: plainUser,
          accessToken: accessToken,
          refreshToken: refreshToken,
          organizationId: currentOrganizationId || undefined,
        }));
      }

      setSaveMessage({ type: 'success', text: 'Accent color saved successfully!' });
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (error) {
      console.error('Failed to update accent color:', error);
      setSaveMessage({ type: 'error', text: 'Failed to save accent color. Please try again.' });
      setTimeout(() => setSaveMessage(null), 3000);
    } finally {
      setSaving(false);
    }
  };

  const handleFontFamilyChange = async (font: string) => {
    if (!user || !accessToken) return;

    setSaving(true);
    setSaveMessage(null);

    try {
      // Update Redux state immediately for instant UI feedback
      dispatch(setFontFamily(font || null));

      // Call API to persist the change with authentication header
      const response = await client.updateMyProfile(
        {
          fontFamily: font || '',
        },
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      // Convert protobuf response to plain object for Redux
      const plainUser = {
        id: response.id,
        email: response.email,
        username: response.username,
        fullName: response.fullName,
        isActive: response.isActive,
        isSystemAdmin: response.isSystemAdmin,
        emailVerified: response.emailVerified,
        accentColor: response.accentColor,
        fontFamily: response.fontFamily,
      };

      // Update user data in Redux with the updated info
      if (accessToken && refreshToken) {
        dispatch(setCredentials({
          user: plainUser,
          accessToken: accessToken,
          refreshToken: refreshToken,
          organizationId: currentOrganizationId || undefined,
        }));
      }

      setSaveMessage({ type: 'success', text: 'Font family saved successfully!' });
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (error) {
      console.error('Failed to update font family:', error);
      setSaveMessage({ type: 'error', text: 'Failed to save font family. Please try again.' });
      setTimeout(() => setSaveMessage(null), 3000);
    } finally {
      setSaving(false);
    }
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Page Header */}
      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-primary p-3 shadow-lg">
          <UserCircleIcon className="h-7 w-7 text-primary-foreground" />
        </div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Your Profile</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage your account settings and preferences</p>
        </div>
      </div>

      {/* User Information Card */}
      <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-border bg-muted/50">
          <h2 className="text-lg font-semibold text-foreground">Account Information</h2>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-muted-foreground">Full Name</label>
              <p className="mt-1 text-foreground">{user.fullName || 'Not set'}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Username</label>
              <p className="mt-1 text-foreground">{user.username}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Email</label>
              <p className="mt-1 text-foreground">{user.email}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Email Status</label>
              <p className="mt-1">
                {user.emailVerified ? (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                    Verified
                  </span>
                ) : (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
                    Unverified
                  </span>
                )}
              </p>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Account Status</label>
              <p className="mt-1">
                {user.isActive ? (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                    Active
                  </span>
                ) : (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
                    Inactive
                  </span>
                )}
              </p>
            </div>
            {user.isSystemAdmin && (
              <div>
                <label className="text-sm font-medium text-muted-foreground">Role</label>
                <p className="mt-1">
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400">
                    System Admin
                  </span>
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Appearance Settings Card */}
      <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-border bg-muted/50">
          <h2 className="text-lg font-semibold text-foreground">Appearance</h2>
          <p className="text-sm text-muted-foreground mt-1">Customize how UWOS looks for you</p>
        </div>
        <div className="p-6 space-y-8">
          {/* Accent Color Section */}
          <div>
            <AccentColorPicker
              currentColor={user.accentColor || null}
              onColorChange={handleAccentColorChange}
            />
          </div>

          {/* Font Family Section */}
          <div className="border-t border-border pt-8">
            <FontPicker
              currentFont={user.fontFamily || null}
              onFontChange={handleFontFamilyChange}
            />
          </div>
          
          {/* Preview Examples */}
          <div className="border-t border-border pt-8">
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-4">Preview</h3>
              <p className="text-xs text-muted-foreground mb-4">
                See how your accent color looks across the interface
              </p>
              
              <div className="space-y-6">
                {/* Buttons Preview */}
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Buttons</p>
                  <div className="flex flex-wrap gap-2">
                    <button className="inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98] cursor-pointer bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 hover:shadow-md h-9 px-4 text-sm">
                      Primary Button
                    </button>
                    <button className="inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98] cursor-pointer border border-input bg-transparent hover:bg-accent hover:text-accent-foreground h-9 px-4 text-sm">
                      Outlined
                    </button>
                  </div>
                </div>

                {/* Icon Badge Preview */}
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Icons & Badges</p>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="rounded-xl bg-primary p-3 shadow-sm">
                      <svg className="h-6 w-6 text-primary-foreground" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                      </svg>
                    </div>
                    <div className="rounded-lg bg-primary/20 border border-primary/30 px-3 py-1.5">
                      <span className="text-sm font-medium text-primary">Badge</span>
                    </div>
                  </div>
                </div>

                {/* Links Preview */}
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Links & Interactive Elements</p>
                  <div className="space-y-2">
                    <a href="#" className="inline-flex items-center gap-1 text-sm text-primary hover:text-primary/80 transition-colors font-medium">
                      Example Link
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                      </svg>
                    </a>
                    <div className="flex items-center gap-2 p-3 rounded-lg border border-border hover:border-primary hover:bg-primary/5 transition-all cursor-pointer">
                      <div className="h-2 w-2 rounded-full bg-primary animate-pulse"></div>
                      <span className="text-sm text-foreground">Hover over this item</span>
                    </div>
                  </div>
                </div>

                {/* Focus State Preview */}
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Form Elements</p>
                  <input
                    type="text"
                    placeholder="Click to see focus ring..."
                    className="w-full px-3 py-2 border border-input bg-background rounded-lg focus:ring-2 focus:ring-ring focus:border-transparent outline-none transition-all text-sm"
                  />
                </div>
              </div>
            </div>
          </div>
          
          {/* Save Status Message */}
          {saveMessage && (
            <div className={`p-3 rounded-lg ${
              saveMessage.type === 'success' 
                ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-400 border border-green-200 dark:border-green-900/50' 
                : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-400 border border-red-200 dark:border-red-900/50'
            }`}>
              <p className="text-sm font-medium">{saveMessage.text}</p>
            </div>
          )}

          {/* Saving Indicator */}
          {saving && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">\n              <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted border-t-primary"></div>
              <span>Saving...</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
