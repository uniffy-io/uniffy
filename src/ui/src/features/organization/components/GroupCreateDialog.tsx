import { useState } from 'react';
import { createClient } from "@connectrpc/connect";
import { AuthService } from "@/gen/auth/v1/auth_connect";
import { useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { transport } from "@/config";

interface GroupCreateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  organizationId: string;
}

export function GroupCreateDialog({ isOpen, onClose, onSave, organizationId }: GroupCreateDialogProps) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [isDefault, setIsDefault] = useState(false);
  const [loading, setLoading] = useState(false);
  
  const { accessToken } = useAppSelector((state) => state.auth);

  if (!isOpen) return null;

  // Auto-generate slug from name
  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setName(val);
    // Simple slugify: lowercase, replace spaces with hyphens, remove non-alphanumeric
    const slugVal = val.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    setSlug(slugVal);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken) return;
    setLoading(true);
    
    try {
      const client = createClient(AuthService, transport);
      await client.createGroup(
        {
          organizationId,
          name,
          slug,
          description: description || undefined,
          isPrivate,
          isDefault,
        },
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      onSave();
      onClose();
      // Reset form
      setName('');
      setSlug('');
      setDescription('');
      setIsPrivate(false);
      setIsDefault(false);
    } catch (err: any) {
      console.error('Failed to create group:', err);
      alert(`Failed to create group: ${err.message || 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm overflow-y-auto py-10">
      <div className="bg-background w-full max-w-lg rounded-lg shadow-lg border border-border p-6 animate-in fade-in zoom-in duration-200">
        <h2 className="text-xl font-bold mb-6">Create New Group</h2>
        
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Group Name *</label>
            <input
              type="text"
              value={name}
              onChange={handleNameChange}
              required
              className="w-full p-2 border border-input bg-background rounded focus:ring-2 focus:ring-ring outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Slug *</label>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              required
              className="w-full p-2 border border-input bg-background rounded focus:ring-2 focus:ring-ring outline-none"
            />
            <p className="text-xs text-muted-foreground mt-1">Unique identifier for the group URL</p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full p-2 border border-input bg-background rounded focus:ring-2 focus:ring-ring outline-none min-h-[80px]"
            />
          </div>
          
          <div className="space-y-2 pt-2">
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="create-isPrivate"
                checked={isPrivate}
                onChange={(e) => setIsPrivate(e.target.checked)}
                className="h-4 w-4"
              />
              <label htmlFor="create-isPrivate" className="text-sm font-medium">Private (Invite Only)</label>
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="create-isDefault"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
                className="h-4 w-4"
              />
              <label htmlFor="create-isDefault" className="text-sm font-medium">Default (Auto-join new members)</label>
            </div>
          </div>

          <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-border">
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={loading}>
              {loading ? 'Creating...' : 'Create Group'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
