/**
 * MessageContent - Renders chat message content as markdown.
 *
 * Handles:
 * - Markdown formatting (bold, italic, strikethrough, lists, headings)
 * - Fenced code blocks with syntax highlighting, language label, and copy button
 * - Inline code
 * - URN mention chips: [[[label|urn]]] rendered as interactive MentionChipCompact
 * - Links, GFM tables
 */

import { memo, useState, useCallback, useMemo, type ReactNode } from 'react';
import Markdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Copy, Check } from '@phosphor-icons/react';
import { MentionChip } from '@/components/mention';
import { parseUrn, urnToPath } from '@/shared/utils/urn';
import { navigateTo, openInNewTab } from '@/shared/utils/navigation';
import { cn } from '@/shared/utils/cn';

// Mention preprocessing

// Convert [[[label|urn]]] mentions to markdown links so react-markdown processes them
const MENTION_RE = /\[\[\[([^|]+)\|([^\]]+)\]\]\]/g;

function preprocessMentions(content: string): string {
  return content.replace(MENTION_RE, '[@$1]($2)');
}

// Markdown collapses single newlines into spaces, so an agent reply
// like "Line one\nLine two" renders as "Line one Line two" once it
// settles -- which looks like text was eaten between the streaming
// view (plain pre-wrap) and the markdown view. Convert single
// newlines into hard breaks (`  \n`) so the laid-out result matches
// what the user saw mid-stream. Existing blank-line paragraph breaks
// (`\n\n`) and code blocks are left alone.
const FENCED_CODE_RE = /(```[\s\S]*?```)/g;

function preserveSingleNewlines(content: string): string {
  if (!content.includes('\n')) return content;
  // Split on fenced code blocks so we don't rewrite newlines inside
  // them; rejoin with the originals untouched.
  return content
    .split(FENCED_CODE_RE)
    .map((segment, i) => {
      if (i % 2 === 1) return segment; // fenced code -- leave alone
      return segment.replace(/([^\n])\n(?!\n)/g, '$1  \n');
    })
    .join('');
}

// Emoticon to emoji conversion

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

// Only convert emoticons outside of code blocks/spans
const CODE_BLOCK_RE = /(`{1,3}[^`]*`{1,3})/g;

function convertEmoticons(text: string): string {
  // Split on code segments to avoid converting inside them
  const parts = text.split(CODE_BLOCK_RE);
  return parts.map((part, i) => {
    // Odd indices are code segments - leave them alone
    if (i % 2 === 1) return part;
    let result = part;
    for (const [pattern, emoji] of EMOTICON_MAP) {
      result = result.replace(pattern, emoji);
    }
    return result;
  }).join('');
}

// Custom markdown renderers

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function MarkdownLink(props: any) {
  const { href, children } = props;
  if (href?.startsWith('urn:uniffy:content:')) {
    const label = String(children ?? '').replace(/^@/, '');
    const parsed = parseUrn(href);

    const handleClick = (e?: React.MouseEvent) => {
      if (!parsed.isValid) return;
      const path = urnToPath(href);
      if (path === '#') return;
      if (e?.metaKey || e?.ctrlKey) {
        openInNewTab(path);
      } else {
        navigateTo(path);
      }
    };

    return <MentionChip urn={href} label={label} onClick={handleClick} />;
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

  // Detect fenced code block: <pre> containing a <code> with className
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

// Extract plain text from React children tree (for copy button)
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
  // If it has a language class, it's inside a <pre> - let rehype-highlight handle it
  if (className) {
    return <code className={className} {...rest}>{children}</code>;
  }
  return (
    <code className="px-1.5 py-0.5 rounded bg-muted font-mono text-[13px]" {...rest}>
      {children}
    </code>
  );
}

// Scale up emoji in paragraph text so they don't look tiny at text-sm
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function EmojiParagraph(props: any) {
  const { children, ...rest } = props;
  return <p {...rest}>{scaleEmoji(children)}</p>;
}

function scaleEmoji(node: ReactNode): ReactNode {
  if (typeof node === 'string') {
    // Split text into emoji and non-emoji segments
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

// react-markdown v10 strips non-http URLs by default.
// Allow urn: protocol so URN mention links pass through to our custom <a>.
function urlTransform(url: string): string {
  if (url.startsWith('urn:uniffy:')) return url;
  return defaultUrlTransform(url);
}

// Emoji sizing

// Matches emoji characters (including multi-codepoint sequences like flags, skin tones)
const EMOJI_RE = /\p{Emoji_Presentation}|\p{Emoji}\uFE0F/gu;

/**
 * Detect if the message is emoji-only (1-3 emoji, no other text).
 * Used to render emoji-only messages in jumbo size like Slack/Discord.
 */
function isEmojiOnly(text: string): boolean {
  const stripped = text.replace(/\s/g, '');
  if (!stripped) return false;
  const emojiMatches = stripped.match(EMOJI_RE);
  if (!emojiMatches) return false;
  const withoutEmoji = stripped.replace(EMOJI_RE, '');
  return withoutEmoji.length === 0 && emojiMatches.length <= 3;
}

// MessageContent component

interface MessageContentProps {
  content: string;
  className?: string;
}

function MessageContentInner({ content, className }: MessageContentProps) {
  const withEmoticons = convertEmoticons(content ?? '');
  const jumbo = useMemo(() => isEmojiOnly(withEmoticons), [withEmoticons]);

  // Emoji-only messages: render large without markdown
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
      className={cn(
        'prose prose-sm dark:prose-invert max-w-none',
        'text-foreground/90 text-sm leading-[1.625]',
        // `my-2` gives blank-line paragraph breaks visible breathing
        // room. With my-0.5 (2px) the stanza separators in long agent
        // replies collapsed to nothing and the prose looked like one
        // wall of text, even though `\n\n` was preserved in the source.
        'prose-p:my-2 prose-pre:my-0 prose-ul:my-1 prose-ol:my-1',
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
        components={markdownComponents}
        urlTransform={urlTransform}
      >
        {processed}
      </Markdown>
    </div>
  );
}

// Memoized so the heavy react-markdown + rehype-highlight pass only
// runs when content/className actually change. Without this, every
// streaming AGENT_TOKEN_DELTA causes the parent message list to
// re-render which re-parses every other message in the channel.
export const MessageContent = memo(MessageContentInner);
