import { useState, useMemo } from "react";
import { useAppSelector, useAppDispatch } from "@/app/hooks";
import { setMetadataPanelTab, setMetadataPanelOpen } from "@/features/notes/store/editorSlice";
import type { MetadataPanelTab } from "@/features/notes/store/editorSlice";
import { useBreakpoint } from "@/shared/hooks/useBreakpoint";
import { cn } from "@/shared/utils/cn";
import type { Icon as IconType } from "@phosphor-icons/react";
import {
  Link,
  Gear,
  Clock,
  ListBullets,
  Hash,
  FileText,
  Graph,
  ChatCircle,
  X,
} from "@phosphor-icons/react";
import { CommentsPanel } from "@/features/comments/components/CommentsPanel";
import { useComments } from "@/features/comments/hooks/useComments";
import { useLiveNoteMarkdown } from "@/features/notes/realtime/liveNoteDocs";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { parseUrn, urnToPath, UrnType } from "@/shared/utils/urn";
import { openRoomViewer } from "@/features/rooms/store/roomsThunks";
import { useNavigate } from "react-router-dom";

import { getInitials } from "@/components/subject/utils";
import { MentionChipCompact } from "@/components/mention";
import { TagChip } from "@/features/tags";
import { useTagsByIds } from "@/features/tags/store/selectors";
import {
  headingToSlug,
  indexedSlug,
  findHeadingBySlug,
} from "@/components/editor/utils/headingScroll";

function NoteMetadataTagsList({ tagIds }: { tagIds: ReadonlyArray<string> }) {
  const tags = useTagsByIds(tagIds);
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground block mb-2">Tags</label>
      {tags.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <TagChip key={tag.id} tag={tag} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground italic">No tags</p>
      )}
    </div>
  );
}

/** Parsed mention from content */
interface ParsedMention {
  label: string;
  urn: string;
  type: UrnType;
}

/** Parse mentions from markdown content using [[[label|urn]]] pattern */
function parseMentionsFromContent(content: string): ParsedMention[] {
  const mentionRegex = /\[\[\[([^[\]|]+)\|([^\]]+)\]\]\]/g;
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

export function NotesMetadataPanel() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { isMobileOrTablet } = useBreakpoint();
  const { currentNoteId, notes } = useAppSelector((state) => state.notes);
  const editorState = useAppSelector((state) => state.editor);
  const currentUser = useAppSelector((state) => state.auth.user);
  const metadataPanelTab = editorState?.metadataPanelTab || "links";

  // State for showing copy feedback - must be declared before any conditional returns
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Get the note (may be undefined)
  const note = currentNoteId ? notes[currentNoteId] : undefined;

  // Redux content lags the live doc by snapshot debounce plus refetch, so
  // outline/links/statistics read Y.Text when the editor has a session open.
  const currentContent = useLiveNoteMarkdown(currentNoteId ?? null, note?.content ?? "");

  // Parse outgoing links (mentions) from content - MUST be called before any returns
  const outgoingLinks = useMemo(() => parseMentionsFromContent(currentContent), [currentContent]);

  // Get comment counts for badge
  const { openCount: commentOpenCount } = useComments(ContentType.NOTE, currentNoteId || "");

  // Early returns AFTER all hooks
  if (!currentNoteId || !note) return null;

  // Check if current user is the owner
  const isOwner = currentUser && note.ownerId === currentUser.id;
  const ownerName = isOwner ? currentUser.fullName || currentUser.username || "You" : "Unknown";
  const ownerInitials = getInitials(ownerName);

  const tabs: Array<{ id: MetadataPanelTab; label: string; icon: IconType; badge?: number }> = [
    { id: "outline", label: "Outline", icon: ListBullets },
    { id: "links", label: "Links", icon: Link },
    { id: "properties", label: "Properties", icon: Gear },
    { id: "comments", label: "Comments", icon: ChatCircle, badge: commentOpenCount },
    { id: "history", label: "History", icon: Clock },
  ];

  // Parse headings from markdown content. Slug derivation + occurrence
  // suffix mirrors the ToC plugin so anchor links match across surfaces.
  const parseHeadings = (content: string) => {
    const headingRegex = /^(#{1,6})\s+(.+)$/gm;
    const headings: Array<{ level: number; text: string; id: string }> = [];
    const slugCounts = new Map<string, number>();
    let match;

    while ((match = headingRegex.exec(content)) !== null) {
      const level = match[1].length;
      const text = match[2].trim();
      const base = headingToSlug(text);
      if (!base) continue;
      const n = slugCounts.get(base) ?? 0;
      slugCounts.set(base, n + 1);
      headings.push({ level, text, id: indexedSlug(base, n) });
    }

    return headings;
  };

  const headings = parseHeadings(currentContent);

  // Handle clicking on an outgoing link
  const handleLinkClick = (urn: string) => {
    const parsed = parseUrn(urn);
    if (parsed.type === UrnType.ROOM && parsed.id) {
      dispatch(openRoomViewer({ roomId: parsed.id }));
      return;
    }
    const path = urnToPath(urn);
    if (path !== "#") {
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
    } catch {
      // clipboard unavailable
    }
  };

  const handleHeadingClick = (e: React.MouseEvent, _headingText: string, headingId: string) => {
    e.preventDefault();

    window.history.replaceState(window.history.state, "", `#${headingId}`);

    const heading = findHeadingBySlug(headingId);
    if (!heading) return;
    heading.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const renderOutlineTab = () => (
    <div className="space-y-2">
      {headings.length === 0 ? (
        <div className="text-center py-8">
          <ListBullets size={32} weight="duotone" className="mx-auto text-subtle-foreground mb-3" />
          <p className="text-sm text-muted-foreground">No headings found</p>
          <p className="text-xs text-muted-foreground mt-1">
            Add headings (# H1, ## H2, etc.) to see the outline
          </p>
        </div>
      ) : (
        <>
          <p className="text-xs text-muted-foreground mb-3">
            {headings.length} heading{headings.length !== 1 ? "s" : ""}
          </p>
          <nav className="space-y-0.5">
            {headings.map((heading, index) => (
              <div
                key={`${heading.id}-${index}`}
                className="group flex items-center gap-1 rounded-md hover:bg-muted/60 transition-colors"
                style={{ paddingLeft: `${(heading.level - 1) * 12}px` }}
              >
                <a
                  href={`#${heading.id}`}
                  onClick={(e) => handleHeadingClick(e, heading.text, heading.id)}
                  className="flex-1 py-1.5 px-2 text-sm truncate"
                  title={heading.text}
                >
                  <span
                    className={`${
                      heading.level === 1
                        ? "font-semibold"
                        : heading.level === 2
                          ? "font-medium"
                          : "text-muted-foreground"
                    }`}
                  >
                    {heading.text}
                  </span>
                </a>
                <button
                  onClick={(e) => handleCopyLink(e, heading.id)}
                  className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-muted transition-all"
                  title={copiedId === heading.id ? "Copied!" : "Copy link"}
                >
                  {copiedId === heading.id ? (
                    <svg
                      className="h-3.5 w-3.5 text-green-500"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
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
            {outgoingLinks.length} reference{outgoingLinks.length !== 1 ? "s" : ""}
          </span>
        </h4>
        {outgoingLinks.length === 0 ? (
          <div className="text-center py-6">
            <Link size={32} weight="duotone" className="mx-auto text-subtle-foreground mb-3" />
            <p className="text-sm text-muted-foreground">No outgoing links</p>
            <p className="text-xs text-muted-foreground mt-1">
              Use @ mentions to link to other content
            </p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {outgoingLinks.map((link) => (
              <MentionChipCompact
                key={link.urn}
                urn={link.urn}
                label={link.label}
                onClick={() => handleLinkClick(link.urn)}
              />
            ))}
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
          <FileText size={32} weight="duotone" className="mx-auto text-subtle-foreground mb-3" />
          <p className="text-sm text-muted-foreground">Backlinks coming soon</p>
          <p className="text-xs text-muted-foreground mt-1">See which notes link to this one</p>
        </div>
      </div>

      {/* Graph View */}
      <div>
        <h4 className="uppercase tracking-wider text-xs font-semibold text-muted-foreground mb-3">
          Graph View
        </h4>
        <button
          onClick={() =>
            navigate(
              `/library/graph?focus=${encodeURIComponent(`urn:uniffy:content:NOTE:${currentNoteId}`)}`,
            )
          }
          className="w-full flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
          data-testid="note-show-in-graph"
        >
          <Graph size={20} weight="duotone" className="text-primary shrink-0" />
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-medium">Show in graph</span>
            <span className="block text-xs text-muted-foreground">
              See how this note connects across the organization
            </span>
          </span>
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
            {new Date(Number(note.createdAt.seconds) * 1000).toLocaleDateString("en-US", {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </p>
        </div>
      )}

      {/* Updated */}
      {note.updatedAt && (
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">
            Last Updated
          </label>
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

      <NoteMetadataTagsList tagIds={note.tagIds ?? []} />
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
        <Clock size={32} weight="duotone" className="mx-auto text-subtle-foreground mb-3" />
        <p className="text-sm text-muted-foreground">Full version history coming soon</p>
        <p className="text-xs text-muted-foreground mt-1">
          Track changes and restore previous versions
        </p>
      </div>
    </div>
  );

  const renderContent = () => {
    switch (metadataPanelTab) {
      case "outline":
        return renderOutlineTab();
      case "links":
        return renderLinksTab();
      case "properties":
        return renderPropertiesTab();
      case "history":
        return renderHistoryTab();
      case "comments":
        return currentNoteId ? (
          <CommentsPanel contentType={ContentType.NOTE} contentId={currentNoteId} />
        ) : null;
      default:
        return renderOutlineTab();
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Tabs */}
      <div className="flex items-center px-3 pt-3 pb-2 gap-0.5">
        {isMobileOrTablet && (
          <button
            onClick={() => dispatch(setMetadataPanelOpen(false))}
            className="p-1.5 rounded-md bg-transparent hover:bg-muted transition-colors shrink-0"
            aria-label="Close panel"
          >
            <X size={16} weight="bold" className="text-muted-foreground" />
          </button>
        )}
        {tabs.map(({ id, label, icon: Icon, badge }) => {
          const isActive = metadataPanelTab === id;
          return (
            <button
              key={id}
              onClick={() => dispatch(setMetadataPanelTab(id))}
              className={cn(
                "group relative flex items-center py-1.5 px-1.5 text-sm font-medium rounded-lg transition-all duration-700 ease-out overflow-hidden",
                "hover:px-2.5",
                isActive && "text-foreground",
              )}
            >
              <span
                className={cn(
                  "absolute inset-0 rounded-lg transition-all duration-500",
                  isActive ? "bg-primary/10" : "bg-transparent",
                )}
              />
              <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 rounded-full bg-primary transition-all duration-700 ease-out w-0 opacity-0 group-hover:w-1/2 group-hover:opacity-70" />
              <span
                className={cn(
                  "relative z-10 flex items-center justify-center w-7 h-7 rounded-md transition-all duration-500 ease-out",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground group-hover:text-primary",
                )}
              >
                <Icon size={18} weight={isActive ? "fill" : "duotone"} />
                {badge != null && badge > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-0.5 text-[9px] rounded-full bg-primary text-primary-foreground leading-[14px] text-center">
                    {badge}
                  </span>
                )}
              </span>
              <span
                className={cn(
                  "relative z-10 ml-0 max-w-0 overflow-hidden whitespace-nowrap transition-all duration-700 ease-out",
                  "group-hover:ml-1.5 group-hover:max-w-24",
                  isActive
                    ? "text-foreground"
                    : "text-muted-foreground group-hover:text-foreground",
                )}
              >
                {label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">{renderContent()}</div>
    </div>
  );
}
