import { useState, useEffect } from 'react';
import { createClient } from "@connectrpc/connect";
import { AuthService } from "@/gen/auth/v1/auth_connect";
import { AdminOrganizationInfo } from "@/gen/auth/v1/auth_pb";
import { useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { transport } from "@/config";

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-background w-full max-w-lg rounded-lg shadow-lg border border-border p-6 animate-in fade-in zoom-in duration-200">
        <h2 className="text-xl font-bold mb-4">{isEdit ? 'Edit Organization' : 'Create Organization'}</h2>
        
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full p-2 border border-input bg-background rounded focus:ring-2 focus:ring-ring outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Slug</label>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              required
              disabled={isEdit}
              className="w-full p-2 border border-input bg-background rounded focus:ring-2 focus:ring-ring outline-none disabled:opacity-50"
            />
            {isEdit && <p className="text-xs text-muted-foreground mt-1">Slug cannot be changed.</p>}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Domain</label>
            <input
              type="text"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="example.com"
              className="w-full p-2 border border-input bg-background rounded focus:ring-2 focus:ring-ring outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Plan</label>
            <select
              value={plan}
              onChange={(e) => setPlan(e.target.value)}
              className="w-full p-2 border border-input bg-background rounded focus:ring-2 focus:ring-ring outline-none"
            >
              <option value="free">Free</option>
              <option value="pro">Pro</option>
              <option value="enterprise">Enterprise</option>
            </select>
          </div>

          {isEdit && (
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="isActive"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="rounded border-gray-300 text-primary focus:ring-primary h-4 w-4"
              />
              <label htmlFor="isActive" className="text-sm font-medium">Active</label>
            </div>
          )}

          <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-border">
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={loading}>
              {loading ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
