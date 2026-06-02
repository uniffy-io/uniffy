const FENCE_RE = /```/g;

/**
 * Make a mid-stream prefix safe to render as markdown.
 * The tail of a streamed reply is always partial, so two constructs would
 * otherwise render as garbage until their closing token arrives: an unclosed
 * mention shows as raw `[[[` bracket soup, and an unbalanced code fence leaks
 * its highlight state over the rest of the message. Drop the dangling mention
 * (it pops in as a chip once `]]]` lands) and close the open fence.
 */
export function sanitizeStreamingMarkdown(content: string): string {
  let out = content;

  const lastOpen = out.lastIndexOf('[[[');
  if (lastOpen !== -1 && out.indexOf(']]]', lastOpen) === -1) {
    out = out.slice(0, lastOpen);
  }

  if (((out.match(FENCE_RE)?.length ?? 0) % 2) === 1) {
    out = `${out}\n\`\`\``;
  }

  return out;
}
