# AI Web Enhancer (Chatgpt & Gemini)

这是一个为 Chatgpt & Gemini 网页版设计的油猴脚本 (UserScript)，旨在提升用户的使用体验，提供更高效的导航和阅读辅助功能。

## 🚀 主要功能 (Features)

* **📑 自动生成目录 (Table of Contents):** 自动识别对话中的内容，在侧边栏生成目录，点击即可快速跳转，长文阅读必备。
* **🔍 页面内搜索 (Search):** 增强的搜索功能，帮助你快速定位历史对话中的关键信息。
* **⚡ 极致丝滑体验:** 无感增量更新，目录刷新不闪烁。
* **🛡️ 强力防冲突:** 完美兼容“沉浸式翻译”等第三方插件。

## 💻 技术栈与架构 (Tech Stack & Architecture)

本项目坚持**零外部依赖**，以极致轻量和极高兼容性为目标：

* **核心语言**: Vanilla JavaScript (ES6+), CSS3 (动态注入), SVG (矢量图标绘制)。
* **🛡️ 纯 DOM 安全架构 (Trusted Types 兼容)**: 针对 Google 极其严格的 Content Security Policy (CSP)，全程零 `innerHTML` 注入，完全采用 `createElementNS` 和 `replaceChildren` 等原生 API 构建 DOM，100% 绕过安全拦截。
* **🔄 增量更新算法 (DOM Diffing)**: 摒弃“全量销毁重建”的粗暴重绘，实现了一套轻量级的 Virtual DOM Diff 算法。通过逐行精准比对，仅对变动节点进行更新，彻底根除列表闪烁问题。
* **🧩 智能多行聚合 (Message Grouping)**: 针对多行文本被拆分的问题，采用基于 `parentElement` 的向上溯源算法，将属于同一消息气泡内的文本智能合并为一条目录索引。
* **🧱 隔离与防干扰设计 (Anti-Interference)**: 
  * **属性级隔离**: 使用 `notranslate` 类、`translate="no"` 属性及 CSS `contain: content`，有效防御“沉浸式翻译”等插件的恶意读写和 DOM 劫持。
  * **暴力清理 (Nuke)**: 每次启动自动扫描并销毁旧版本历史残留，杜绝多版本重叠冲突。
* **⏱️ 高效轮询侦听 (Polling Observer)**: 在 DOM 变动极其频繁的 SPA（单页应用）环境中，采用 `setInterval` 心跳机制代替 `MutationObserver`，实现天然防抖 (Debounce)，大幅降低持续的 CPU 性能开销。

## 📥 安装方法 (Installation)

本项目已发布在 Greasy Fork，你可以点击下方链接一键安装：

👉 **[点击这里前往 Greasy Fork 安装](https://greasyfork.org/zh-CN/scripts/563498-AI-%E7%9B%AE%E5%BD%95%E6%8F%92%E4%BB%B6-v2-0)**

> **注意：** 你需要先安装 [Tampermonkey](https://www.tampermonkey.net/) (篡改猴) 浏览器扩展。

## 🛠️ 本地开发 (Development)

如果你想参与贡献或在本地调试：

1. 克隆本项目：
   ```bash
   git clone [https://github.com/W-ArcherEmiya/AI-web-enhancer.git](https://github.com/W-ArcherEmiya/AI-web-enhancer.git)

```

## 📝 反馈 (Feedback)

如果你发现了 Bug 或有新功能建议，欢迎在 GitHub 提交 Issue，或在 Greasy Fork 评论区留言。

Built with ❤️ by [ArcherEmiya]

```