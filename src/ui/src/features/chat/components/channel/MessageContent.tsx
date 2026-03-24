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

import { useState, useCallback, type ReactNode } from 'react';
import Markdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Copy, Check } from '@phosphor-icons/react';
import { MentionChip } from '@/components/mention';
import { parseUrn, urnToPath } from '@/shared/utils/urn';
import { navigateTo, openInNewTab } from '@/shared/utils/navigation';
import { cn } from '@/shared/utils/cn';

// ---------------------------------------------------------------------------
// Mention preprocessing
// ---------------------------------------------------------------------------

// Convert [[[label|urn]]] mentions to markdown links so react-markdown processes them
const MENTION_RE = /\[\[\[([^|]+)\|([^\]]+)\]\]\]/g;

function preprocessMentions(content: string): string {
  return content.replace(MENTION_RE, '[@$1]($2)');
}

// ---------------------------------------------------------------------------
// Custom markdown renderers
// ---------------------------------------------------------------------------

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

const markdownComponents = {
  a: MarkdownLink,
  pre: CodeBlockPre,
  code: InlineCode,
};

// react-markdown v10 strips non-http URLs by default.
// Allow urn: protocol so URN mention links pass through to our custom <a>.
function urlTransform(url: string): string {
  if (url.startsWith('urn:uniffy:')) return url;
  return defaultUrlTransform(url);
}

// ---------------------------------------------------------------------------
// MessageContent component
// ---------------------------------------------------------------------------

interface MessageContentProps {
  content: string;
  className?: string;
}

export function MessageContent({ content, className }: MessageContentProps) {
  const processed = preprocessMentions(content ?? '');

  return (
    <div
      className={cn(
        'prose prose-sm dark:prose-invert max-w-none',
        'text-foreground text-sm leading-relaxed',
        'prose-p:my-0.5 prose-pre:my-0 prose-ul:my-1 prose-ol:my-1',
        'prose-headings:my-2 prose-headings:text-foreground',
        'prose-code:before:content-none prose-code:after:content-none',
        'prose-blockquote:border-l-primary/50 prose-blockquote:text-muted-foreground',
        'prose-strong:text-foreground prose-em:text-foreground',
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
