// ==UserScript==
// @name         Gemini 目录插件
// @namespace    http://tampermonkey.net/
// @version      2.1
// @description  生成高效的Gemini对话目录索引窗口。
// @author       Gemini Assistant
// @match        https://gemini.google.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // 1. 强力清理旧版 (防止冲突)
    function nukeOldVersions() {
        const ids = ['gemini-toc', 'gemini-toc-v2', 'gemini-toc-v2_3', 'gemini-toc-v2_4', 'gemini-toc-v2_5', 'gemini-toc-style', 'gemini-toc-style-v2_4', 'gemini-toc-style-v2_5'];
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.remove();
        });
        document.querySelectorAll('style[id^="gemini-toc"]').forEach(el => el.remove());
    }
    nukeOldVersions();

    console.log("Gemini Plugin v2.1: 启动中...");

    const CONFIG = {
        selector: '.query-text-line',
        displayCount: 8
    };

    // 2. 图标路径定义
    const PATHS = {
        search: "M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z",
        top: "M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z",
        bottom: "M20 12l-1.41-1.41L13 16.17V4h-2v12.17l-5.58-5.59L4 12l8 8 8-8z",
        spin: "M12 4V2A10 10 0 0 0 2 12h2a8 8 0 0 1 8-8z",
        // ★ 修改：这里改回了实心圆点 (Radius=5)
        bullet: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z"
    };

    // 3. 安全 DOM 构建
    function createIcon(key, className) {
        const svgNS = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(svgNS, "svg");
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("width", "20");
        svg.setAttribute("height", "20");
        svg.setAttribute("fill", "currentColor");
        if (className) svg.setAttribute("class", className);
        const path = document.createElementNS(svgNS, "path");
        path.setAttribute("d", PATHS[key] || "");
        svg.appendChild(path);
        return svg;
    }

    // 4. 样式注入
    function injectStyles() {
        const styleId = 'gemini-toc-style-v2_6';
        if (document.getElementById(styleId)) return;

        const maxH = CONFIG.displayCount * 36;
        const css = `
            #gemini-toc-v2_6 {
                position: fixed; top: 80px; right: 24px; width: 280px;
                background: #1e1f20; color: #e3e3e3; border-radius: 24px;
                z-index: 2147483647; overflow: hidden;
                box-shadow: 0 4px 8px 3px rgba(0,0,0,0.15), 0 1px 3px rgba(0,0,0,0.3);
                font-family: Roboto, sans-serif;
                display: flex; flex-direction: column; height: auto; max-height: 85vh;
                border: 1px solid #444746; opacity: 0; transition: opacity 0.3s;
                contain: content; /* 防干扰 */
            }
            #gemini-toc-v2_6.toc-visible { opacity: 1; }

            .toc-header { padding: 16px 16px 8px 16px; background: #1e1f20; flex-shrink: 0; }
            .toc-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
            .toc-title { font-weight: 500; font-size: 14px; color: #e3e3e3; padding-left: 4px; }

            .toc-btn {
                background: transparent; border: none; color: #c4c7c5; cursor: pointer;
                width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
                transition: background 0.2s;
            }
            .toc-btn:hover { background: rgba(255,255,255,0.1); color: #e3e3e3; }
            .toc-spin { animation: spin 1s linear infinite; }
            @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }

            .toc-search { position: relative; margin-bottom: 4px; }
            .toc-search input {
                width: 100%; background: #2b2c2e; border: 1px solid transparent; color: #e3e3e3;
                padding: 10px 16px 10px 40px; border-radius: 24px; box-sizing: border-box; outline: none; font-size: 13px;
            }
            .toc-search input:focus { background: #1e1f20; border-color: #a8c7fa; }
            .toc-search-icon { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: #c4c7c5; display: flex; }

            #toc-list {
                list-style: none; padding: 0; margin: 0; flex-grow: 1;
                overflow-y: auto; max-height: ${maxH}px; padding-bottom: 8px;
            }
            #toc-list::-webkit-scrollbar { width: 8px; }
            #toc-list::-webkit-scrollbar-thumb { background: #444746; border-radius: 4px; border: 2px solid #1e1f20; }

            .toc-item {
                padding: 8px 16px; margin: 0 4px; border-radius: 16px; cursor: pointer;
                font-size: 13px; color: #c4c7c5; display: flex; align-items: center;
                transition: background 0.1s;
            }
            .toc-item:hover { background: rgba(232,234,237,0.08); color: #e3e3e3; }
            .toc-icon { margin-right: 12px; color: #a8c7fa; display: flex; align-items: center; }

            /* 这里可以微调圆点大小 */
            .toc-icon svg { width: 10px; height: 10px; }

            .toc-text { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .toc-hidden { display: none !important; }
            .toc-status { padding: 20px; text-align: center; color: #8e918f; font-size: 12px; }
        `;
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = css;
        document.head.appendChild(style);
    }

    // 5. 逻辑实现
    function createUI() {
        if (document.getElementById('gemini-toc-v2_6')) return;
        if (!document.body) return;

        injectStyles();

        const panel = document.createElement('div');
        panel.id = 'gemini-toc-v2_6';
        panel.className = 'notranslate';
        panel.setAttribute('translate', 'no');

        // 头部结构
        const header = document.createElement('div'); header.className = 'toc-header';

        const row = document.createElement('div'); row.className = 'toc-row';
        const title = document.createElement('span'); title.className = 'toc-title'; title.textContent = '对话索引';

        const btnGroup = document.createElement('div');
        btnGroup.style.display = 'flex'; btnGroup.style.gap = '4px';

        const topBtn = document.createElement('button'); topBtn.className = 'toc-btn';
        topBtn.title = '回溯顶部'; topBtn.appendChild(createIcon('top')); topBtn.onclick = handleTop;

        const botBtn = document.createElement('button'); botBtn.className = 'toc-btn';
        botBtn.title = '直达底部'; botBtn.appendChild(createIcon('bottom')); botBtn.onclick = handleBot;

        btnGroup.append(topBtn, botBtn);
        row.append(title, btnGroup);

        const searchDiv = document.createElement('div'); searchDiv.className = 'toc-search';
        const searchIcon = document.createElement('span'); searchIcon.className = 'toc-search-icon';
        searchIcon.appendChild(createIcon('search'));
        const input = document.createElement('input');
        input.type = 'text'; input.placeholder = '搜索...';
        input.addEventListener('input', (e) => filterList(e.target.value));

        searchDiv.append(searchIcon, input);
        header.append(row, searchDiv);

        const list = document.createElement('ul'); list.id = 'toc-list';

        panel.append(header, list);
        document.body.appendChild(panel);

        // 拖拽
        header.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.closest('button')) return;
            const startX = e.clientX, startY = e.clientY;
            const rect = panel.getBoundingClientRect();
            const startLeft = rect.left, startTop = rect.top;

            function onMove(ev) {
                panel.style.left = startLeft + (ev.clientX - startX) + 'px';
                panel.style.top = startTop + (ev.clientY - startY) + 'px';
                panel.style.right = 'auto';
            }
            function onUp() {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            }
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });

        setTimeout(() => panel.classList.add('toc-visible'), 100);
        scanContent();
    }

    // 辅助功能
    function getScrollContainer() {
        const anchor = document.querySelector(CONFIG.selector);
        if (!anchor) return document.documentElement;
        let p = anchor.parentElement;
        while (p && p !== document.body) {
            if (p.scrollHeight > p.clientHeight && (getComputedStyle(p).overflowY === 'auto' || getComputedStyle(p).overflowY === 'scroll')) return p;
            p = p.parentElement;
        }
        return document.documentElement;
    }

    function handleTop() {
        const btn = this;
        btn.disabled = true;
        btn.textContent = ''; btn.appendChild(createIcon('spin', 'toc-spin'));
        const container = getScrollContainer();
        let retries = 0, lastH = 0;

        const timer = setInterval(() => {
            container.scrollTop = 0;
            document.documentElement.scrollTop = 0;
            const curH = container.scrollHeight;
            if (curH > lastH) { lastH = curH; retries = 0; } else { retries++; }
            if (retries > 8) {
                clearInterval(timer);
                btn.disabled = false;
                btn.textContent = ''; btn.appendChild(createIcon('top'));
                scanContent();
            }
        }, 100);
    }

    function handleBot() {
        const c = getScrollContainer();
        c.scrollTo({ top: c.scrollHeight, behavior: 'smooth' });
    }

    function filterList(val) {
        const items = document.querySelectorAll('.toc-item');
        const v = val.toLowerCase();
        items.forEach(it => {
            const t = it.getAttribute('data-text') || '';
            it.classList.toggle('toc-hidden', !t.includes(v));
        });
    }

    // --- 核心扫描逻辑 ---
    function scanContent() {
        const list = document.getElementById('toc-list');
        if (!list) return;

        // 1. 获取所有文本行
        const allLines = Array.from(document.querySelectorAll(CONFIG.selector));

        // 2. 聚合多行消息 (Group by Parent)
        const messages = [];
        let currentGroup = null;

        allLines.forEach(line => {
            const parent = line.parentElement;
            if (currentGroup && currentGroup.container === parent) {
                currentGroup.text += ' ' + line.innerText.trim();
            } else {
                if (currentGroup) messages.push(currentGroup);
                currentGroup = {
                    container: parent,
                    text: line.innerText.trim()
                };
            }
        });
        if (currentGroup) messages.push(currentGroup);

        const total = messages.length;

        // 3. 空状态处理
        if (total === 0) {
            if (!list.querySelector('.toc-status')) {
                list.textContent = '';
                const li = document.createElement('li');
                li.className = 'toc-status'; li.textContent = '...';
                list.appendChild(li);
            }
            return;
        } else {
            if (list.querySelector('.toc-status')) list.textContent = '';
        }

        // 4. 增量更新列表
        for (let i = 0; i < total; i++) {
            const msg = messages[i];
            const txt = msg.text;

            let item = list.children[i];
            if (!item) {
                item = document.createElement('li');
                item.className = 'toc-item';

                const iconDiv = document.createElement('span');
                iconDiv.className = 'toc-icon';
                iconDiv.appendChild(createIcon('bullet'));

                const textDiv = document.createElement('span');
                textDiv.className = 'toc-text';

                item.appendChild(iconDiv);
                item.appendChild(textDiv);
                list.appendChild(item);
            }

            // 检查内容更新
            const oldT = item.getAttribute('data-text');
            const newT = txt.toLowerCase();

            if (oldT !== newT) {
                item.setAttribute('data-text', newT);
                item.title = txt;
                item.querySelector('.toc-text').textContent = txt;
            }

            // 强制更新点击事件
            item.onclick = () => {
                if (msg.container && msg.container.isConnected) {
                    msg.container.scrollIntoView({behavior:'smooth', block:'center'});
                } else {
                    handleBot();
                }

                const oldBg = item.style.background;
                item.style.background = '#444a50';
                setTimeout(() => item.style.background = oldBg, 300);
            };
        }

        // 移除多余项
        while (list.children.length > total) {
            list.removeChild(list.lastChild);
        }

        // 保持过滤
        const input = document.querySelector('.toc-search input');
        if (input && input.value) filterList(input.value);

        // 自动沉底
        const c = getScrollContainer();
        const atBottom = (list.scrollHeight - list.scrollTop) <= (list.clientHeight + 40);
        const loading = document.querySelector('.toc-btn button[disabled]');
        if (!loading && atBottom) list.scrollTop = list.scrollHeight;
    }

    // 启动
    setInterval(() => {
        const p = document.getElementById('gemini-toc-v2_6');
        if (!p) createUI(); else scanContent();
    }, 800);

})();