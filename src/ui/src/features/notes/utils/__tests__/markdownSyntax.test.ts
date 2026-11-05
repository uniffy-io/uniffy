import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { classHighlighter, highlightTree } from "@lezer/highlight";
import { expect, it } from "vitest";

it.each([
  ["JavaScript", "js", "const answer = 42;", "const"],
  ["Python", "python", "def answer():\n    return 42", "def"],
  ["CSS", "css", "body { color: red; }", "body"],
])("highlights Markdown containing %s code", async (name, tag, code, token) => {
  const support = await languages.find((language) => language.name === name)!.load();
  const language = markdown({ codeLanguages: () => support.language });
  const source = `# Example\n\n\`\`\`${tag}\n${code}\n\`\`\``;
  const tree = language.language.parser.parse(source);
  const highlights: string[] = [];
  highlightTree(tree, classHighlighter, (from, to) => {
    highlights.push(source.slice(from, to));
  });
  expect(highlights).toContain(token);
  expect(tree.resolveInner(source.indexOf(code) + 1).name).not.toBe("FencedCode");
});
