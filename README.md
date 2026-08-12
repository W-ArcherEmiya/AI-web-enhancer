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

### v2.8.5

- 修复 ChatGPT 虚拟列表切换节点时目录高亮回到第 1 条或乱跳的问题。
- 高亮改为使用完整用户消息槽位计算，消息暂未挂载时仍能连续跟随阅读位置。
- ChatGPT 原生 `Prompt N` 可用时直接作为目录来源；不可用时读取页面自身返回的当前会话分支，不额外请求接口。
- 页面会话数据暂不可用时，按消息 ID 和会话节点缓存已确认条目，滚动卸载只断开锚点，不删除或重排目录。
- 只读取 ChatGPT 当前会话分支，暂停后编辑重发产生的废弃提问不会进入目录。
- 相同内容的多次提问会分别保留，并按真实消息 ID 或会话序号绑定和跳转。

### v2.8.4

- 修复 ChatGPT 页面滚动后目录条目顺序逐渐错乱，导致点击跳转到错误位置的问题。
- 目录稳定快照改为使用固定序号排序，滚动时只更新锚点，不再用虚拟列表动态位置重排。
- 降低文本签名误合并风险，优先使用消息 ID、远程序号、原生目录序号等强标识。

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
