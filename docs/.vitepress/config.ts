import { defineConfig } from "vitepress"

const guideSidebar = [
  {
    text: "Guide",
    items: [
      { text: "Quick Start", link: "/guide/quickstart" },
      { text: "Architecture", link: "/guide/architecture" },
      { text: "Choosing Packages", link: "/guide/choosing-packages" },
      { text: "Stability & Versioning", link: "/guide/stability" },
      { text: "Contributing", link: "/guide/contributing" },
    ],
  },
]

export default defineConfig({
  title: "Agent Kit",
  description: "42 battle-tested, zero-dependency TypeScript packages for building reliable AI agents.",
  base: "/awesome-agent-infra/",
  lang: "en-US",
  head: [["link", { rel: "icon", href: "/awesome-agent-infra/favicon.svg" }]],
  themeConfig: {
    logo: "/awesome-agent-infra/favicon.svg",
    nav: [
      { text: "Guide", link: "/guide/quickstart", activeMatch: "/guide/" },
      { text: "Packages", link: "/packages" },
      { text: "API Reference", link: "/api/" },
      { text: "Examples", link: "https://github.com/Fengrru/awesome-agent-infra/tree/main/examples" },
      {
        text: "GitHub",
        link: "https://github.com/Fengrru/awesome-agent-infra",
      },
    ],
    sidebar: {
      "/guide/": guideSidebar,
      "/": guideSidebar,
    },
    outline: { level: [2, 3] },
    search: {
      provider: "local",
    },
    socialLinks: [{ icon: "github", link: "https://github.com/Fengrru/awesome-agent-infra" }],
    footer: { message: "MIT License", copyright: "Copyright © 2026 Fengrru" },
    editLink: {
      pattern: "https://github.com/Fengrru/awesome-agent-infra/edit/main/docs/:path",
      text: "Edit this page",
    },
    lastUpdated: { text: "Last updated" },
    docFooter: { prev: "Previous", next: "Next" },
  },
})
