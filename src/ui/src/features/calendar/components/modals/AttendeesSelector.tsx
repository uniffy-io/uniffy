import { useState, useEffect, useRef } from 'react';
import { useAppSelector } from '@/app/hooks';
import type { MemberInfo } from '@/gen/common/v1/common_pb';
import { organizationApi } from '@/features/calendar/api/organizationApi';
import { User, X } from '@phosphor-icons/react';
import type { Attendee } from '@/features/calendar/types';

interface AttendeesSelectorProps {
  attendees: Attendee[];
  onAdd: (member: MemberInfo) => void;
  onRemove: (userId: string) => void;
}

export function AttendeesSelector({ attendees, onAdd, onRemove }: AttendeesSelectorProps) {
  const currentOrgId = useAppSelector((state) => state.auth.currentOrganizationId);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MemberInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const searchMembers = async () => {
      if (!currentOrgId || !query.trim()) {
        setResults([]);
        return;
      }

      setIsLoading(true);
      try {
        const response = await organizationApi.listMembers({
          organizationId: currentOrgId,
          search: query,
          pagination: { page: 1, pageSize: 5 },
        });
        
        // Filter out already selected members
        const existingIds = new Set(attendees.map(a => a.id));
        setResults(response.members.filter(m => !existingIds.has(m.userId)));
      } catch (error) {
        console.error('Failed to search members', error);
      } finally {
        setIsLoading(false);
      }
    };

    const timeoutId = setTimeout(searchMembers, 300);
    return () => clearTimeout(timeoutId);
  }, [query, currentOrgId, attendees]);

  // Handle outside click to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowResults(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (member: MemberInfo) => {
    onAdd(member);
    setQuery('');
    setShowResults(false);
  };

  return (
    <div className="space-y-2" ref={containerRef}>
      
      {/* Search Input */}
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none">
          <User size={16} weight="duotone" className="text-muted-foreground" />
        </div>
        <input
          type="text"
          className="w-full pl-8 pr-3 py-1.5 text-sm bg-muted/50 border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder="Add people..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShowResults(true);
          }}
          onFocus={() => setShowResults(true)}
        />
        
        {/* Dropdown */}
        {showResults && (query.length > 0 || results.length > 0) && (
          <div className="absolute z-10 w-full mt-1 bg-card border border-border rounded-md shadow-lg max-h-48 overflow-y-auto">
            {isLoading ? (
              <div className="p-2 text-xs text-muted-foreground text-center">Loading...</div>
            ) : results.length === 0 ? (
              <div className="p-2 text-xs text-muted-foreground text-center">No members found</div>
            ) : (
              <ul>
                {results.map(member => (
                  <button 
                    type="button"
                    key={member.userId}
                    className="w-full px-3 py-2 text-sm hover:bg-muted cursor-pointer flex items-center justify-between text-left"
                    onClick={() => handleSelect(member)}
                  >
                    <span className="font-medium text-foreground">{member.displayName || member.email}</span>
                    <span className="text-xs text-muted-foreground">{member.email}</span>
                  </button>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Selected Attendees Chips */}
      {attendees.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2">
          {attendees.map(attendee => (
             <div key={attendee.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs border border-primary/20">
               <span>
                  {attendee.name || attendee.email}
               </span>
               <button 
                 type="button"
                 onClick={() => onRemove(attendee.id)}
                 className="hover:text-primary-foreground hover:bg-primary rounded-full p-0.5 ml-1 transition-colors"
               >
                 <X size={12} weight="bold" />
               </button>
             </div>
          ))}
        </div>
      )}
    </div>
  );
}
