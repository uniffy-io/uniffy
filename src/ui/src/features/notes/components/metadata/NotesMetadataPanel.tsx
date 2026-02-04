import { useState, useMemo } from 'react';
import { useAppSelector, useAppDispatch } from '@/app/hooks';
import { setMetadataPanelTab } from '@/features/notes/store/editorSlice';
import type { MetadataPanelTab } from '@/features/notes/store/editorSlice';
import {
  Link,
  Gear,
  Sparkle,
  Clock,
  ListBullets,
  Hash,
  FileText,
  Cube,
} from '@phosphor-icons/react';
import { parseUrn, urnToPath, UrnType } from '@/shared/utils/urn';
import { useNavigate } from 'react-router-dom';
import { getContentTypeConfig } from '@/config/theme/contentTypes';

/** Parsed mention from content */
interface ParsedMention {
  label: string;
  urn: string;
  type: UrnType;
}

/** Parse mentions from markdown content using [[[label|urn]]] pattern */
function parseMentionsFromContent(content: string): ParsedMention[] {
  const mentionRegex = /\[\[\[([^\]|]+)\|([^\]]+)\]\]\]/g;
  const mentions: ParsedMention[] = [];
  const seenUrns = new Set<string>();

  let match;
  while ((match = mentionRegex.exec(content)) !== null) {
    const [, label, urn] = match;
    // Deduplicate by URN
    if (!seenUrns.has(urn)) {
      seenUrns.add(urn);
      const parsed = parseUrn(urn);
      mentions.push({
        label,
        urn,
        type: parsed.type,
      });
    }
  }

  return mentions;
}

/** Get icon component for URN type */
function getTypeIcon(type: UrnType) {
  return getContentTypeConfig(type).icon;
}

/** Get type-specific styling */
function getTypeStyle(type: UrnType) {
  const theme = getContentTypeConfig(type).theme;
  return { bg: theme.badgeBg, text: theme.accentText };
}

/** Get initials from a name */
function getInitials(name: string): string {
  return name
    .split(' ')
    .map(part => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export function NotesMetadataPanel() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { currentNoteId, notes } = useAppSelector((state) => state.notes);
  const editorState = useAppSelector((state) => state.editor);
  const currentUser = useAppSelector((state) => state.auth.user);
  const metadataPanelTab = editorState?.metadataPanelTab || 'links';

  // State for showing copy feedback - must be declared before any conditional returns
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Get the note (may be undefined)
  const note = currentNoteId ? notes[currentNoteId] : undefined;

  // Get the actual content (draft or saved) - compute before useMemo to ensure consistent hook order
  const draftContent = editorState?.draftContent || {};
  const currentContent = currentNoteId && note
    ? (draftContent[currentNoteId] ?? note.content)
    : '';

  // Parse outgoing links (mentions) from content - MUST be called before any returns
  const outgoingLinks = useMemo(
    () => parseMentionsFromContent(currentContent),
    [currentContent]
  );

  // Early returns AFTER all hooks
  if (!currentNoteId || !note) return null;

  // Check if current user is the owner
  const isOwner = currentUser && note.ownerId === currentUser.id;
  const ownerName = isOwner
    ? (currentUser.fullName || currentUser.username || 'You')
    : 'Unknown';
  const ownerInitials = getInitials(ownerName);

  const tabs: Array<{ id: MetadataPanelTab; label: string; icon: typeof Link }> = [
    { id: 'outline', label: 'Outline', icon: ListBullets },
    { id: 'links', label: 'Links', icon: Link },
    { id: 'properties', label: 'Properties', icon: Gear },
    { id: 'ai', label: 'AI', icon: Sparkle },
    { id: 'history', label: 'History', icon: Clock },
  ];

  // Parse headings from markdown content
  const parseHeadings = (content: string) => {
    const headingRegex = /^(#{1,6})\s+(.+)$/gm;
    const headings: Array<{ level: number; text: string; id: string }> = [];
    let match;

    while ((match = headingRegex.exec(content)) !== null) {
      const level = match[1].length;
      const text = match[2].trim();
      // Create an id from the heading text
      const id = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      headings.push({ level, text, id });
    }

    return headings;
  };

  const headings = parseHeadings(currentContent);

  // Handle clicking on an outgoing link
  const handleLinkClick = (urn: string) => {
    const path = urnToPath(urn);
    if (path !== '#') {
      navigate(path);
    }
  };

  // Generate the anchor link URL for a heading
  const getHeadingAnchorUrl = (headingId: string) => {
    const baseUrl = window.location.origin + window.location.pathname;
    return `${baseUrl}#${headingId}`;
  };

  // Copy the anchor link to clipboard
  const handleCopyLink = async (e: React.MouseEvent, headingId: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    const url = getHeadingAnchorUrl(headingId);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(headingId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error('Failed to copy link:', err);
    }
  };

  const handleHeadingClick = (e: React.MouseEvent, headingText: string, headingId: string) => {
    e.preventDefault();
    
    // Update the URL hash without triggering a page reload
    window.history.pushState(null, '', `#${headingId}`);
    
    // Find the heading in the editor and scroll to it
    const editorElement = document.querySelector('.crepe-editor .milkdown, .crepe-editor .ProseMirror');
    if (!editorElement) return;
    
    // Find all heading elements
    const allHeadings = editorElement.querySelectorAll('h1, h2, h3, h4, h5, h6');
    for (const heading of allHeadings) {
      if (heading.textContent?.trim() === headingText) {
        heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
        
        // Try to focus the editor and position cursor at the heading
        // This works with ProseMirror-based editors
        const proseMirror = editorElement.closest('.ProseMirror') || editorElement.querySelector('.ProseMirror');
        if (proseMirror && (proseMirror as HTMLElement).focus) {
          (proseMirror as HTMLElement).focus();
        }
        break;
      }
    }
  };

  const renderOutlineTab = () => (
    <div className="space-y-2">
      {headings.length === 0 ? (
        <div className="text-center py-8">
          <ListBullets size={32} weight="duotone" className="mx-auto text-muted-foreground/50 mb-3" />
          <p className="text-sm text-muted-foreground">No headings found</p>
          <p className="text-xs text-muted-foreground mt-1">
            Add headings (# H1, ## H2, etc.) to see the outline
          </p>
        </div>
      ) : (
        <>
          <p className="text-xs text-muted-foreground mb-3">
            {headings.length} heading{headings.length !== 1 ? 's' : ''}
          </p>
          <nav className="space-y-0.5">
            {headings.map((heading, index) => (
              <div
                key={`${heading.id}-${index}`}
                className="group flex items-center gap-1 rounded-md hover:bg-accent transition-colors"
                style={{ paddingLeft: `${(heading.level - 1) * 12}px` }}
              >
                <a
                  href={`#${heading.id}`}
                  onClick={(e) => handleHeadingClick(e, heading.text, heading.id)}
                  className="flex-1 py-1.5 px-2 text-sm truncate"
                  title={heading.text}
                >
                  <span className={`${
                    heading.level === 1 ? 'font-semibold' : 
                    heading.level === 2 ? 'font-medium' : 
                    'text-muted-foreground'
                  }`}>
                    {heading.text}
                  </span>
                </a>
                <button
                  onClick={(e) => handleCopyLink(e, heading.id)}
                  className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-muted transition-all"
                  title={copiedId === heading.id ? 'Copied!' : 'Copy link'}
                >
                  {copiedId === heading.id ? (
                    <svg className="h-3.5 w-3.5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <Hash size={14} weight="bold" className="text-muted-foreground" />
                  )}
                </button>
              </div>
            ))}
          </nav>
        </>
      )}
    </div>
  );

  const renderLinksTab = () => (
    <div className="space-y-6">
      {/* Outgoing Links Section */}
      <div>
        <h4 className="flex items-center gap-2 text-sm font-semibold mb-3">
          <span className="uppercase tracking-wider text-muted-foreground">Outgoing Links</span>
          <span className="px-1.5 py-0.5 text-xs rounded-full bg-muted text-muted-foreground">
            {outgoingLinks.length} reference{outgoingLinks.length !== 1 ? 's' : ''}
          </span>
        </h4>
        {outgoingLinks.length === 0 ? (
          <div className="text-center py-6">
            <Link size={32} weight="duotone" className="mx-auto text-muted-foreground/50 mb-3" />
            <p className="text-sm text-muted-foreground">No outgoing links</p>
            <p className="text-xs text-muted-foreground mt-1">
              Use @ mentions to link to other content
            </p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {outgoingLinks.map((link) => {
              const Icon = getTypeIcon(link.type);
              const style = getTypeStyle(link.type);
              return (
                <button
                  key={link.urn}
                  onClick={() => handleLinkClick(link.urn)}
                  className={`
                    flex items-center gap-2 px-3 py-1.5 rounded-lg
                    border border-border hover:border-primary/50
                    ${style.bg} hover:bg-accent/50
                    transition-colors text-sm group
                  `}
                  title={`Open: ${link.label}`}
                >
                  <span className={`${style.text} transition-transform group-hover:scale-110`}>
                    <Icon size={16} weight="duotone" />
                  </span>
                  <span className="truncate max-w-[150px]">{link.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Backlinks Section */}
      <div>
        <h4 className="flex items-center gap-2 text-sm font-semibold mb-3">
          <span className="uppercase tracking-wider text-muted-foreground">Backlinks</span>
          <span className="px-1.5 py-0.5 text-xs rounded-full bg-muted text-muted-foreground">
            Coming soon
          </span>
        </h4>
        <div className="text-center py-6 border border-dashed border-border rounded-lg">
          <FileText size={32} weight="duotone" className="mx-auto text-muted-foreground/50 mb-3" />
          <p className="text-sm text-muted-foreground">Backlinks coming soon</p>
          <p className="text-xs text-muted-foreground mt-1">
            See which notes link to this one
          </p>
        </div>
      </div>

      {/* Graph View Preview */}
      <div>
        <h4 className="uppercase tracking-wider text-xs font-semibold text-muted-foreground mb-3">
          Graph View
        </h4>
        <div className="aspect-square rounded-lg bg-muted/30 border border-dashed border-border flex items-center justify-center">
          <div className="text-center p-4">
            <Cube size={32} weight="duotone" className="mx-auto text-muted-foreground/50 mb-2" />
            <p className="text-xs text-muted-foreground">Graph view coming soon</p>
          </div>
        </div>
      </div>
    </div>
  );

  const renderPropertiesTab = () => (
    <div className="space-y-4">
      {/* Owner */}
      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1">Owner</label>
        <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
          <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center text-xs text-primary-foreground font-medium">
            {ownerInitials}
          </div>
          <span className="text-sm">
            {ownerName}
            {isOwner && <span className="text-muted-foreground ml-1">(you)</span>}
          </span>
        </div>
      </div>
      
      {/* Created */}
      {note.createdAt && (
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">Created</label>
          <p className="text-sm p-2 rounded-md bg-muted/50">
            {new Date(Number(note.createdAt.seconds) * 1000).toLocaleDateString('en-US', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </p>
        </div>
      )}
      
      {/* Updated */}
      {note.updatedAt && (
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">Last Updated</label>
          <p className="text-sm p-2 rounded-md bg-muted/50">
            {new Date(Number(note.updatedAt.seconds) * 1000).toLocaleString()}
          </p>
        </div>
      )}

      {/* Word Count */}
      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1">Statistics</label>
        <div className="text-sm p-2 rounded-md bg-muted/50 space-y-1">
          <p>{currentContent.split(/\s+/).filter(Boolean).length} words</p>
          <p>{currentContent.length} characters</p>
        </div>
      </div>
      
      {/* Tags */}
      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-2">Tags</label>
        {note.tags && note.tags.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {note.tags.map((tag: string) => (
              <span
                key={tag}
                className="px-2 py-1 text-xs rounded-md bg-muted text-muted-foreground"
              >
                #{tag}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground italic">No tags</p>
        )}
      </div>
    </div>
  );

  const renderAITab = () => (
    <div className="space-y-4">
      <div className="p-4 rounded-lg bg-gradient-to-br from-purple-500/10 to-blue-500/10 border border-purple-500/20">
        <div className="flex items-center gap-2 mb-3">
          <Sparkle size={20} weight="duotone" className="text-purple-500" />
          <h4 className="font-semibold">Ask AI about this note</h4>
        </div>
        <p className="text-sm text-muted-foreground mb-3">
          Summarize, find related, extract tasks...
        </p>
        <div className="space-y-2">
          <button className="w-full text-left px-3 py-2 text-sm rounded-md bg-background/50 hover:bg-background transition-colors">
            📝 Summarize this note
          </button>
          <button className="w-full text-left px-3 py-2 text-sm rounded-md bg-background/50 hover:bg-background transition-colors">
            ✅ Extract action items
          </button>
          <button className="w-full text-left px-3 py-2 text-sm rounded-md bg-background/50 hover:bg-background transition-colors">
            🔗 Find related notes
          </button>
          <button className="w-full text-left px-3 py-2 text-sm rounded-md bg-background/50 hover:bg-background transition-colors">
            💡 Suggest improvements
          </button>
        </div>
      </div>
    </div>
  );

  const renderHistoryTab = () => (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Version history for this note</p>

      {/* Current version info */}
      {note.updatedAt && (
        <div className="p-3 rounded-lg border border-border bg-muted/30">
          <div className="flex items-center justify-between">
            <span className="font-medium text-sm">Current version</span>
            <span className="text-xs text-muted-foreground">
              {new Date(Number(note.updatedAt.seconds) * 1000).toLocaleString()}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">by {ownerName}</p>
        </div>
      )}

      {/* Coming soon placeholder */}
      <div className="text-center py-6 border border-dashed border-border rounded-lg">
        <Clock size={32} weight="duotone" className="mx-auto text-muted-foreground/50 mb-3" />
        <p className="text-sm text-muted-foreground">Full version history coming soon</p>
        <p className="text-xs text-muted-foreground mt-1">
          Track changes and restore previous versions
        </p>
      </div>
    </div>
  );

  const renderContent = () => {
    switch (metadataPanelTab) {
      case 'outline':
        return renderOutlineTab();
      case 'links':
        return renderLinksTab();
      case 'properties':
        return renderPropertiesTab();
      case 'ai':
        return renderAITab();
      case 'history':
        return renderHistoryTab();
      default:
        return renderOutlineTab();
    }
  };
  
  return (
    <div className="h-full flex flex-col">
      {/* Tabs */}
      <div className="flex border-b border-border">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => dispatch(setMetadataPanelTab(id))}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-3 text-sm font-medium transition-colors relative ${
              metadataPanelTab === id
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon size={16} weight="duotone" />
            <span className="hidden xl:inline">{label}</span>
            {metadataPanelTab === id && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {renderContent()}
      </div>
    </div>
  );
}
