import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Clock, Container, Ctx } from "@milkdown/ctx";
import {
  Editor,
  config,
  init,
  parser,
  parserCtx,
  schema,
  serializer,
  serializerCtx,
} from "@milkdown/core";
import {
  bulletListSchema,
  codeBlockSchema,
  docSchema,
  hardbreakSchema,
  headingIdGenerator,
  headingSchema,
  hrSchema,
  imageSchema,
  listItemSchema,
  orderedListSchema,
  paragraphSchema,
  strongSchema,
  textSchema,
} from "@milkdown/kit/preset/commonmark";
import {
  remarkGFMPlugin,
  tableCellSchema,
  tableHeaderRowSchema,
  tableHeaderSchema,
  tableRowSchema,
  tableSchema,
} from "@milkdown/kit/preset/gfm";
import { imageBlockSchema, remarkImageBlockPlugin } from "@milkdown/kit/component/image-block";
import { configureMarkdown, markdownPlugins } from "@/components/editor/plugins/markdown";
import { mentionNode, mentionRemarkPlugin } from "@/components/editor/plugins/mention";

vi.mock("@/shared/utils/navigation", () => ({ navigateTo: vi.fn(), openInNewTab: vi.fn() }));

const ctx = new Ctx(new Container(), new Clock());
const cleanup: (() => void | Promise<void>)[] = [];

beforeAll(async () => {
  // Milkdown's readiness timers use browser events even when only parsing Markdown.
  const target = new EventTarget();
  vi.stubGlobal("addEventListener", target.addEventListener.bind(target));
  vi.stubGlobal("removeEventListener", target.removeEventListener.bind(target));
  vi.stubGlobal("dispatchEvent", target.dispatchEvent.bind(target));
  const plugins = [
    init(Editor.make()),
    schema,
    parser,
    serializer,
    config((configCtx) => configureMarkdown(configCtx)),
    headingIdGenerator,
    strongSchema,
    docSchema,
    textSchema,
    paragraphSchema,
    orderedListSchema,
    bulletListSchema,
    listItemSchema,
    hardbreakSchema,
    headingSchema,
    codeBlockSchema,
    hrSchema,
    imageSchema,
    imageBlockSchema,
    ...remarkImageBlockPlugin,
    tableSchema,
    tableRowSchema,
    tableHeaderRowSchema,
    tableCellSchema,
    tableHeaderSchema,
    remarkGFMPlugin,
    ...markdownPlugins,
    mentionNode,
    ...mentionRemarkPlugin,
  ].flat();
  const handlers = plugins.map((plugin) => plugin(ctx));
  const results = await Promise.all(handlers.map((handler) => handler()));
  for (const result of results) if (result) cleanup.push(result);
});
afterAll(async () => {
  for (const dispose of cleanup.reverse()) await dispose();
  vi.unstubAllGlobals();
});

const URN = "urn:uniffy:content:TASK:01a0ed45-b8a9-7066-b996-ace8ba11c574";

function mentionsIn(markdown: string): string[] {
  const urns: string[] = [];
  ctx
    .get(parserCtx)(markdown)!
    .descendants((node) => {
      if (node.type.name === "mention") urns.push(node.attrs.urn as string);
    });
  return urns;
}

const roundTrip = (markdown: string) => ctx.get(serializerCtx)(ctx.get(parserCtx)(markdown)!);

describe("mention Markdown", () => {
  it("keeps a mention in a table cell through save and reload", () => {
    const saved = roundTrip(`| Task | Status |\n| - | - |\n| [[[Sync bug\\|${URN}]]] | Done |`);

    expect(saved).toContain(`[[[Sync bug\\|${URN}]]]`);
    expect(mentionsIn(saved)).toEqual([URN]);
    expect(mentionsIn(roundTrip(saved))).toEqual([URN]);
  });

  it("writes the plain form outside a table", () => {
    const saved = roundTrip(`See [[[Sync bug|${URN}]]] first.`);

    expect(saved.trim()).toBe(`See [[[Sync bug|${URN}]]] first.`);
    expect(mentionsIn(saved)).toEqual([URN]);
  });
});
