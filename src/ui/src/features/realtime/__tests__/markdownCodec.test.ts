import { toBase64 } from "lib0/buffer";
import type { EditorView } from "@milkdown/prose/view";
import { EditorState, TextSelection } from "@milkdown/prose/state";
import { recoveredMarkdown, applyRecoveredMarkdown } from "@/features/realtime/recoveredMarkdown";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Clock, Container, Ctx } from "@milkdown/ctx";
import {
  Editor,
  config,
  init,
  schema,
  parser,
  serializer,
  parserCtx,
  schemaCtx,
  editorViewCtx,
  serializerCtx,
} from "@milkdown/core";
import {
  strongSchema,
  docSchema,
  textSchema,
  paragraphSchema,
  orderedListSchema,
  bulletListSchema,
  listItemSchema,
  hardbreakSchema,
  headingSchema,
  headingIdGenerator,
  codeBlockSchema,
  hrSchema,
  imageSchema,
} from "@milkdown/kit/preset/commonmark";
import { imageBlockSchema, remarkImageBlockPlugin } from "@milkdown/kit/component/image-block";
import { configureMarkdown, markdownPlugins } from "@/components/editor/plugins/markdown";
import { normalizeSerializedMarkdown } from "@/features/realtime/markdown";
import { tagNode, tagRemarkPlugin } from "@/components/editor/plugins/tag";
import * as Y from "yjs";
import { MarkdownReconciler } from "@/features/realtime/markdownReconciliation";
import {
  fragmentToProsemirrorNode,
  getProsemirrorFragment,
  replaceMarkdownYText,
  replaceProsemirrorFragment,
} from "@/features/realtime/markdown";

vi.mock("@/components/editor/plugins/tag/TagChip", () => ({ TagChip: () => null }));
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
    ...[
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
    ].flat(),
    ...markdownPlugins,
    ...remarkImageBlockPlugin,
    tagNode,
    ...tagRemarkPlugin,
  ];
  const handlers = plugins.map((plugin) => plugin(ctx));
  const results = await Promise.all(handlers.map((handler) => handler()));
  for (const result of results) if (result) cleanup.push(result);
});
afterAll(async () => {
  for (const dispose of cleanup.reverse()) await dispose();
  vi.unstubAllGlobals();
});

const parse = (markdown: string) => ctx.get(parserCtx)(markdown)!;
const serialize = (node: ReturnType<typeof parse>) =>
  normalizeSerializedMarkdown(ctx.get(serializerCtx)(node));

describe("editor Markdown fidelity", () => {
  it.each([
    "5. five\n6. six",
    "![diagram alt](/diagram.png)",
    '![diagram alt](/diagram.png "A caption")',
    '![diagram alt](/diagram.png "A caption")<!--uniffy:image-ratio=0.5-->',
    "---\ntitle: Example\nlabels:\n  - release\n---\n\nBody",
    '+++\ntitle = "Example"\n+++\n\nBody',
    "- one\n- two",
    "Fix the #hotfix today",
    "Fix the [[[tag|hotfix]]] today",
    "---\ntitle: test\n---\n\n![body alt](/image.png)",
  ])("preserves %j across repeated parse and serialize", (input) => {
    const output = serialize(parse(input));
    expect(output).toBe(input);
    expect(serialize(parse(output))).toBe(output);
  });

  it("retains inline and trailing HTML breaks", () => {
    const doc = parse("line<br>break<br />");
    expect(doc.firstChild?.childCount).toBe(4);
    expect(doc.firstChild?.child(1).type.name).toBe("hardbreak");
    expect(parse(serialize(doc)).toJSON()).toEqual(doc.toJSON());
  });

  it("preserves standalone HTML breaks", () => {
    expect(parse(serialize(parse("<br />"))).firstChild?.firstChild?.type.name).toBe("hardbreak");
  });

  it("preserves leading spaces as content without changing code literals", () => {
    const doc = parse("  leading\n\n```html\n<br />\n```");
    expect(doc.firstChild?.textContent).toBe("  leading");
    expect(parse(serialize(doc)).firstChild?.textContent).toBe("  leading");
    expect(serialize(doc)).toContain("```html\n<br />\n```");
  });

  it("serializes cleared documents without fabricated HTML", () => {
    const doc = parse("text");
    const empty = doc.type.create(null, [
      doc.firstChild!.type.create(),
      doc.firstChild!.type.create(),
    ]);
    expect(serialize(empty)).toBe("");
  });

  it("preserves ratio separately from image alt and caption", () => {
    const doc = parse('![diagram alt](/diagram.png "Caption")<!--uniffy:image-ratio=0.75-->');
    expect(doc.firstChild?.attrs).toMatchObject({
      alt: "diagram alt",
      caption: "Caption",
      ratio: 0.75,
    });
    expect(parse(serialize(doc)).toJSON()).toEqual(doc.toJSON());
  });

  it("keeps numeric image alt text while reading existing resize values", () => {
    const doc = parse("![0.50](/diagram.png)");
    expect(doc.firstChild?.attrs).toMatchObject({ alt: "0.50", ratio: 0.5 });
  });

  it("imports hashtags as text and explicit tag markers as tags", () => {
    expect(parse("#hotfix today").firstChild?.firstChild?.type.name).toBe("text");
    expect(parse("[[[tag|hotfix]]] today").firstChild?.firstChild?.type.name).toBe("tag");
  });

  it("ignores trailing editor placeholders while retaining literal HTML breaks", () => {
    const node = parse("body<br />");
    const withPlaceholder = node.type.create(null, [
      node.firstChild!,
      node.type.schema.nodes.paragraph.create(),
    ]);
    expect(serialize(withPlaceholder)).toBe("body<br />");
  });

  it("does not rewrite source formatting on an idle flush", () => {
    const doc = new Y.Doc();
    const source = "* one\n* two\n\n5) five\n6) six\n";
    const node = parse(source);
    replaceMarkdownYText(doc, source, "seed");
    replaceProsemirrorFragment(doc, node, "seed");
    const reconciler = new MarkdownReconciler(doc, {
      parse,
      serialize,
      read: () => fragmentToProsemirrorNode(getProsemirrorFragment(doc), node.type.schema),
    });
    reconciler.flush();
    expect(doc.getText("markdown").toString()).toBe(source);
    doc.destroy();
  });
});

it("recovers marked and nested rich content as Markdown, including edits ahead of the mirror", () => {
  const doc = new Y.Doc();
  const markdown = "## Heading\n\n**kept bold**\n\n3. first\n4. second";
  replaceProsemirrorFragment(doc, ctx.get(parserCtx)(markdown)!, "user");
  doc.getMap("markdown_mirror").set("active", true);
  doc.getText("markdown").insert(0, "stale mirror");
  const text = recoveredMarkdown(toBase64(Y.encodeStateAsUpdate(doc)), ctx);
  expect(text).toContain("**kept bold**");
  expect(text).toContain("3. first");
  expect(text).not.toContain("<paragraph>");
  expect(text).not.toContain("stale mirror");
  doc.destroy();
});

it("keeps authoritative text including empty text over an inactive rich fragment", () => {
  const doc = new Y.Doc();
  replaceProsemirrorFragment(doc, ctx.get(parserCtx)("obsolete rich content")!, "user");
  doc.getMap("markdown_mirror").set("active", false);
  expect(recoveredMarkdown(toBase64(Y.encodeStateAsUpdate(doc)), ctx)).toBe("");
  doc.getText("markdown").insert(0, "Current source");
  expect(recoveredMarkdown(toBase64(Y.encodeStateAsUpdate(doc)), ctx)).toBe("Current source");
  doc.destroy();
});

it("inserts recovered Markdown at selection and replaces only on explicit replace", () => {
  let state = EditorState.create({
    schema: ctx.get(schemaCtx),
    doc: ctx.get(parserCtx)("Left right")!,
  });
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 5)));
  const view = {
    isDestroyed: false,
    editable: true,
    get state() {
      return state;
    },
    dispatch: (transaction: Parameters<typeof state.apply>[0]) => {
      state = state.apply(transaction);
    },
    focus: vi.fn(),
  };
  const actions = new Ctx(new Container(), new Clock());
  actions.inject(parserCtx, ctx.get(parserCtx));
  actions.inject(editorViewCtx, view as unknown as EditorView);
  applyRecoveredMarkdown(actions, "**recovered**", false);
  expect(state.doc.textContent).toContain("Left");
  expect(state.doc.textContent).toContain("recovered");
  expect(state.doc.textContent).toContain("right");
  applyRecoveredMarkdown(actions, "Replacement", true);
  expect(state.doc.textContent).toBe("Replacement");
  view.editable = false;
  expect(() => applyRecoveredMarkdown(actions, "Denied", true)).toThrow("Editor is not editable");
  expect(state.doc.textContent).toBe("Replacement");
});
