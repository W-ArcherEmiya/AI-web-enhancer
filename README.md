# AI Web Enhancer

面向 ChatGPT 与 Gemini 网页版的 Tampermonkey 用户脚本，用于生成侧边目录，提升长对话场景下的浏览、定位与回看效率。

## 功能

- 自动提取用户问题并生成侧边目录
- 点击目录快速跳转到对应位置
- 支持目录搜索过滤
- 支持一键回到顶部、直达底部
- 页面滚动时自动高亮当前条目
- 目录会跟随当前浏览位置自动回滚到对应条目
- 支持纯图片消息生成目录项，避免图片提问丢失
- 针对长对话与大体量 DOM 场景做了滚动与扫描性能优化

## 最新版本

### v2.4

- 修复 ChatGPT 中目录点击后高亮偶尔落在上一条的问题
- 修复 Gemini 中目录点击后更容易落到 AI 回答区域的问题
- 新增纯图片消息目录兜底，支持显示 `图片`、`图片 xN`、`图片：描述`
- 优化目录自动跟随当前阅读位置的行为
- 优化长对话、大 DOM 场景下的目录扫描与滚动同步性能

## 适用平台

- ChatGPT Web
- Gemini Web

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

安装完成后，打开 ChatGPT 或 Gemini 页面即可自动生效。

- 右侧会出现目录面板
- 点击目录项可跳转到对应问题
- 输入关键词可过滤目录内容
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
