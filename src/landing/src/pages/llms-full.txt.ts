import type { APIRoute } from "astro";
import { getPosts } from "@/lib/blog";
import { getDocs, renderFull } from "@/lib/llms";

export const GET: APIRoute = async ({ site }) => {
  const base = site ?? new URL("https://uniffy.io");
  const [docs, posts] = await Promise.all([getDocs(), getPosts()]);
  return new Response(renderFull(base, docs, posts), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
