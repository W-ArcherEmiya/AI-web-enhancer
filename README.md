# ai-chat-outline


▎ Adds a sidebar table of contents to ChatGPT, Gemini and Claude. Jump to any previous prompt in long conversations, filter by keyword, and return to top or bottom instantly. Auto-highlights your current position. Optimized for very long chats.

▎ 为 ChatGPT、Gemini、Claude 网页版生成侧边目录，长对话中可快速跳转到任意历史提问，支持关键词过滤、一键回顶/到底，并自动高亮当前阅读位置。针对超长对话做了性能优化。

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

### v2.8.3

- 修复 ChatGPT 虚拟列表滚动时已发现目录条目被新一轮 DOM 扫描替换，导致条目反复消失/出现的问题。
- ChatGPT 目录会按消息 ID、原生目录序号、远程序号与文本签名保留本地稳定快照，远程会话接口失败时也尽量保持已识别条目不丢失。

### v2.8.2

- 项目更名为 `ai-chat-outline`，同步更新 README、脚本元信息、测试页引用和核心脚本文件名。
- README 顶部描述更新为中英文双语说明，突出长对话目录、关键词过滤、回顶/到底和当前位置高亮能力。

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

[安装 ai-chat-outline](https://greasyfork.org/zh-CN/scripts/563498-ai-chat-outline)

## 使用方式

安装完成后，打开 ChatGPT、Gemini 或 Claude 页面即可自动生效。

- 右侧会出现目录面板
- 点击目录项可跳转到对应问题
- 输入关键字可过滤目录内容
- 使用顶部和底部按钮可快速导航

## 开发

克隆仓库：

```bash
git clone https://github.com/W-ArcherEmiya/ai-chat-outline.git
```

核心脚本文件：

```text
ai-chat-outline.js
```

本地性能回归页：

```text
stress-test.html
```

本地调试时，可将脚本内容导入 Tampermonkey 后直接在目标网页验证。

## 反馈

如果这个脚本对你有帮助，欢迎在 GitHub 点一个 Star。

如发现 Bug 或希望增加功能，欢迎提交 Issue 或 PR：

- GitHub: https://github.com/W-ArcherEmiya/ai-chat-outline

## License

MIT
