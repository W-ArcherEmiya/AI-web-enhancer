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

### v2.8.7

- 修复 ChatGPT 新版页面首次打开长对话时，目录只显示当前位置附近条目的问题。
- 使用当前登录身份读取完整会话树，并兼容会话数据的新包装结构。
- 区分接口错误与解析失败，避免 404 响应被误判为空会话。
- 局部虚拟列表不再被误认为完整槽位列表；滚动高亮按真实消息 ID 和当前分支映射。
- 点击未挂载条目时快速定位其虚拟区间，只有挂载并校验目标消息 ID 后才完成跳转。

### v2.8.6

- 修复 Claude 长对话只显示当前浏览区域内目录条目的问题。
- 参照稳定实现，从 Claude 的真实滚动容器直接读取 `[data-testid="user-message"]`，不使用可见性过滤或分组容器推断。
- Claude 局部 DOM 批次只更新锚点；仅在序列完整或存在明确前后重叠时扩展目录，不再缩短或重排已有条目。
- 点击目录时按序号和完整文本双重校验真实节点，并立即跳转；找不到精确节点时不执行估算滚动。
- 页面会话数据只在比 DOM 目录更完整时作为补充来源，不覆盖更完整的稳定目录。

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
