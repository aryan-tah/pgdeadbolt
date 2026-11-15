import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://pgdeadbolt.aryantah.com",
  integrations: [
    starlight({
      title: "pgdeadbolt",
      description: "Stop AI coding agents from shipping Postgres migrations that lock your tables.",
      logo: { src: "./src/assets/logo.svg" },
      favicon: "/favicon.svg",
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/aryan-tah/pgdeadbolt" }],
      editLink: { baseUrl: "https://github.com/aryan-tah/pgdeadbolt/edit/main/docs/" },
      lastUpdated: true,
      sidebar: [
        { label: "Start here", items: ["getting-started", "guides/configuration"] },
        {
          label: "Coding agents",
          items: ["guides/claude-code", "guides/codex-and-cursor"],
        },
        {
          label: "Guides",
          items: ["guides/github-action", "guides/rehearse", "guides/frameworks"],
        },
        { label: "Rules", items: [{ autogenerate: { directory: "rules" } }] },
      ],
      head: [
        { tag: "meta", attrs: { property: "og:image", content: "https://pgdeadbolt.aryantah.com/og.png" } },
      ],
    }),
  ],
});
