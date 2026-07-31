import { memo, useState, useCallback, useMemo, type ReactNode } from 'react';
import Markdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Copy, Check } from '@phosphor-icons/react';
import { MentionChip, MentionChipCompact } from '@/components/mention';
import { getMentionUrl } from '@/components/mention/mentionStateEmitter';
import { parseUrn, urnToPath, UrnType } from '@/shared/utils/urn';
import { navigateTo, openInNewTab } from '@/shared/utils/navigation';
import { cn } from '@/shared/utils/cn';
import { useAppDispatch } from '@/app/hooks';
import { openViewerWithFetch } from '@/features/files/store/viewerThunks';
import { openRoomViewer } from '@/features/rooms/store/roomsThunks';

// Rewrite [[[label|urn]]] as markdown links so react-markdown processes them.
const MENTION_RE = /\[\[\[([^|]+)\|([^\]]+)\]\]\]/g;

function preprocessMentions(content: string): string {
  return content.replace(MENTION_RE, '[@$1]($2)');
}

// Promote single newlines to hard breaks so markdown layout matches what users saw mid-stream; leave fenced code untouched.
const FENCED_CODE_RE = /(```[\s\S]*?```)/g;

function preserveSingleNewlines(content: string): string {
  if (!content.includes('\n')) return content;
  return content
    .split(FENCED_CODE_RE)
    .map((segment, i) => {
      if (i % 2 === 1) return segment;
      return segment.replace(/([^\n])\n(?!\n)/g, '$1  \n');
    })
    .join('');
}

const EMOTICON_MAP: [RegExp, string][] = [
  [/(?<!\w)<3(?!\w)/g, '\u2764\uFE0F'],       // <3 -> red heart
  [/(?<!\w):'\((?!\w)/g, '\uD83D\uDE22'],      // :'( -> crying face
  [/(?<!\w):\)(?!\w)/g, '\uD83D\uDE42'],       // :) -> slightly smiling
  [/(?<!\w):-\)(?!\w)/g, '\uD83D\uDE42'],      // :-) -> slightly smiling
  [/(?<!\w):\((?!\w)/g, '\uD83D\uDE41'],       // :( -> slightly frowning
  [/(?<!\w):-\((?!\w)/g, '\uD83D\uDE41'],      // :-( -> slightly frowning
  [/(?<!\w):D(?!\w)/g, '\uD83D\uDE04'],        // :D -> grinning
  [/(?<!\w):-D(?!\w)/g, '\uD83D\uDE04'],       // :-D -> grinning
  [/(?<!\w):P(?!\w)/gi, '\uD83D\uDE1B'],       // :P -> tongue out
  [/(?<!\w):-P(?!\w)/gi, '\uD83D\uDE1B'],      // :-P -> tongue out
  [/(?<!\w);-?\)(?!\w)/g, '\uD83D\uDE09'],     // ;) or ;-) -> winking
  [/(?<!\w):O(?!\w)/gi, '\uD83D\uDE2E'],       // :O -> open mouth
  [/(?<!\w):-O(?!\w)/gi, '\uD83D\uDE2E'],      // :-O -> open mouth
  [/(?<!\w):\*(?!\w)/g, '\uD83D\uDE18'],       // :* -> kissing
  [/(?<!\w):-\*(?!\w)/g, '\uD83D\uDE18'],      // :-* -> kissing
  [/(?<!\w)>:\((?!\w)/g, '\uD83D\uDE20'],      // >:( -> angry
  [/(?<!\w):\/(?!\w)/g, '\uD83D\uDE15'],       // :/ -> confused
  [/(?<!\w):-\/(?!\w)/g, '\uD83D\uDE15'],      // :-/ -> confused
  [/(?<!\w)\^\^(?!\w)/g, '\uD83D\uDE0A'],      // ^^ -> smiling eyes
  [/(?<!\w)B-?\)(?!\w)/g, '\uD83D\uDE0E'],     // B) or B-) -> sunglasses
  [/(?<!\w)O:-?\)(?!\w)/g, '\uD83D\uDE07'],    // O:) or O:-) -> angel
  [/(?<!\w):\|(?!\w)/g, '\uD83D\uDE10'],       // :| -> neutral
];

const CODE_BLOCK_RE = /(`{1,3}[^`]*`{1,3})/g;

function convertEmoticons(text: string): string {
  const parts = text.split(CODE_BLOCK_RE);
  return parts.map((part, i) => {
    if (i % 2 === 1) return part;
    let result = part;
    for (const [pattern, emoji] of EMOTICON_MAP) {
      result = result.replace(pattern, emoji);
    }
    return result;
  }).join('');
}

function MentionLink({ href, children, compact }: { href: string; children: ReactNode; compact: boolean }) {
  const dispatch = useAppDispatch();
  const label = String(children ?? '').replace(/^@/, '');
  const parsed = parseUrn(href);

  const handleClick = useCallback((e?: React.MouseEvent) => {
    if (!parsed.isValid) return;
    // FILE mentions open the viewer modal in place (avoids stranding on /files/:id).
    if (parsed.type === UrnType.FILE && parsed.id && !e?.metaKey && !e?.ctrlKey) {
      dispatch(openViewerWithFetch({ fileId: parsed.id }));
      return;
    }
    // Same for ROOM: the reader wants the room's context, not to leave the conversation.
    if (parsed.type === UrnType.ROOM && parsed.id && !e?.metaKey && !e?.ctrlKey) {
      dispatch(openRoomViewer({ roomId: parsed.id }));
      return;
    }
    // Prefer search-index URLs; urnToPath can't reconstruct e.g. chat message routes.
    const resolved = getMentionUrl(href);
    const path = resolved || urnToPath(href);
    if (!path || path === '#') return;
    if (e?.metaKey || e?.ctrlKey) {
      openInNewTab(path);
    } else {
      navigateTo(path);
    }
  }, [dispatch, href, parsed.isValid, parsed.id, parsed.type]);

  const Chip = compact ? MentionChipCompact : MentionChip;
  return <Chip urn={href} label={label} onClick={handleClick} />;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function MarkdownLink(props: any) {
  const { href, children } = props;
  if (href?.startsWith('urn:uniffy:content:')) {
    return <MentionLink href={href} compact={false}>{children}</MentionLink>;
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline underline-offset-2 hover:text-primary/80 transition-colors"
    >
      {children}
    </a>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function MarkdownLinkCompact(props: any) {
  const { href, children } = props;
  if (href?.startsWith('urn:uniffy:content:')) {
    return <MentionLink href={href} compact>{children}</MentionLink>;
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline underline-offset-2 hover:text-primary/80 transition-colors"
    >
      {children}
    </a>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors"
      title={copied ? 'Copied' : 'Copy code'}
    >
      {copied
        ? <Check size={14} className="text-green-500" />
        : <Copy size={14} />
      }
    </button>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CodeBlockPre(props: any) {
  const { children, ...rest } = props;

  const codeChild = children?.props ?? {};
  const className = codeChild.className ?? '';
  const language = className.replace(/language-/, '').replace(/hljs/, '').trim();
  const codeText = extractText(codeChild.children);

  if (className || (children?.type === 'code')) {
    return (
      <div className="rounded-lg border border-border overflow-hidden my-2 not-prose">
        <div className="flex items-center justify-between px-3 py-1.5 bg-muted/50 border-b border-border">
          <span className="text-xs text-muted-foreground">{language || 'code'}</span>
          <CopyButton text={codeText} />
        </div>
        <pre className="p-4 text-sm font-mono bg-muted/30 overflow-x-auto m-0" {...rest}>
          {children}
        </pre>
      </div>
    );
  }

  return <pre {...rest}>{children}</pre>;
}

function extractText(node: ReactNode): string {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (typeof node === 'object' && 'props' in node) {
    return extractText((node as { props: { children?: ReactNode } }).props.children);
  }
  return '';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function InlineCode(props: any) {
  const { children, className, ...rest } = props;
  // With a language class it lives inside <pre>; let rehype-highlight handle it.
  if (className) {
    return <code className={className} {...rest}>{children}</code>;
  }
  return (
    <code className="px-1.5 py-0.5 rounded bg-muted font-mono text-[13px]" {...rest}>
      {children}
    </code>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function EmojiParagraph(props: any) {
  const { children, ...rest } = props;
  return <p {...rest}>{scaleEmoji(children)}</p>;
}

function scaleEmoji(node: ReactNode): ReactNode {
  if (typeof node === 'string') {
    const parts = node.split(EMOJI_RE);
    const matches = node.match(EMOJI_RE);
    if (!matches) return node;

    const result: ReactNode[] = [];
    for (let i = 0; i < parts.length; i++) {
      if (parts[i]) result.push(parts[i]);
      if (matches[i]) {
        result.push(
          <span key={i} className="text-xl leading-none align-middle">
            {matches[i]}
          </span>
        );
      }
    }
    return result;
  }
  if (Array.isArray(node)) {
    return node.map((child, i) => <span key={i}>{scaleEmoji(child)}</span>);
  }
  return node;
}

const markdownComponents = {
  a: MarkdownLink,
  pre: CodeBlockPre,
  code: InlineCode,
  p: EmojiParagraph,
};

const markdownComponentsCompact = {
  a: MarkdownLinkCompact,
  pre: CodeBlockPre,
  code: InlineCode,
  p: EmojiParagraph,
};

// Allow urn: protocol; react-markdown v10 strips non-http URLs by default.
function urlTransform(url: string): string {
  if (url.startsWith('urn:uniffy:')) return url;
  return defaultUrlTransform(url);
}

const EMOJI_RE = /\p{Emoji_Presentation}|\p{Emoji}\uFE0F/gu;

/** Emoji-only messages (1-3 emoji, no other text) render jumbo-sized. */
function isEmojiOnly(text: string): boolean {
  const stripped = text.replace(/\s/g, '');
  if (!stripped) return false;
  const emojiMatches = stripped.match(EMOJI_RE);
  if (!emojiMatches) return false;
  const withoutEmoji = stripped.replace(EMOJI_RE, '');
  return withoutEmoji.length === 0 && emojiMatches.length <= 3;
}

interface MessageContentProps {
  content: string;
  className?: string;
  /** Force compact mention chips for dense surfaces (reply/thread previews). */
  compactMentions?: boolean;
}

function MessageContentInner({ content, className, compactMentions = false }: MessageContentProps) {
  const withEmoticons = convertEmoticons(content ?? '');
  const jumbo = useMemo(() => isEmojiOnly(withEmoticons), [withEmoticons]);

  if (jumbo) {
    return (
      <div className={cn('text-4xl leading-snug py-0.5', className)}>
        {withEmoticons.trim()}
      </div>
    );
  }

  const processed = preserveSingleNewlines(preprocessMentions(withEmoticons));

  return (
    <div
      style={{
        fontFamily:
          '"Inter Variable", Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif',
      }}
      className={cn(
        'prose prose-sm dark:prose-invert max-w-none',
        // Mobile 15/1.45 for thumb reading; desktop 14/1.4 for density.
        'text-foreground/90 font-[450] text-[15px] leading-[1.45] md:text-sm md:leading-[1.4]',
        // `my-2` keeps blank-line paragraph breaks visible; tighter values collapsed stanzas.
        'prose-p:my-2 prose-pre:my-0 prose-ul:my-1 prose-ol:my-1',
        // Strip outer paragraph margins so the container controls between-message spacing.
        '[&>p:first-child]:mt-0 [&>p:last-child]:mb-0',
        'prose-headings:my-2 prose-headings:text-foreground',
        'prose-code:before:content-none prose-code:after:content-none',
        'prose-blockquote:border-l-primary/40 prose-blockquote:text-muted-foreground',
        'prose-strong:text-foreground prose-em:text-foreground/90',
        'prose-li:my-0',
        'break-words',
        className,
      )}
    >
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={compactMentions ? markdownComponentsCompact : markdownComponents}
        urlTransform={urlTransform}
      >
        {processed}
      </Markdown>
    </div>
  );
}

// Memoized: react-markdown + rehype-highlight is expensive; streaming deltas re-render the list.
export const MessageContent = memo(MessageContentInner);
