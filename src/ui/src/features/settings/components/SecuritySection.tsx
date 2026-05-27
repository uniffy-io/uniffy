import { useState } from 'react';
import { HardDrives, Warning } from '@phosphor-icons/react';
import { createClient } from '@connectrpc/connect';
import { unaryTransport } from '@/config/api';
import { AuthService } from '@uniffy/proto/auth/v1/auth_pb';
import { useAppSelector } from '@/app/hooks';
import {
  clearLocalEncryptedStorage,
  rotateAndClearAll,
  isStorageEncryptionReady,
} from '@/shared/crypto/storageEncryption';
import { MfaSettingsCard } from '@/features/mfa/components/MfaSettingsCard';
import { SessionsSection } from '@/features/settings/components/SessionsSection';
import { toast } from 'sonner';

export function SecuritySection() {
  const { user } = useAppSelector((state) => state.auth);
  const [clearingDevice, setClearingDevice] = useState(false);
  const [clearingAll, setClearingAll] = useState(false);
  const [showConfirmAll, setShowConfirmAll] = useState(false);

  const encryptionReady = isStorageEncryptionReady();

  const handleClearDevice = async () => {
    setClearingDevice(true);
    try {
      await clearLocalEncryptedStorage();
      toast.success('Local cache cleared. Data will reload from the server.');
    } catch {
      toast.error('Failed to clear local cache.');
    } finally {
      setClearingDevice(false);
    }
  };

  const handleClearAllDevices = async () => {
    setClearingAll(true);
    try {
      const client = createClient(AuthService, unaryTransport);
      const response = await client.rotateCacheKeySeed({});
      if (response.newCacheKeySeed.length > 0 && user) {
        await rotateAndClearAll(new Uint8Array(response.newCacheKeySeed), user.id);
      }
      toast.success('Encryption key rotated. All device caches have been invalidated.');
    } catch {
      toast.error('Failed to rotate encryption key.');
    } finally {
      setClearingAll(false);
      setShowConfirmAll(false);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-foreground mb-2">Security</h1>
        <p className="text-sm text-muted-foreground">
          Manage client-side data encryption and cached content.
        </p>
      </div>

      <MfaSettingsCard />

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-foreground">Client-Side Data</h2>
        <div className="bg-card rounded-lg border border-border p-4 md:p-6 space-y-4">
          <div className="flex items-start gap-3">
            <HardDrives size={20} weight="duotone" className="text-muted-foreground mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p className="text-sm text-foreground">
                Uniffy caches content locally on your devices for faster access.
                All cached data is encrypted at rest using AES-256-GCM.
              </p>
              <p className="text-xs text-muted-foreground">
                {encryptionReady
                  ? 'Encryption is active on this device.'
                  : 'Encryption is not initialized on this device.'}
              </p>
            </div>
          </div>

          <div className="border-t border-border pt-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-foreground">Clear This Device</p>
                <p className="text-xs text-muted-foreground">
                  Removes cached data from this browser. Data will reload from the server.
                </p>
              </div>
              <button
                type="button"
                onClick={handleClearDevice}
                disabled={clearingDevice || !encryptionReady}
                className="shrink-0 px-4 py-2 text-sm font-medium rounded-md border border-border
                  bg-card text-foreground hover:bg-accent transition-colors
                  disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {clearingDevice ? 'Clearing...' : 'Clear This Device'}
              </button>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-foreground">Clear All Devices</p>
                <p className="text-xs text-muted-foreground">
                  Rotates your encryption key, making cached data on all devices unreadable on next login.
                </p>
              </div>
              {!showConfirmAll ? (
                <button
                  type="button"
                  onClick={() => setShowConfirmAll(true)}
                  disabled={clearingAll}
                  className="shrink-0 px-4 py-2 text-sm font-medium rounded-md
                    bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400
                    hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors
                    disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Clear All Devices
                </button>
              ) : (
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setShowConfirmAll(false)}
                    disabled={clearingAll}
                    className="px-3 py-2 text-sm rounded-md border border-border
                      bg-card text-foreground hover:bg-accent transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleClearAllDevices}
                    disabled={clearingAll}
                    className="px-3 py-2 text-sm font-medium rounded-md
                      bg-red-600 text-white hover:bg-red-700 transition-colors
                      disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                  >
                    <Warning size={14} />
                    {clearingAll ? 'Rotating...' : 'Confirm'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <SessionsSection />
    </div>
  );
}
