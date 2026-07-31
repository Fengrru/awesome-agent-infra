import { defineConfig } from "vitepress"

const guideSidebar = [
  {
    text: "指南",
    items: [
      { text: "快速开始", link: "/guide/quickstart" },
      { text: "架构总览", link: "/guide/architecture" },
      { text: "如何选择包", link: "/guide/choosing-packages" },
      { text: "稳定性与版本", link: "/guide/stability" },
      { text: "贡献指南", link: "/guide/contributing" },
    ],
  },
]

export default defineConfig({
  title: "Agent Kit",
  description: "42 battle-tested, zero-dependency TypeScript packages for building reliable AI agents.",
  base: "/awesome-agent-infra/",
  lang: "zh-CN",
  head: [["link", { rel: "icon", href: "/awesome-agent-infra/favicon.svg" }]],
  themeConfig: {
    logo: "/awesome-agent-infra/favicon.svg",
    nav: [
      { text: "指南", link: "/guide/quickstart", activeMatch: "/guide/" },
      { text: "包目录", link: "/packages" },
      { text: "API 参考", link: "/api/" },
      { text: "示例", link: "https://github.com/Fengrru/awesome-agent-infra/tree/main/examples" },
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
      options: {
        translations: {
          button: { buttonText: "搜索文档", buttonAriaLabel: "搜索文档" },
          modal: {
            noResultsText: "未找到相关结果",
            resetButtonTitle: "清除查询条件",
            footer: { selectText: "选择", navigateText: "切换", closeText: "关闭" },
          },
        },
      },
    },
    socialLinks: [{ icon: "github", link: "https://github.com/Fengrru/awesome-agent-infra" }],
    footer: { message: "MIT License", copyright: "Copyright © 2026 Fengrru" },
    editLink: {
      pattern: "https://github.com/Fengrru/awesome-agent-infra/edit/main/docs/:path",
      text: "编辑此页面",
    },
    lastUpdated: { text: "最后更新" },
    docFooter: { prev: "上一篇", next: "下一篇" },
  },
})
