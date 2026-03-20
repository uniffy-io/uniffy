import { useState, useEffect } from 'react';
import { createClient } from "@connectrpc/connect";
import { OrganizationsService } from "@uniffy/proto/organizations/v1/organizations_connect";
import { OrganizationDetail } from "@uniffy/proto/organizations/v1/organizations_pb";
import { useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { transport } from "@/config";
import { X } from '@phosphor-icons/react';

interface OrganizationEditDialogProps {
  org?: OrganizationDetail | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
}

export function OrganizationEditDialog({ org, isOpen, onClose, onSave }: OrganizationEditDialogProps) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [loading, setLoading] = useState(false);
  const { accessToken } = useAppSelector((state) => state.auth);

  useEffect(() => {
    if (isOpen) {
      if (org?.organization) {
        setName(org.organization.name);
        setSlug(org.organization.slug);
        setLogoUrl(org.organization.logoUrl || '');
        setIsActive(org.isActive);
      } else {
        setName('');
        setSlug('');
        setLogoUrl('');
        setIsActive(true);
      }
    }
  }, [isOpen, org]);

  if (!isOpen) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken) return;
    setLoading(true);

    try {
      const client = createClient(OrganizationsService, transport);
      if (org?.organization) {
        // Edit mode
        await client.updateOrganization(
          {
            organizationId: org.organization.id,
            name,
            slug,
            logoUrl: logoUrl || undefined,
            isActive
          },
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
      } else {
        // Create mode
        await client.createOrganization(
          {
            name,
            slug,
            logoUrl: logoUrl || undefined
          },
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
      }
      onSave();
      onClose();
    } catch (err) {
      console.error('Failed to save organization:', err);
      alert('Failed to save organization');
    } finally {
      setLoading(false);
    }
  };

  const isEdit = !!org;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-background w-full max-w-lg rounded-xl shadow-2xl border border-border overflow-hidden animate-in zoom-in duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-muted/30">
          <h2 className="text-xl font-bold">{isEdit ? 'Edit Organization' : 'Create Organization'}</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 hover:bg-muted transition-colors"
          >
            <X size={20} weight="bold" />
          </button>
        </div>
        
        {/* Body */}
        <form onSubmit={handleSave} className="p-6 space-y-5">
          <div className="space-y-2">
            <label className="block text-sm font-semibold">Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full px-3 py-2 border border-input bg-background rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
              placeholder="Acme Corporation"
            />
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-semibold">Slug *</label>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              required
              disabled={isEdit}
              className="w-full px-3 py-2 border border-input bg-background rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              placeholder="acme-corp"
            />
            {isEdit && <p className="text-xs text-muted-foreground">Slug cannot be changed after creation</p>}
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-semibold">Logo URL</label>
            <input
              type="text"
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="https://example.com/logo.png"
              className="w-full px-3 py-2 border border-input bg-background rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
            />
            <p className="text-xs text-muted-foreground">Optional: Logo URL for this organization</p>
          </div>

          {isEdit && (
            <div className="flex items-center gap-3 p-4 rounded-lg border border-border bg-muted/30">
              <input
                type="checkbox"
                id="isActive"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
              />
              <label htmlFor="isActive" className="text-sm font-medium cursor-pointer">
                Organization is active
              </label>
            </div>
          )}

          {/* Footer */}
          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" size="md" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" size="md" disabled={loading}>
              {loading ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Organization'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
