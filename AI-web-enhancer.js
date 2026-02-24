// ==UserScript==
// @name         AI 目录插件 (Gemini & ChatGPT)
// @namespace    http://tampermonkey.net/
// @version      2.2
// @description  生成高效的 Gemini 与 ChatGPT 对话目录索引窗口。
// @author       ArcherEmiya
// @match        https://gemini.google.com/*
// @match        https://chatgpt.com/*
// @grant        none
// @run-at       document-idle
// @license      MIT
// ==/UserScript==

(function() {
    'use strict';

    // 1. 强力清理旧版残留
    function cleanUpOldVersions() {
        const ids = ['gemini-toc', 'gemini-toc-v2', 'gemini-toc-v2_1', 'gemini-toc-v2_3', 'gemini-toc-v2_4', 'gemini-toc-v2_5', 'gemini-toc-v2_6', 'ai-toc-style'];
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.remove();
        });
        document.querySelectorAll('style[id^="gemini-toc"], style[id^="ai-toc"]').forEach(el => el.remove());
    }
    cleanUpOldVersions();

    console.log("AI TOC Plugin v2.2: 启动中...");

    // 智能识别当前站点配置选择器
    const IS_CHATGPT = window.location.hostname.includes('chatgpt.com');
    const CONFIG = {
        selector: IS_CHATGPT ? '[data-message-author-role="user"]' : '.query-text-line',
        displayCount: 8
    };

    // 2. 图标路径定义 (实心圆点)
    const PATHS = {
        search: "M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z",
        top: "M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z",
        bottom: "M20 12l-1.41-1.41L13 16.17V4h-2v12.17l-5.58-5.59L4 12l8 8 8-8z",
        spin: "M12 4V2A10 10 0 0 0 2 12h2a8 8 0 0 1 8-8z",
        bullet: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z" // 实心圆点
    };

    // 3. 安全 DOM 构建 (禁止 innerHTML)
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
        const styleId = 'ai-toc-style-v2_2';
        if (document.getElementById(styleId)) return;

        const maxH = CONFIG.displayCount * 36;
        const css = `
            #ai-toc-v2_2 {
                position: fixed; top: 80px; right: 24px; width: 280px;
                background: #1e1f20; color: #e3e3e3; border-radius: 24px;
                z-index: 2147483647; overflow: hidden;
                box-shadow: 0 4px 8px 3px rgba(0,0,0,0.15), 0 1px 3px rgba(0,0,0,0.3);
                font-family: Roboto, sans-serif;
                display: flex; flex-direction: column; height: auto; max-height: 85vh;
                border: 1px solid #444746; opacity: 0; transition: opacity 0.3s;
                contain: content; /* 防干扰 */
            }
            #ai-toc-v2_2.toc-visible { opacity: 1; }
            
            /* 防止翻译插件干扰 */
            #ai-toc-v2_2.notranslate { translate: no; }

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

    // 5. UI 初始化
    function createUI() {
        if (document.getElementById('ai-toc-v2_2')) return;
        if (!document.body) return;

        injectStyles();

        const panel = document.createElement('div');
        panel.id = 'ai-toc-v2_2';
        panel.className = 'notranslate';
        panel.setAttribute('translate', 'no');

        const header = document.createElement('div'); header.className = 'toc-header';
        
        const row = document.createElement('div'); row.className = 'toc-row';
        const title = document.createElement('span'); title.className = 'toc-title'; 
        title.textContent = IS_CHATGPT ? 'ChatGPT 索引' : 'Gemini 索引';
        
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

        // 简单的拖拽逻辑
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
        // 安全替换图标
        while(btn.firstChild) btn.removeChild(btn.firstChild);
        btn.appendChild(createIcon('spin', 'toc-spin'));
        
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
                while(btn.firstChild) btn.removeChild(btn.firstChild);
                btn.appendChild(createIcon('top'));
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

    // 6. 核心扫描逻辑
    function scanContent() {
        const list = document.getElementById('toc-list');
        if (!list) return;

        // 聚合多行消息
        const allLines = Array.from(document.querySelectorAll(CONFIG.selector));
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

        // 空状态
        if (total === 0) {
            if (!list.querySelector('.toc-status')) {
                while(list.firstChild) list.removeChild(list.firstChild);
                const li = document.createElement('li');
                li.className = 'toc-status'; li.textContent = '...';
                list.appendChild(li);
            }
            return;
        } else {
            if (list.querySelector('.toc-status')) {
                while(list.firstChild) list.removeChild(list.firstChild);
            }
        }

        // 增量更新
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

            const oldT = item.getAttribute('data-text');
            const newT = txt.toLowerCase();

            if (oldT !== newT) {
                item.setAttribute('data-text', newT);
                item.title = txt;
                item.querySelector('.toc-text').textContent = txt;
            }

            // 强制重新绑定事件
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
        
        // 移除多余
        while (list.children.length > total) {
            list.removeChild(list.lastChild);
        }

        // 保持搜索
        const input = document.querySelector('.toc-search input');
        if (input && input.value) filterList(input.value);
        
        // 自动沉底
        const c = getScrollContainer();
        const atBottom = (list.scrollHeight - list.scrollTop) <= (list.clientHeight + 40);
        const loading = document.querySelector('.toc-btn button[disabled]');
        if (!loading && atBottom) list.scrollTop = list.scrollHeight;
    }

    // 启动循环
    setInterval(() => {
        const p = document.getElementById('ai-toc-v2_2');
        if (!p) createUI(); else scanContent();
    }, 800);

})();