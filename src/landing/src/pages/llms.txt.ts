import type { APIRoute } from "astro";
import { collectSections, renderIndex } from "@/lib/llms";

export const GET: APIRoute = async ({ site }) => {
  const base = site ?? new URL("https://uniffy.io");
  const sections = await collectSections(base);
  return new Response(renderIndex(sections), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
