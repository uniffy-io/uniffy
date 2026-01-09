import { useState, useEffect } from 'react';
import { createClient } from "@connectrpc/connect";
import { AuthService } from "@/gen/auth/v1/auth_connect";
import { AdminOrganizationInfo } from "@/gen/auth/v1/auth_pb";
import { useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { transport } from "@/config";
import { XMarkIcon } from '@heroicons/react/24/outline';

interface OrganizationEditDialogProps {
  org?: AdminOrganizationInfo | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
}

export function OrganizationEditDialog({ org, isOpen, onClose, onSave }: OrganizationEditDialogProps) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [domain, setDomain] = useState('');
  const [plan, setPlan] = useState('free');
  const [isActive, setIsActive] = useState(true);
  const [loading, setLoading] = useState(false);
  const { accessToken } = useAppSelector((state) => state.auth);

  useEffect(() => {
    if (isOpen) {
      if (org) {
        setName(org.name);
        setSlug(org.slug);
        setDomain(org.domain || '');
        setPlan(org.plan);
        setIsActive(org.isActive);
      } else {
        setName('');
        setSlug('');
        setDomain('');
        setPlan('free');
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
      const client = createClient(AuthService, transport);
      if (org) {
        // Edit mode
        await client.updateOrganization(
          {
            organizationId: org.id,
            name,
            domain: domain || undefined,
            plan,
            isActive
          },
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
      } else {
        // Create mode
        await client.adminCreateOrganization(
          {
            name,
            slug,
            domain: domain || undefined,
            plan
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
            <XMarkIcon className="h-5 w-5" />
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
            <label className="block text-sm font-semibold">Domain</label>
            <input
              type="text"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="acme.com"
              className="w-full px-3 py-2 border border-input bg-background rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
            />
            <p className="text-xs text-muted-foreground">Optional: Custom domain for this organization</p>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-semibold">Plan *</label>
            <select
              value={plan}
              onChange={(e) => setPlan(e.target.value)}
              className="w-full px-3 py-2 border border-input bg-background rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all capitalize"
            >
              <option value="free">Free</option>
              <option value="pro">Pro</option>
              <option value="enterprise">Enterprise</option>
            </select>
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
