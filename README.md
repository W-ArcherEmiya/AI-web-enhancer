# AI Web Enhancer

面向 ChatGPT、Gemini 与 Claude 网页版的 Tampermonkey 用户脚本，用于生成侧边目录，提升长对话场景下的浏览、定位与回看效率。

## 面板: 
![demo](https://raw.githubusercontent.com/W-ArcherEmiya/Images/main/ai_web_enhancer/scrennshoot_board.png)

## 侧边气泡:
![demo](https://raw.githubusercontent.com/W-ArcherEmiya/Images/main/ai_web_enhancer/scrennshoot_bubble.png)


## 功能

- 自动提取用户问题并生成侧边目录
- 点击目录快速跳转到对应位置
- 支持目录搜索过滤
- 支持一键回到顶部、直达底部
- 页面滚动时自动高亮当前条目
- 目录会跟随当前阅读位置自动滚回到对应条目
- 支持纯图片消息生成目录项，避免图片提问丢失
- 针对长对话与大 DOM 场景做了扫描与滚动性能优化

## 最新版本

### v2.8.1

- 修复 ChatGPT 原生目录分段挂载时覆盖完整会话数据，导致目录条目缺失的问题。
- 完整会话数据作为目录主数据源，原生目录仅用于补充真实跳转锚点。
- 修复部分条目跳转后用户问题贴近页面顶部并被悬浮区域遮挡的问题。

### v2.8.0

- 新增 Claude Web 基础支持，可为 Claude 对话生成侧边目录并点击跳转。
- Claude 页面使用 `Cl` 气泡标签，保持与 ChatGPT、Gemini 一致的目录交互。
- 继续保留 ChatGPT 长对话完整目录和精确跳转能力。

## 适用平台

- ChatGPT Web
- Gemini Web
- Claude Web

## 技术栈

- Vanilla JavaScript
- CSS3
- SVG
- Tampermonkey UserScript

## 安装

先安装浏览器扩展 [Tampermonkey](https://www.tampermonkey.net/)。

然后通过 Greasy Fork 安装脚本：

[安装 AI 目录插件](https://greasyfork.org/zh-CN/scripts/563498-AI-%E7%9B%AE%E5%BD%95%E6%8F%92%E4%BB%B6-v2-0)

## 使用方式

安装完成后，打开 ChatGPT、Gemini 或 Claude 页面即可自动生效。

- 右侧会出现目录面板
- 点击目录项可跳转到对应问题
- 输入关键字可过滤目录内容
- 使用顶部和底部按钮可快速导航

## 开发

克隆仓库：

```bash
git clone https://github.com/W-ArcherEmiya/AI-web-enhancer.git
```

核心脚本文件：

```text
AI-web-enhancer.js
```

本地性能回归页：

```text
stress-test.html
```

本地调试时，可将脚本内容导入 Tampermonkey 后直接在目标网页验证。

## 反馈

如发现 Bug 或希望增加功能，欢迎提交 Issue 或 PR：

- GitHub: https://github.com/W-ArcherEmiya/AI-web-enhancer

## License

MIT
