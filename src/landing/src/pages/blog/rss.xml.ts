import type { APIRoute } from "astro";
import { authorOf, getPosts, postUrl } from "@/lib/blog";

const escapeXml = (value: string) =>
  value.replace(/[<>&'"]/g, (char) => {
    switch (char) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case "'":
        return "&apos;";
      default:
        return "&quot;";
    }
  });

export const GET: APIRoute = async ({ site }) => {
  const base = site ?? new URL("https://uniffy.io");
  const posts = await getPosts();
  const blogUrl = new URL("/blog/", base).href;
  const feedUrl = new URL("/blog/rss.xml", base).href;

  const items = posts.map((post) => {
    const url = new URL(postUrl(post), base).href;
    const categories = post.data.tags.map((tag) => `<category>${escapeXml(tag)}</category>`).join("");
    return [
      "<item>",
      `<title>${escapeXml(post.data.title)}</title>`,
      `<link>${url}</link>`,
      `<guid isPermaLink="true">${url}</guid>`,
      `<pubDate>${post.data.publishedAt.toUTCString()}</pubDate>`,
      `<description>${escapeXml(post.data.description)}</description>`,
      `<author>${escapeXml(authorOf(post).name)}</author>`,
      categories,
      "</item>",
    ].join("");
  });

  const lastBuild = posts[0]?.data.publishedAt ?? new Date();
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "<channel>",
    "<title>Uniffy Blog</title>",
    `<link>${blogUrl}</link>`,
    "<description>Engineering notes, product decisions, and the reasoning behind them, written by the people building Uniffy.</description>",
    "<language>en</language>",
    `<lastBuildDate>${lastBuild.toUTCString()}</lastBuildDate>`,
    `<atom:link href="${feedUrl}" rel="self" type="application/rss+xml"/>`,
    ...items,
    "</channel>",
    "</rss>",
  ].join("");

  return new Response(xml, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
};
