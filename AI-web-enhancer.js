// ==UserScript==
// @name         AI 目录插件 (Gemini & ChatGPT)
// @namespace    http://tampermonkey.net/
// @version      2.4
// @description  生成高效的 Gemini 与 ChatGPT 对话目录索引窗口。
// @author       ArcherEmiya
// @match        https://gemini.google.com/*
// @match        https://chatgpt.com/*
// @grant        none
// @run-at       document-idle
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    function cleanUpOldVersions() {
        const ids = [
            'gemini-toc',
            'gemini-toc-v2',
            'gemini-toc-v2_1',
            'gemini-toc-v2_3',
            'gemini-toc-v2_4',
            'gemini-toc-v2_5',
            'gemini-toc-v2_6',
            'ai-toc-v2_2',
            'ai-toc-style',
            'ai-toc-style-v2_2',
            'ai-toc-style-v2_3'
        ];
        ids.forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.remove();
        });
        document.querySelectorAll('style[id^="gemini-toc"], style[id^="ai-toc"]').forEach((el) => el.remove());
    }

    cleanUpOldVersions();
    console.log('AI TOC Plugin v2.4: started');

    const IS_CHATGPT = window.location.hostname.includes('chatgpt.com');
    const CONFIG = {
        selector: IS_CHATGPT ? '[data-message-author-role="user"]' : '.query-text-line',
        displayCount: 8
    };
    const STATE = {
        messages: [],
        activeIndex: -1,
        scrollContainer: null,
        syncFrame: 0,
        resizeBound: false,
        scanTimer: 0,
        positionTimer: 0,
        positionCache: [],
        positionsDirty: true,
        observer: null
    };

    const PATHS = {
        search: 'M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
        top: 'M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z',
        bottom: 'M20 12l-1.41-1.41L13 16.17V4h-2v12.17l-5.58-5.59L4 12l8 8 8-8z',
        spin: 'M12 4V2A10 10 0 0 0 2 12h2a8 8 0 0 1 8-8z',
        bullet: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z'
    };

    function createIcon(key, className) {
        const svgNS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('width', '20');
        svg.setAttribute('height', '20');
        svg.setAttribute('fill', 'currentColor');
        if (className) svg.setAttribute('class', className);

        const path = document.createElementNS(svgNS, 'path');
        path.setAttribute('d', PATHS[key] || '');
        svg.appendChild(path);
        return svg;
    }

    function injectStyles() {
        const styleId = 'ai-toc-style-v2_3';
        if (document.getElementById(styleId)) return;

        const maxH = CONFIG.displayCount * 36;
        const css = `
            #ai-toc-v2_2 {
                position: fixed;
                top: 80px;
                right: 24px;
                width: 280px;
                background: #1e1f20;
                color: #e3e3e3;
                border-radius: 24px;
                z-index: 2147483647;
                overflow: hidden;
                box-shadow: 0 4px 8px 3px rgba(0,0,0,0.15), 0 1px 3px rgba(0,0,0,0.3);
                font-family: Roboto, sans-serif;
                display: flex;
                flex-direction: column;
                height: auto;
                max-height: 85vh;
                border: 1px solid #444746;
                opacity: 0;
                transition: opacity 0.3s;
                contain: content;
            }
            #ai-toc-v2_2.toc-visible { opacity: 1; }
            #ai-toc-v2_2.notranslate { translate: no; }
            .toc-header { padding: 16px 16px 8px 16px; background: #1e1f20; flex-shrink: 0; }
            .toc-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
            .toc-title { font-weight: 500; font-size: 14px; color: #e3e3e3; padding-left: 4px; }
            .toc-btn {
                background: transparent;
                border: none;
                color: #c4c7c5;
                cursor: pointer;
                width: 32px;
                height: 32px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: background 0.2s;
            }
            .toc-btn:hover { background: rgba(255,255,255,0.1); color: #e3e3e3; }
            .toc-spin { animation: spin 1s linear infinite; }
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
            .toc-search { position: relative; margin-bottom: 4px; }
            .toc-search input {
                width: 100%;
                background: #2b2c2e;
                border: 1px solid transparent;
                color: #e3e3e3;
                padding: 10px 16px 10px 40px;
                border-radius: 24px;
                box-sizing: border-box;
                outline: none;
                font-size: 13px;
            }
            .toc-search input:focus { background: #1e1f20; border-color: #a8c7fa; }
            .toc-search-icon {
                position: absolute;
                left: 12px;
                top: 50%;
                transform: translateY(-50%);
                color: #c4c7c5;
                display: flex;
            }
            #toc-list {
                list-style: none;
                padding: 0;
                margin: 0;
                flex-grow: 1;
                overflow-y: auto;
                max-height: ${maxH}px;
                padding-bottom: 8px;
            }
            #toc-list::-webkit-scrollbar { width: 8px; }
            #toc-list::-webkit-scrollbar-thumb {
                background: #444746;
                border-radius: 4px;
                border: 2px solid #1e1f20;
            }
            .toc-item {
                padding: 8px 16px;
                margin: 0 4px;
                border-radius: 16px;
                cursor: pointer;
                font-size: 13px;
                color: #c4c7c5;
                display: flex;
                align-items: center;
                transition: background 0.1s;
            }
            .toc-item:hover { background: rgba(232,234,237,0.08); color: #e3e3e3; }
            .toc-item.toc-active { background: #2f353b; color: #e3e3e3; }
            .toc-icon { margin-right: 12px; color: #a8c7fa; display: flex; align-items: center; }
            .toc-item.toc-active .toc-icon { color: #8ab4f8; }
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

    function getPageScroller() {
        return document.scrollingElement || document.documentElement || document.body;
    }

    function isScrollableElement(el) {
        if (!el || el === document.body || el === document.documentElement) return false;
        if (el.scrollHeight <= el.clientHeight + 4) return false;
        const overflowY = getComputedStyle(el).overflowY;
        return overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
    }

    function isWindowScrollTarget(target) {
        const pageScroller = getPageScroller();
        return !target || target === window || target === document || target === document.body ||
            target === document.documentElement || target === pageScroller;
    }

    function getScrollTop(target) {
        return isWindowScrollTarget(target) ? (window.pageYOffset || getPageScroller().scrollTop || 0) : target.scrollTop;
    }

    function getScrollHeight(target) {
        return isWindowScrollTarget(target) ? getPageScroller().scrollHeight : target.scrollHeight;
    }

    function getViewportRect(target) {
        if (isWindowScrollTarget(target)) {
            return { top: 0, bottom: window.innerHeight, height: window.innerHeight };
        }
        const rect = target.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, height: rect.height };
    }

    function scrollTargetTo(target, top, behavior) {
        if (isWindowScrollTarget(target)) {
            window.scrollTo({ top, behavior });
            return;
        }

        if (typeof target.scrollTo === 'function') {
            target.scrollTo({ top, behavior });
        } else {
            target.scrollTop = top;
        }
    }

    function getScrollContainer() {
        const anchor = document.querySelector(CONFIG.selector);
        if (!anchor) return window;

        let current = anchor;
        while (current && current !== document.body && current !== document.documentElement) {
            if (isScrollableElement(current)) return current;
            current = current.parentElement;
        }
        return window;
    }

    function scheduleScan(delay) {
        if (STATE.scanTimer) {
            window.clearTimeout(STATE.scanTimer);
        }
        STATE.scanTimer = window.setTimeout(() => {
            STATE.scanTimer = 0;
            scanContent();
        }, typeof delay === 'number' ? delay : 120);
    }

    function schedulePositionRefresh() {
        STATE.positionsDirty = true;
        if (STATE.positionTimer) return;

        STATE.positionTimer = window.setTimeout(() => {
            STATE.positionTimer = 0;
            if (STATE.messages.length) {
                refreshPositionCache();
                scheduleActiveSync();
            }
        }, 80);
    }

    function refreshPositionCache() {
        const messages = STATE.messages;
        if (!messages.length) {
            STATE.positionCache = [];
            STATE.positionsDirty = false;
            return;
        }

        const container = STATE.scrollContainer || getScrollContainer();
        const viewportTop = getViewportRect(container).top;
        const scrollTop = getScrollTop(container);
        const positions = new Array(messages.length);
        let lastTop = 0;

        for (let i = 0; i < messages.length; i++) {
            const message = messages[i];
            const anchor = message.anchor || message.container;
            if (!anchor || !anchor.isConnected) {
                positions[i] = lastTop;
                continue;
            }

            const rect = anchor.getBoundingClientRect();
            const top = scrollTop + rect.top - viewportTop;
            positions[i] = top;
            lastTop = top;
        }

        STATE.positionCache = positions;
        STATE.positionsDirty = false;
    }

    function getMutationElement(node) {
        if (!node) return null;
        if (node.nodeType === Node.ELEMENT_NODE) return node;
        return node.parentElement || null;
    }

    function isPanelMutation(node) {
        const element = getMutationElement(node);
        return !!(element && element.closest('#ai-toc-v2_2'));
    }

    function isRelevantMessageMutation(node) {
        const element = getMutationElement(node);
        if (!element || isPanelMutation(element)) return false;

        if (element.matches && element.matches(CONFIG.selector)) return true;
        if (element.querySelector && element.querySelector(CONFIG.selector)) return true;
        if (element.closest && element.closest(CONFIG.selector)) return true;
        return false;
    }

    function mutationAffectsMessages(mutation) {
        if (isRelevantMessageMutation(mutation.target)) return true;

        for (const node of mutation.addedNodes) {
            if (isRelevantMessageMutation(node)) return true;
        }

        for (const node of mutation.removedNodes) {
            if (isRelevantMessageMutation(node)) return true;
        }

        return false;
    }

    function startObserver() {
        if (STATE.observer || !document.body) return;

        STATE.observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutationAffectsMessages(mutation)) {
                    scheduleScan();
                    return;
                }
            }
        });

        STATE.observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true
        });
    }

    function resolveMessageContainer(line) {
        if (!line) return null;

        if (IS_CHATGPT) {
            const direct = line.closest('[data-message-author-role]');
            if (direct) return direct;
        }

        let current = line.parentElement || line;
        let candidate = current;

        while (current && current.parentElement && current.parentElement !== document.body) {
            const parent = current.parentElement;
            const matchedChildren = Array.from(parent.children).filter((child) => {
                return child.matches(CONFIG.selector) || !!child.querySelector(CONFIG.selector);
            });

            if (matchedChildren.length > 1) {
                return current;
            }

            candidate = current;
            current = parent;
        }

        return candidate;
    }

    function extractImageLabel(container) {
        if (!container) return '';

        const images = Array.from(container.querySelectorAll('img'));
        if (!images.length) return '';

        const labels = [];
        images.forEach((img) => {
            const raw = (img.getAttribute('alt') || img.getAttribute('aria-label') || img.title || '').trim();
            if (!raw) return;
            if (raw.length <= 2) return;
            if (/^(image|photo|picture)$/i.test(raw)) return;
            labels.push(raw);
        });

        if (labels.length) {
            return `图片：${labels[0]}`;
        }

        return images.length > 1 ? `图片 x${images.length}` : '图片';
    }

    function extractMessageLabel(line, container) {
        const text = (line.textContent || '').replace(/\s+/g, ' ').trim();
        if (text) return text;
        return extractImageLabel(container);
    }

    function getContainerSignature(element) {
        if (!element || !element.tagName) return '';
        const className = typeof element.className === 'string' ? element.className.trim().replace(/\s+/g, ' ') : '';
        return `${element.tagName}|${className}`;
    }

    function collectImageOnlyMessages(knownSignatures, usedContainers) {
        if (IS_CHATGPT) return [];

        const results = [];
        const seenContainers = new Set();
        const images = Array.from(document.querySelectorAll('img'));

        images.forEach((img) => {
            if (!img.isConnected || isPanelMutation(img)) return;

            let current = img.parentElement;
            while (current && current !== document.body && current !== document.documentElement) {
                const signature = getContainerSignature(current);
                if (knownSignatures.has(signature)) {
                    if (!current.querySelector(CONFIG.selector) && !usedContainers.has(current) && !seenContainers.has(current)) {
                        const text = extractImageLabel(current);
                        if (text) {
                            results.push({
                                container: current,
                                anchor: img,
                                text
                            });
                            seenContainers.add(current);
                        }
                    }
                    return;
                }
                current = current.parentElement;
            }
        });

        return results;
    }

    function compareMessageOrder(a, b) {
        const aNode = a.anchor || a.container;
        const bNode = b.anchor || b.container;
        if (!aNode || !bNode || aNode === bNode) return 0;

        const position = aNode.compareDocumentPosition(bNode);
        if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
        if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
        return 0;
    }

    function scrollMessageIntoView(message) {
        const target = message && (message.anchor || message.container);
        if (!target || !target.isConnected) return;

        const container = STATE.scrollContainer || getScrollContainer();
        const viewport = getViewportRect(container);
        const currentTop = getScrollTop(container);
        const rect = target.getBoundingClientRect();
        const offset = Math.min(160, viewport.height * 0.28);
        const top = Math.max(0, currentTop + rect.top - viewport.top - offset);

        scrollTargetTo(container, top, 'smooth');
    }

    function setButtonIcon(btn, iconKey, className) {
        while (btn.firstChild) btn.removeChild(btn.firstChild);
        btn.appendChild(createIcon(iconKey, className));
    }

    function ensureItemVisible(list, item) {
        const itemTop = item.offsetTop;
        const itemBottom = itemTop + item.offsetHeight;
        const viewTop = list.scrollTop;
        const viewBottom = viewTop + list.clientHeight;

        if (itemTop < viewTop) {
            list.scrollTop = itemTop;
            return;
        }

        if (itemBottom > viewBottom) {
            list.scrollTop = itemBottom - list.clientHeight;
        }
    }

    function syncItemIntoView(list, item) {
        if (!list || !item) return;

        const itemTop = item.offsetTop;
        const itemBottom = itemTop + item.offsetHeight;
        const viewTop = list.scrollTop;
        const viewBottom = viewTop + list.clientHeight;

        if (itemTop >= viewTop && itemBottom <= viewBottom) return;

        const targetTop = Math.max(0, itemTop - Math.max(0, (list.clientHeight - item.offsetHeight) / 2));
        list.scrollTop = targetTop;
    }

    function syncTocToTopIfNeeded() {
        const list = document.getElementById('toc-list');
        if (!list) return;

        const container = STATE.scrollContainer || getScrollContainer();
        if (getScrollTop(container) <= 1) {
            list.scrollTop = 0;
        }
    }

    function setActiveIndex(index) {
        const list = document.getElementById('toc-list');
        if (!list) return;
        if (index === STATE.activeIndex) {
            const currentItem = index >= 0 ? list.children[index] : null;
            if (currentItem && !currentItem.classList.contains('toc-hidden')) {
                syncItemIntoView(list, currentItem);
            }
            return;
        }

        if (STATE.activeIndex >= 0 && list.children[STATE.activeIndex]) {
            list.children[STATE.activeIndex].classList.remove('toc-active');
        }

        STATE.activeIndex = index;
        if (index < 0 || !list.children[index]) return;

        const item = list.children[index];
        item.classList.add('toc-active');
        if (!item.classList.contains('toc-hidden')) {
            syncItemIntoView(list, item);
        }
    }

    function findActiveMessageIndex(messages) {
        if (!messages.length) return -1;

        const container = STATE.scrollContainer || getScrollContainer();
        if (STATE.positionsDirty || STATE.positionCache.length !== messages.length) {
            refreshPositionCache();
        }

        const viewport = getViewportRect(container);
        const threshold = getScrollTop(container) + Math.min(160, viewport.height * 0.28);
        const positions = STATE.positionCache;

        let low = 0;
        let high = positions.length - 1;
        let activeIndex = -1;

        while (low <= high) {
            const mid = (low + high) >> 1;
            if (positions[mid] <= threshold) {
                activeIndex = mid;
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }

        return activeIndex >= 0 ? activeIndex : 0;
    }

    function syncActiveTocItem() {
        if (!STATE.messages.length) {
            setActiveIndex(-1);
            return;
        }
        setActiveIndex(findActiveMessageIndex(STATE.messages));
        syncTocToTopIfNeeded();
    }

    function scheduleActiveSync() {
        if (STATE.syncFrame) return;
        STATE.syncFrame = window.requestAnimationFrame(() => {
            STATE.syncFrame = 0;
            syncActiveTocItem();
        });
    }

    function bindScrollSync() {
        const nextContainer = getScrollContainer();
        if (STATE.scrollContainer === nextContainer) return;

        if (STATE.scrollContainer) {
            STATE.scrollContainer.removeEventListener('scroll', scheduleActiveSync);
        }

        nextContainer.addEventListener('scroll', scheduleActiveSync, { passive: true });
        STATE.scrollContainer = nextContainer;
        STATE.positionsDirty = true;
    }

    function filterList(value) {
        const items = document.querySelectorAll('.toc-item');
        const keyword = value.toLowerCase();
        items.forEach((item) => {
            const text = item.getAttribute('data-text') || '';
            item.classList.toggle('toc-hidden', !text.includes(keyword));
        });
    }

    function handleTop() {
        const btn = this;
        btn.disabled = true;
        setButtonIcon(btn, 'spin', 'toc-spin');

        let attempts = 0;
        let stableSince = 0;
        let lastHeight = -1;

        const timer = setInterval(() => {
            attempts++;
            const container = getScrollContainer();
            if (STATE.scrollContainer !== container) bindScrollSync();

            scrollTargetTo(container, 0, 'auto');

            const currentTop = getScrollTop(container);
            const currentHeight = getScrollHeight(container);
            const heightChanged = currentHeight !== lastHeight;

            if (heightChanged) {
                scanContent();
            }

            if (currentTop <= 1 && !heightChanged) {
                if (!stableSince) stableSince = Date.now();
            } else {
                stableSince = 0;
            }

            lastHeight = currentHeight;
            syncTocToTopIfNeeded();
            scheduleActiveSync();

            if ((stableSince && Date.now() - stableSince >= 2200) || attempts >= 240) {
                clearInterval(timer);
                btn.disabled = false;
                setButtonIcon(btn, 'top');
                scanContent();
            }
        }, 120);
    }

    function handleBot() {
        const container = getScrollContainer();
        scrollTargetTo(container, getScrollHeight(container), 'smooth');
    }

    function createUI() {
        if (document.getElementById('ai-toc-v2_2')) return;
        if (!document.body) return;

        injectStyles();

        const panel = document.createElement('div');
        panel.id = 'ai-toc-v2_2';
        panel.className = 'notranslate';
        panel.setAttribute('translate', 'no');

        const header = document.createElement('div');
        header.className = 'toc-header';

        const row = document.createElement('div');
        row.className = 'toc-row';

        const title = document.createElement('span');
        title.className = 'toc-title';
        title.textContent = IS_CHATGPT ? 'ChatGPT 索引' : 'Gemini 索引';

        const btnGroup = document.createElement('div');
        btnGroup.style.display = 'flex';
        btnGroup.style.gap = '4px';

        const topBtn = document.createElement('button');
        topBtn.className = 'toc-btn';
        topBtn.title = '回到顶部';
        topBtn.appendChild(createIcon('top'));
        topBtn.onclick = handleTop;

        const botBtn = document.createElement('button');
        botBtn.className = 'toc-btn';
        botBtn.title = '直达底部';
        botBtn.appendChild(createIcon('bottom'));
        botBtn.onclick = handleBot;

        btnGroup.append(topBtn, botBtn);
        row.append(title, btnGroup);

        const searchDiv = document.createElement('div');
        searchDiv.className = 'toc-search';

        const searchIcon = document.createElement('span');
        searchIcon.className = 'toc-search-icon';
        searchIcon.appendChild(createIcon('search'));

        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = '搜索...';
        input.addEventListener('input', (event) => filterList(event.target.value));

        searchDiv.append(searchIcon, input);
        header.append(row, searchDiv);

        const list = document.createElement('ul');
        list.id = 'toc-list';
        list.addEventListener('click', (event) => {
            const item = event.target.closest('.toc-item');
            if (!item || !list.contains(item)) return;

            const index = Number(item.dataset.index);
            const msg = STATE.messages[index];
            if (!msg) return;

            if ((msg.anchor && msg.anchor.isConnected) || (msg.container && msg.container.isConnected)) {
                setActiveIndex(index);
                scrollMessageIntoView(msg);
            } else {
                handleBot();
            }

            const oldBg = item.style.background;
            item.style.background = '#444a50';
            setTimeout(() => {
                item.style.background = oldBg;
            }, 300);
        });

        panel.append(header, list);
        document.body.appendChild(panel);

        header.addEventListener('mousedown', (event) => {
            if (event.target.tagName === 'INPUT' || event.target.closest('button')) return;

            const startX = event.clientX;
            const startY = event.clientY;
            const rect = panel.getBoundingClientRect();
            const startLeft = rect.left;
            const startTop = rect.top;

            function onMove(moveEvent) {
                panel.style.left = `${startLeft + (moveEvent.clientX - startX)}px`;
                panel.style.top = `${startTop + (moveEvent.clientY - startY)}px`;
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
        if (!STATE.resizeBound) {
            window.addEventListener('resize', () => {
                schedulePositionRefresh();
            }, { passive: true });
            STATE.resizeBound = true;
        }
        startObserver();
        scanContent();
    }

    function scanContent() {
        const list = document.getElementById('toc-list');
        if (!list) return;
        const previousActiveIndex = STATE.activeIndex;

        const allLines = Array.from(document.querySelectorAll(CONFIG.selector));
        const messages = [];
        let currentGroup = null;

        allLines.forEach((line) => {
            const container = resolveMessageContainer(line);
            if (!container) return;
            const text = extractMessageLabel(line, container);
            if (!text) return;

            if (currentGroup && currentGroup.container === container) {
                if (currentGroup.text !== text) {
                    currentGroup.text += ` ${text}`;
                }
            } else {
                if (currentGroup) messages.push(currentGroup);
                currentGroup = { container, anchor: line, text };
            }
        });

        if (currentGroup) messages.push(currentGroup);
        const usedContainers = new Set(messages.map((message) => message.container));
        const knownSignatures = new Set(messages.map((message) => getContainerSignature(message.container)).filter(Boolean));
        const imageOnlyMessages = collectImageOnlyMessages(knownSignatures, usedContainers);
        if (imageOnlyMessages.length) {
            messages.push(...imageOnlyMessages);
            messages.sort(compareMessageOrder);
        }
        STATE.messages = messages;

        const total = messages.length;
        if (total === 0) {
            setActiveIndex(-1);
            if (!list.querySelector('.toc-status')) {
                while (list.firstChild) list.removeChild(list.firstChild);
                const item = document.createElement('li');
                item.className = 'toc-status';
                item.textContent = '...';
                list.appendChild(item);
            }
            return;
        }

        if (list.querySelector('.toc-status')) {
            while (list.firstChild) list.removeChild(list.firstChild);
        }

        for (let i = 0; i < total; i++) {
            const msg = messages[i];
            const text = msg.text;

            let item = list.children[i];
            if (!item) {
                item = document.createElement('li');
                item.className = 'toc-item';

                const icon = document.createElement('span');
                icon.className = 'toc-icon';
                icon.appendChild(createIcon('bullet'));

                const label = document.createElement('span');
                label.className = 'toc-text';

                item.append(icon, label);
                list.appendChild(item);
            }

            const normalizedText = text.toLowerCase();
            if (item.getAttribute('data-text') !== normalizedText) {
                item.setAttribute('data-text', normalizedText);
                item.title = text;
                item.querySelector('.toc-text').textContent = text;
            }

            item.dataset.index = String(i);
        }

        while (list.children.length > total) {
            list.removeChild(list.lastChild);
        }

        if (previousActiveIndex >= 0 && list.children[previousActiveIndex]) {
            list.children[previousActiveIndex].classList.remove('toc-active');
        }
        STATE.activeIndex = -1;

        const input = document.querySelector('.toc-search input');
        if (input && input.value) filterList(input.value);

        bindScrollSync();
        refreshPositionCache();
        scheduleActiveSync();
    }

    if (document.getElementById('ai-toc-v2_2')) {
        startObserver();
        scheduleScan(0);
    } else {
        createUI();
    }
    setInterval(() => {
        const panel = document.getElementById('ai-toc-v2_2');
        if (!panel) {
            createUI();
        }
        if (!STATE.observer) {
            startObserver();
        }
    }, 2000);
})();
