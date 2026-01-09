import { useState, useEffect } from 'react';
import { createClient } from "@connectrpc/connect";
import { AuthService } from "@/gen/auth/v1/auth_connect";
import { GroupInfo } from "@/gen/auth/v1/auth_pb";
import { useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { transport } from "@/config";

interface GroupEditDialogProps {
  group: GroupInfo;
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
}

export function GroupEditDialog({ group, isOpen, onClose, onSave }: GroupEditDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [isDefault, setIsDefault] = useState(false);
  const [loading, setLoading] = useState(false);
  
  const { accessToken } = useAppSelector((state) => state.auth);

  useEffect(() => {
    if (group && isOpen) {
      setName(group.name);
      setDescription(group.description || '');
      setIsPrivate(group.isPrivate);
      setIsDefault(group.isDefault);
    }
  }, [group, isOpen]);

  if (!isOpen) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken) return;
    setLoading(true);
    
    try {
      const client = createClient(AuthService, transport);
      await client.updateGroup(
        {
          groupId: group.id,
          name,
          description: description || undefined,
          isPrivate,
          isDefault,
        },
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      onSave();
      onClose();
    } catch (err: any) {
      console.error('Failed to update group:', err);
      alert(`Failed to update group: ${err.message || 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm overflow-y-auto py-10">
      <div className="bg-background w-full max-w-lg rounded-lg shadow-lg border border-border p-6 animate-in fade-in zoom-in duration-200">
        <h2 className="text-xl font-bold mb-6">Edit Group: {group.name}</h2>
        
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Group Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full p-2 border border-input bg-background rounded focus:ring-2 focus:ring-ring outline-none"
            />
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
                id="edit-isPrivate"
                checked={isPrivate}
                onChange={(e) => setIsPrivate(e.target.checked)}
                className="h-4 w-4"
              />
              <label htmlFor="edit-isPrivate" className="text-sm font-medium">Private (Invite Only)</label>
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="edit-isDefault"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
                className="h-4 w-4"
              />
              <label htmlFor="edit-isDefault" className="text-sm font-medium">Default (Auto-join new members)</label>
            </div>
          </div>

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
