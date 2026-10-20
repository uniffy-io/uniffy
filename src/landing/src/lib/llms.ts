import { getCollection, type CollectionEntry } from "astro:content";
import { getPosts, postUrl, type Post } from "@/lib/blog";

export type Doc = CollectionEntry<"docs">;

export interface LlmsLink {
  title: string;
  url: string;
  description: string;
}

export interface LlmsSection {
  heading: string;
  links: LlmsLink[];
}

export const SITE_NAME = "Uniffy";

export const SITE_SUMMARY =
  "One private workspace for notes, files, chat, calls, projects, calendar, and AI agents, where every piece of content can be referenced from anywhere with an @ mention. Open source, free to self host with no user limit, and the same product on cloud and on your own servers.";

export const SITE_DETAILS = [
  "Uniffy ships as one codebase. The hosted service at cloud.uniffy.io runs the same build you can pull from GitHub and run yourself. There is no feature gate between the two.",
  "AI is switched off until an organization turns it on with its own provider keys, and agents act with the permissions of the person asking. The product sends no telemetry and never calls home.",
  "The license is FSL-1.1-Apache-2.0. Each release becomes Apache 2.0 two years after it is published.",
].join("\n\n");

// Pages the sitemap also skips, or pages that are only useful to a browser.
const EXCLUDED_DOC_IDS = new Set(["docs/legal/licenses"]);

const DOC_GROUPS: { prefix: string; heading: string }[] = [
  { prefix: "docs/user", heading: "User guide" },
  { prefix: "docs/administration", heading: "Administration guide" },
  { prefix: "docs/deployment", heading: "Deployment guide" },
  { prefix: "docs/legal", heading: "Legal" },
];

export function docUrl(doc: Doc): string {
  return `/${doc.id}/`;
}

// Overview and principles first, then the guides in the order the index lists them.
function groupRank(doc: Doc): number {
  const index = DOC_GROUPS.findIndex((group) => doc.id === group.prefix || doc.id.startsWith(`${group.prefix}/`));
  return index === -1 ? -1 : index;
}

export async function getDocs(): Promise<Doc[]> {
  const docs = await getCollection("docs", ({ id, data }) => !EXCLUDED_DOC_IDS.has(id) && !data.draft);
  return docs.sort((a, b) => {
    const orderA = a.data.sidebar?.order ?? 999;
    const orderB = b.data.sidebar?.order ?? 999;
    return groupRank(a) - groupRank(b) || orderA - orderB || a.data.title.localeCompare(b.data.title);
  });
}

function docLink(doc: Doc, base: URL): LlmsLink {
  return {
    title: doc.data.title,
    url: new URL(docUrl(doc), base).href,
    description: doc.data.description ?? "",
  };
}

function postLink(post: Post, base: URL): LlmsLink {
  return {
    title: post.data.title,
    url: new URL(postUrl(post), base).href,
    description: post.data.description,
  };
}

export async function collectSections(base: URL): Promise<LlmsSection[]> {
  const docs = await getDocs();
  const posts = await getPosts();
  const absolute = (path: string) => new URL(path, base).href;

  const startHere: LlmsLink[] = [
    {
      title: "Principles",
      url: absolute("/docs/principles/"),
      description: "The rules we will not bend on: one codebase, no analytics, not a surveillance tool, no telemetry, AI is your choice, operators cannot read your workspace.",
    },
    {
      title: "FAQ",
      url: absolute("/faq"),
      description: "Licensing, pricing, the cloud, AI, and your data, answered straight.",
    },
    {
      title: "Licensing and self hosting",
      url: absolute("/docs/deployment/licensing/"),
      description: "Free self hosting with no user limit, the one restriction, and the Apache 2.0 conversion.",
    },
    {
      title: "Docs overview",
      url: absolute("/docs/"),
      description: "Guides for users, organization admins, and operators running Uniffy on their own hardware.",
    },
  ];

  const sections: LlmsSection[] = [
    { heading: "Start here", links: startHere },
    { heading: "Blog", links: posts.map((post) => postLink(post, base)) },
  ];

  for (const group of DOC_GROUPS) {
    const links = docs
      .filter((doc) => doc.id === group.prefix || doc.id.startsWith(`${group.prefix}/`))
      .map((doc) => docLink(doc, base));
    if (links.length > 0) sections.push({ heading: group.heading, links });
  }

  sections.push({
    heading: "Optional",
    links: [
      { title: "Full text of the docs and the blog", url: absolute("/llms-full.txt"), description: "Every page above as Markdown in one file." },
      { title: "Source code", url: "https://github.com/uniffy-io/uniffy", description: "The repository behind cloud.uniffy.io and every self hosted install." },
      { title: "Contact", url: absolute("/contact"), description: "Sales, support, and where to report bugs." },
      { title: "Privacy policy", url: absolute("/privacy"), description: "What the hosted service collects and why." },
      { title: "Terms of service", url: absolute("/terms"), description: "The terms for the app and the hosted service." },
    ],
  });

  return sections;
}

export function renderIndex(sections: LlmsSection[]): string {
  const lines = [`# ${SITE_NAME}`, "", `> ${SITE_SUMMARY}`, "", SITE_DETAILS, ""];
  for (const section of sections) {
    lines.push(`## ${section.heading}`, "");
    for (const link of section.links) {
      const description = link.description ? `: ${link.description}` : "";
      lines.push(`- [${link.title}](${link.url})${description}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function renderFull(base: URL, docs: Doc[], posts: Post[]): string {
  const parts = [`# ${SITE_NAME}`, "", `> ${SITE_SUMMARY}`, "", SITE_DETAILS];
  const page = (title: string, url: string, body: string | undefined) =>
    [`# ${title}`, "", `Source: ${url}`, "", (body ?? "").trim()].join("\n");

  for (const post of posts) {
    parts.push(page(post.data.title, new URL(postUrl(post), base).href, post.body));
  }
  for (const doc of docs) {
    parts.push(page(doc.data.title, new URL(docUrl(doc), base).href, doc.body));
  }
  return parts.join("\n\n---\n\n") + "\n";
}
