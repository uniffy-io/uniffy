import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://uniffy.io",
  integrations: [
    starlight({
      title: "Uniffy Docs",
      logo: {
        src: "./src/assets/uniffy-glyph.png",
        alt: "Uniffy",
        replacesTitle: false,
      },
      favicon: "/favicon.ico",
      customCss: ["./src/styles/global.css", "./src/styles/starlight.css"],
      components: {
        Header: "./src/components/docs/DocsHeader.astro",
        Footer: "./src/components/docs/DocsFooter.astro",
        Sidebar: "./src/components/docs/DocsSidebar.astro",
        Pagination: "./src/components/docs/DocsPagination.astro",
      },
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/uniffy-io/uniffy",
        },
      ],
      sidebar: [
        {
          label: "Introduction",
          items: [{ label: "Overview", link: "/docs/" }],
        },
        {
          label: "User Guide",
          items: [{ autogenerate: { directory: "docs/user" } }],
        },
        {
          label: "Administration Guide",
          items: [{ autogenerate: { directory: "docs/administration" } }],
        },
        {
          label: "Deployment Guide",
          items: [{ autogenerate: { directory: "docs/deployment" } }],
        },
      ],
      disable404Route: true,
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
    server: {
      allowedHosts: true,
    },
  },
});
