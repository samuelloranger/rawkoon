import { defineConfig } from "vitepress";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  lang: "en-US",
  base: process.env.GITHUB_ACTIONS === "true" ? "/rawkoon/" : "/",
  title: "Rawkoon",
  description: "Self-hosted movie and TV library documentation",
  sitemap: { hostname: "https://samlo.cloud/rawkoon/" },
  cleanUrls: true,
  appearance: false,
  vite: {
    publicDir: fileURLToPath(new URL("../../apps/web/public", import.meta.url)),
  },
  themeConfig: {
    logo: { src: "/icon.svg", alt: "Rawkoon" },
    nav: [
      { text: "Use Rawkoon", link: "/getting-started" },
      { text: "Self-host Rawkoon", link: "/self-hosting" },
      { text: "Development", link: "/architecture" },
    ],
    sidebar: [
      {
        text: "Use Rawkoon",
        items: [
          { text: "Getting started", link: "/getting-started" },
          { text: "Quality profiles", link: "/library/quality-profiles" },
          { text: "Media metadata", link: "/library/metadata" },
          { text: "Downloads and files", link: "/library/downloads-and-files" },
        ],
      },
      {
        text: "Self-host Rawkoon",
        items: [
          { text: "Self-hosting", link: "/self-hosting" },
          { text: "Integrations", link: "/integrations" },
          { text: "Deployment and recovery", link: "/deployment" },
        ],
      },
      {
        text: "Development",
        items: [
          { text: "Architecture", link: "/architecture" },
          { text: "Decisions", link: "/decisions" },
          { text: "Contributing", link: "/development/contributing" },
          { text: "Web API client", link: "/development/api-client" },
        ],
      },
    ],
    socialLinks: [{ icon: "github", link: "https://github.com/samuelloranger/rawkoon" }],
    outline: [2, 3],
  },
});
