import { useState } from 'react';
import { createClient } from "@connectrpc/connect";
import { AuthService } from "@/gen/auth/v1/auth_connect";
import { useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { transport } from "@/config";
import { XMarkIcon, UserGroupIcon, LockClosedIcon, GlobeAltIcon } from '@heroicons/react/24/outline';
import { cn } from "@/utils/cn";

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-background w-full max-w-lg rounded-xl shadow-2xl border border-border overflow-hidden animate-in zoom-in duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-muted/30">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <UserGroupIcon className="h-5 w-5 text-primary" />
            </div>
            <h2 className="text-xl font-bold">Create New Group</h2>
          </div>
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
            <label className="block text-sm font-semibold">Group Name *</label>
            <input
              type="text"
              value={name}
              onChange={handleNameChange}
              required
              placeholder="Engineering Team"
              className="w-full px-3 py-2 border border-input bg-background rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
            />
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-semibold">Slug *</label>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              required
              placeholder="engineering-team"
              className="w-full px-3 py-2 border border-input bg-background rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
            />
            <p className="text-xs text-muted-foreground">Unique identifier used in URLs (lowercase, hyphens only)</p>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-semibold">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="A brief description of this group's purpose..."
              className="w-full px-3 py-2 border border-input bg-background rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all min-h-[100px] resize-none"
            />
          </div>
          
          <div className="space-y-3 p-4 rounded-lg border border-border bg-muted/20">
            <p className="text-sm font-semibold">Group Settings</p>
            <div className="space-y-3">
              <label className="flex items-start gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  id="create-isPrivate"
                  checked={isPrivate}
                  onChange={(e) => setIsPrivate(e.target.checked)}
                  className="h-4 w-4 mt-0.5 rounded border-gray-300 text-primary focus:ring-primary"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <LockClosedIcon className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium group-hover:text-foreground">Private Group</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">Only invited members can join this group</p>
                </div>
              </label>
              
              <label className="flex items-start gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  id="create-isDefault"
                  checked={isDefault}
                  onChange={(e) => setIsDefault(e.target.checked)}
                  className="h-4 w-4 mt-0.5 rounded border-gray-300 text-primary focus:ring-primary"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <GlobeAltIcon className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium group-hover:text-foreground">Default Group</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">New members automatically join this group</p>
                </div>
              </label>
            </div>
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" size="md" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" size="md" disabled={loading}>
              {loading ? 'Creating...' : 'Create Group'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
