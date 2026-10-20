import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";
import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";
import { authorIds } from "./data/blog/authors";

const blog = defineCollection({
  loader: glob({ pattern: "**/[^_]*.md", base: "./src/content/blog" }),
  schema: ({ image }) =>
    z.object({
      title: z.string().min(1).max(120),
      description: z.string().min(1).max(320),
      publishedAt: z.coerce.date(),
      updatedAt: z.coerce.date().optional(),
      author: z.enum(authorIds).default("team"),
      tags: z.array(z.string().min(1)).max(4).default([]),
      accent: z.enum(["violet", "pink", "orange", "green"]).optional(),
      cover: image().optional(),
      coverAlt: z.string().optional(),
      draft: z.boolean().default(false),
    }),
});

export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
  blog,
};
