import { useState } from 'react';
import { useAppSelector, useAppDispatch } from '@/app/hooks';
import { setMetadataPanelTab } from '../../store/editorSlice';
import type { MetadataPanelTab } from '../../store/editorSlice';
import { 
  LinkIcon, 
  Cog6ToothIcon, 
  SparklesIcon, 
  ClockIcon,
  ArrowTopRightOnSquareIcon,
  DocumentTextIcon,
  ListBulletIcon,
  HashtagIcon,
} from '@heroicons/react/24/outline';

// Mock data for demonstration
const mockBacklinks = [
  { id: '1', title: 'Q1 Planning Meeting', preview: '...as outlined in [[Q1 Roadmap]]...', folder: 'Engineering', date: '3 days ago' },
  { id: '2', title: 'Product Roadmap 2026', preview: '...references [[Q1 Roadmap]] for...', folder: 'Product', date: '1 week ago' },
  { id: '3', title: 'Team Standup Notes', preview: '...discussed the [[Q1 Roadmap]]...', folder: 'Engineering', date: 'Yesterday' },
];

const mockOutgoingLinks = [
  { id: '1', title: 'Technical Specs', type: 'note', icon: '📄' },
  { id: '2', title: 'Dashboard Specs', type: 'note', icon: '📄' },
  { id: '3', title: 'budget-2026.xlsx', type: 'file', icon: '📎' },
  { id: '4', title: 'John Davis', type: 'person', icon: '👤' },
];

export function NotesMetadataPanel() {
  const dispatch = useAppDispatch();
  const { currentNoteId, notes } = useAppSelector((state) => state.notes);
  const editorState = useAppSelector((state) => state.editor);
  const metadataPanelTab = editorState?.metadataPanelTab || 'links';
  
  if (!currentNoteId) return null;
  
  const note = notes[currentNoteId];
  if (!note) return null;

  const tabs: Array<{ id: MetadataPanelTab; label: string; icon: typeof LinkIcon }> = [
    { id: 'outline', label: 'Outline', icon: ListBulletIcon },
    { id: 'links', label: 'Links', icon: LinkIcon },
    { id: 'properties', label: 'Properties', icon: Cog6ToothIcon },
    { id: 'ai', label: 'AI', icon: SparklesIcon },
    { id: 'history', label: 'History', icon: ClockIcon },
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

  // Get the actual content (draft or saved)
  const draftContent = editorState?.draftContent || {};
  const currentContent = draftContent[currentNoteId] ?? note.content;
  const headings = parseHeadings(currentContent);

  // State for showing copy feedback
  const [copiedId, setCopiedId] = useState<string | null>(null);

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
          <ListBulletIcon className="h-8 w-8 mx-auto text-muted-foreground/50 mb-3" />
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
                    <HashtagIcon className="h-3.5 w-3.5 text-muted-foreground" />
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
      {/* Backlinks Section */}
      <div>
        <h4 className="flex items-center gap-2 text-sm font-semibold mb-3">
          <span className="uppercase tracking-wider text-muted-foreground">Backlinks</span>
          <span className="px-1.5 py-0.5 text-xs rounded-full bg-muted text-muted-foreground">
            {mockBacklinks.length} notes link here
          </span>
        </h4>
        <div className="space-y-3">
          {mockBacklinks.map((link) => (
            <button
              key={link.id}
              className="w-full text-left p-3 rounded-lg border border-border hover:border-primary/50 hover:bg-accent/50 transition-colors"
            >
              <div className="flex items-start gap-2">
                <DocumentTextIcon className="h-4 w-4 mt-0.5 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{link.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{link.preview}</p>
                  <p className="text-xs text-muted-foreground mt-1">{link.folder} · {link.date}</p>
                </div>
              </div>
            </button>
          ))}
          <button className="text-sm text-primary hover:underline">
            Show 4 more backlinks →
          </button>
        </div>
      </div>

      {/* Outgoing Links Section */}
      <div>
        <h4 className="flex items-center gap-2 text-sm font-semibold mb-3">
          <span className="uppercase tracking-wider text-muted-foreground">Outgoing Links</span>
          <span className="px-1.5 py-0.5 text-xs rounded-full bg-muted text-muted-foreground">
            {mockOutgoingLinks.length} references
          </span>
        </h4>
        <div className="flex flex-wrap gap-2">
          {mockOutgoingLinks.map((link) => (
            <button
              key={link.id}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border hover:border-primary/50 hover:bg-accent/50 transition-colors text-sm"
            >
              <span>{link.icon}</span>
              <span className="truncate max-w-[120px]">{link.title}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Graph View Preview */}
      <div>
        <h4 className="uppercase tracking-wider text-xs font-semibold text-muted-foreground mb-3">
          Graph View
        </h4>
        <div className="aspect-square rounded-lg bg-muted/30 border border-border flex items-center justify-center relative overflow-hidden">
          {/* Mini graph visualization placeholder */}
          <div className="relative w-full h-full p-4">
            {/* Center node */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-primary flex items-center justify-center">
              <span className="text-primary-foreground text-xs font-bold">Q1</span>
            </div>
            {/* Connected nodes */}
            <div className="absolute top-[25%] left-[20%] w-4 h-4 rounded-full bg-emerald-500" />
            <div className="absolute top-[20%] right-[25%] w-4 h-4 rounded-full bg-emerald-500" />
            <div className="absolute bottom-[30%] left-[30%] w-4 h-4 rounded-full bg-emerald-500" />
            <div className="absolute bottom-[25%] right-[20%] w-4 h-4 rounded-full bg-amber-500" />
            <div className="absolute top-[40%] right-[15%] w-3 h-3 rounded-full bg-blue-500" />
            
            {/* Legend */}
            <div className="absolute bottom-2 right-2 flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-emerald-500" /> Notes
              </span>
              <span className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-amber-500" /> Files
              </span>
              <span className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-blue-500" /> People
              </span>
            </div>
          </div>
        </div>
        <button className="w-full mt-2 py-2 text-sm text-primary hover:underline flex items-center justify-center gap-1">
          Open Full Graph View
          <ArrowTopRightOnSquareIcon className="h-3 w-3" />
        </button>
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
            SC
          </div>
          <span className="text-sm">Sarah Chen</span>
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
          <p>{note.content.split(/\s+/).filter(Boolean).length} words</p>
          <p>{note.content.length} characters</p>
        </div>
      </div>
      
      {/* Tags */}
      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-2">Tags</label>
        {note.tags && note.tags.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {note.tags.map((tag) => (
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
          <SparklesIcon className="h-5 w-5 text-purple-500" />
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
      <div className="space-y-2">
        {[
          { version: 'Current', date: '2 hours ago', author: 'Sarah Chen' },
          { version: 'v3', date: 'Yesterday', author: 'John Davis' },
          { version: 'v2', date: '3 days ago', author: 'Sarah Chen' },
          { version: 'v1', date: 'Jan 5, 2026', author: 'Sarah Chen' },
        ].map((item, index) => (
          <button
            key={index}
            className="w-full text-left p-3 rounded-lg border border-border hover:border-primary/50 hover:bg-accent/50 transition-colors"
          >
            <div className="flex items-center justify-between">
              <span className="font-medium text-sm">{item.version}</span>
              <span className="text-xs text-muted-foreground">{item.date}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">by {item.author}</p>
          </button>
        ))}
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
            <Icon className="h-4 w-4" />
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
