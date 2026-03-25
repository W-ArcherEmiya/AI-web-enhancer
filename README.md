# AI Web Enhancer

一个面向 ChatGPT 与 Gemini 网页版的 UserScript，用来生成侧边目录，提升长对话的浏览、定位与回溯效率。

## 功能

- 自动提取对话中的问题条目，生成侧边目录
- 点击目录快速跳转到对应位置
- 支持目录内搜索
- 支持回到顶部、直达底部
- 页面滚动时目录高亮会自动跟随
- 适配长对话场景，减少手动翻找内容的成本

## 适用平台

- ChatGPT Web
- Gemini Web

## 技术栈

- Vanilla JavaScript (ES6+)
- CSS3
- SVG 图标
- Tampermonkey UserScript

## 安装

先安装浏览器扩展 [Tampermonkey](https://www.tampermonkey.net/)。

然后通过 Greasy Fork 安装脚本：

[安装 AI 目录插件](https://greasyfork.org/zh-CN/scripts/563498-AI-%E7%9B%AE%E5%BD%95%E6%8F%92%E4%BB%B6-v2-0)

## 使用方式

安装完成后，打开 ChatGPT 或 Gemini 页面即可自动生效。

- 右侧会出现目录面板
- 点击目录项可跳转到对应问题
- 可使用搜索框过滤目录内容
- 可使用顶部和底部按钮快速导航

## 开发

克隆仓库：

```bash
git clone https://github.com/W-ArcherEmiya/AI-web-enhancer.git
```

本项目为单文件 UserScript，无外部依赖，核心脚本位于：

```text
AI-web-enhancer.js
```

本地调试时，可将脚本内容导入 Tampermonkey 后直接在目标网页验证。

## 反馈

如果你发现 Bug，或希望增加新功能，欢迎提交 Issue 或 PR：

- GitHub: https://github.com/W-ArcherEmiya/AI-web-enhancer

## License

MIT
