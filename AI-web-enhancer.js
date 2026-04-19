// ==UserScript==
// @name         AI 目录插件 (Gemini & ChatGPT)
// @namespace    http://tampermonkey.net/
// @version      2.5.0
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
    console.log('AI TOC Plugin v2.5.0: started');

    const CONFIG = {
        displayCount: 8
    };
    const TIMINGS = {
        scanDelay: 120,
        positionRefresh: 80,
        jumpCorrection: 140,
        manualRelease: 180,
        tocFollowPause: 900,
        tocUserScroll: 1200,
        topBoundaryStable: 2200,
        bottomBoundaryStable: 600,
        boundaryInterval: 120,
        topBoundaryMaxAttempts: 240,
        bottomBoundaryMaxAttempts: 120
    };
    const STATE = {
        messages: [],
        activeIndex: -1,
        manualActiveIndex: -1,
        clickLockIndex: -1,
        forcedActiveIndex: -1,
        tocUserScrollUntil: 0,
        tocSyncing: false,
        scrollSettleTimer: 0,
        jumpSyncTimer: 0,
        scrollContainer: null,
        syncFrame: 0,
        resizeBound: false,
        scanTimer: 0,
        positionTimer: 0,
        positionCache: [],
        positionsDirty: true,
        observer: null,
        globalEventsBound: false
    };

    const PATHS = {
        search: 'M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
        top: 'M7 4h10v2H7V4zm5 3l-5 5h3v8h4v-8h3l-5-5z',
        bottom: 'M10 4h4v8h3l-5 5-5-5h3V4zM7 18h10v2H7v-2z',
        spin: 'M12 4V2A10 10 0 0 0 2 12h2a8 8 0 0 1 8-8z',
        bullet: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z'
    };

    // Site adapters and message collection
    function resolveGroupedMessageContainer(line, selector) {
        if (!line) return null;

        let current = line.parentElement || line;
        let candidate = current;

        while (current && current.parentElement && current.parentElement !== document.body) {
            const parent = current.parentElement;
            const matchedChildren = Array.from(parent.children).filter((child) => {
                return child.matches(selector) || !!child.querySelector(selector);
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

    function normalizeMessageText(node) {
        return (node && node.textContent ? node.textContent : '').replace(/\s+/g, ' ').trim();
    }

    function collectMessagesFromAdapter(adapter) {
        const allLines = Array.from(document.querySelectorAll(adapter.selector));
        const messages = [];
        let currentGroup = null;

        allLines.forEach((line) => {
            const container = adapter.resolveMessageContainer(line);
            if (!container) return;

            const text = adapter.getMessageLabel(line, container);
            if (!text) return;

            if (currentGroup && currentGroup.container === container) {
                if (currentGroup.text !== text) {
                    currentGroup.text += ` ${text}`;
                }
                return;
            }

            if (currentGroup) messages.push(currentGroup);
            currentGroup = { container, anchor: line, text };
        });

        if (currentGroup) messages.push(currentGroup);

        const usedContainers = new Set(messages.map((message) => message.container));
        const knownSignatures = new Set(messages.map((message) => getContainerSignature(message.container)).filter(Boolean));
        const extraMessages = adapter.collectExtraMessages(knownSignatures, usedContainers, isPanelMutation) || [];

        if (extraMessages.length) {
            messages.push(...extraMessages);
            messages.sort(compareMessageOrder);
        }

        return messages;
    }

    function getMessageTarget(message) {
        return message ? (message.anchor || message.container) : null;
    }

    function isMessageConnected(message) {
        const target = getMessageTarget(message);
        return !!(target && target.isConnected);
    }

    function getDefaultScrollReferenceTargets(messages, selector) {
        if (messages.length) {
            return [
                getMessageTarget(messages[0]),
                getMessageTarget(messages[(messages.length - 1) >> 1]),
                getMessageTarget(messages[messages.length - 1])
            ].filter(Boolean);
        }

        const fallback = document.querySelector(selector);
        return fallback ? [fallback] : [];
    }

    const SITE_ADAPTERS = {
        chatgpt: {
            id: 'chatgpt',
            title: 'ChatGPT 索引',
            selector: '[data-message-author-role="user"]',
            matches() {
                return window.location.hostname.includes('chatgpt.com');
            },
            resolveMessageContainer(line) {
                return line.closest('[data-message-author-role]') || resolveGroupedMessageContainer(line, this.selector);
            },
            getMessageLabel(line, container) {
                const text = normalizeMessageText(line);
                return text || extractImageLabel(container);
            },
            getScrollReferenceTargets(messages) {
                return getDefaultScrollReferenceTargets(messages, this.selector);
            },
            collectExtraMessages() {
                return [];
            }
        },
        gemini: {
            id: 'gemini',
            title: 'Gemini 索引',
            selector: '.query-text-line',
            matches() {
                return window.location.hostname.includes('gemini.google.com');
            },
            resolveMessageContainer(line) {
                return resolveGroupedMessageContainer(line, this.selector);
            },
            getMessageLabel(line, container) {
                const text = normalizeMessageText(line);
                return text || extractImageLabel(container);
            },
            getScrollReferenceTargets(messages) {
                return getDefaultScrollReferenceTargets(messages, this.selector);
            },
            collectExtraMessages(knownSignatures, usedContainers, isPanelMutationFn) {
                const results = [];
                const seenContainers = new Set();
                const images = Array.from(document.querySelectorAll('img'));

                images.forEach((img) => {
                    if (!img.isConnected || isPanelMutationFn(img)) return;

                    let current = img.parentElement;
                    while (current && current !== document.body && current !== document.documentElement) {
                        const signature = getContainerSignature(current);
                        if (knownSignatures.has(signature)) {
                            if (!current.querySelector(this.selector) && !usedContainers.has(current) && !seenContainers.has(current)) {
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
        }
    };

    function selectAdapter() {
        const adapters = Object.values(SITE_ADAPTERS);
        for (let i = 0; i < adapters.length; i++) {
            if (adapters[i].matches()) return adapters[i];
        }
        return SITE_ADAPTERS.gemini;
    }

    const ADAPTER = selectAdapter();

    // Shared DOM and scroll utilities
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

    function getScrollMaxTop(target) {
        if (isWindowScrollTarget(target)) {
            return Math.max(0, getPageScroller().scrollHeight - window.innerHeight);
        }
        return Math.max(0, target.scrollHeight - target.clientHeight);
    }

    function getScrollableAncestors(element) {
        const ancestors = [];
        let current = element;

        while (current && current !== document.body && current !== document.documentElement) {
            if (isScrollableElement(current)) {
                ancestors.push(current);
            }
            current = current.parentElement;
        }

        if (getScrollMaxTop(window) > 0) {
            ancestors.push(window);
        }

        return ancestors;
    }

    function getViewportRect(target) {
        if (isWindowScrollTarget(target)) {
            return { top: 0, bottom: window.innerHeight, height: window.innerHeight };
        }
        const rect = target.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, height: rect.height };
    }

    function scrollTargetTo(target, top, behavior) {
        const nextTop = Math.max(0, Math.min(typeof top === 'number' ? top : 0, getScrollMaxTop(target)));
        if (isWindowScrollTarget(target)) {
            window.scrollTo({ top: nextTop, behavior });
            return;
        }

        if (typeof target.scrollTo === 'function') {
            target.scrollTo({ top: nextTop, behavior });
        } else {
            target.scrollTop = nextTop;
        }
    }

    function findScrollContainerForElement(element) {
        const ancestors = getScrollableAncestors(element);
        if (!ancestors.length) return window;

        let best = ancestors[0];
        let bestRange = getScrollMaxTop(best);

        for (let i = 1; i < ancestors.length; i++) {
            const candidate = ancestors[i];
            const range = getScrollMaxTop(candidate);
            if (range >= bestRange) {
                best = candidate;
                bestRange = range;
            }
        }

        return best;
    }

    function getScrollContainer() {
        const sampleTargets = ADAPTER.getScrollReferenceTargets(STATE.messages);
        const stats = new Map();
        sampleTargets.forEach((target) => {
            if (!target) return;
            getScrollableAncestors(target).forEach((ancestor, index) => {
                const current = stats.get(ancestor) || { count: 0, range: 0, depth: index };
                current.count += 1;
                current.range = Math.max(current.range, getScrollMaxTop(ancestor));
                current.depth = Math.min(current.depth, index);
                stats.set(ancestor, current);
            });
        });

        if (!stats.size) return window;

        let best = window;
        let bestStats = { count: -1, range: -1, depth: Infinity };

        stats.forEach((value, key) => {
            if (
                value.count > bestStats.count ||
                (value.count === bestStats.count && value.range > bestStats.range) ||
                (value.count === bestStats.count && value.range === bestStats.range && value.depth < bestStats.depth)
            ) {
                best = key;
                bestStats = value;
            }
        });

        return best;
    }

    function scheduleScan(delay) {
        if (STATE.scanTimer) {
            window.clearTimeout(STATE.scanTimer);
        }
        STATE.scanTimer = window.setTimeout(() => {
            STATE.scanTimer = 0;
            scanContent();
        }, typeof delay === 'number' ? delay : TIMINGS.scanDelay);
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
        }, TIMINGS.positionRefresh);
    }

    function refreshPositionCache() {
        const messages = STATE.messages;
        if (!messages.length) {
            STATE.positionCache = [];
            STATE.positionsDirty = false;
            return;
        }

        const container = getActiveScrollContainer();
        const viewportTop = getViewportRect(container).top;
        const scrollTop = getScrollTop(container);
        const positions = new Array(messages.length);
        let lastTop = 0;

        for (let i = 0; i < messages.length; i++) {
            const anchor = getMessageTarget(messages[i]);
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

    function getActiveScrollContainer() {
        return STATE.scrollContainer || getScrollContainer();
    }

    function getLastMessageIndex() {
        return Math.max(0, STATE.messages.length - 1);
    }

    function clampMessageIndex(index) {
        return Math.min(index, getLastMessageIndex());
    }

    // DOM observation and message ordering
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

        if (element.matches && element.matches(ADAPTER.selector)) return true;
        if (element.querySelector && element.querySelector(ADAPTER.selector)) return true;
        if (element.closest && element.closest(ADAPTER.selector)) return true;
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

    function getContainerSignature(element) {
        if (!element || !element.tagName) return '';
        const className = typeof element.className === 'string' ? element.className.trim().replace(/\s+/g, ' ') : '';
        return `${element.tagName}|${className}`;
    }

    function compareMessageOrder(a, b) {
        const aNode = getMessageTarget(a);
        const bNode = getMessageTarget(b);
        if (!aNode || !bNode || aNode === bNode) return 0;

        const position = aNode.compareDocumentPosition(bNode);
        if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
        if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
        return 0;
    }

    function getElementScrollTop(target, container) {
        if (!target || !target.isConnected) return;
        const viewport = getViewportRect(container);
        const currentTop = getScrollTop(container);
        const rect = target.getBoundingClientRect();
        const offset = Math.min(160, viewport.height * 0.28);
        const activationBias = 24;
        return Math.max(0, Math.min(currentTop + rect.top - viewport.top - offset + activationBias, getScrollMaxTop(container)));
    }

    function getMessageScrollTopByIndex(index, container) {
        if (index < 0 || index >= STATE.messages.length) return;

        const message = STATE.messages[index];
        const target = getMessageTarget(message);
        if (!target || !target.isConnected) return;

        const viewport = getViewportRect(container);
        const currentTop = getScrollTop(container);
        const rect = target.getBoundingClientRect();
        const absoluteTop = currentTop + rect.top - viewport.top;
        const offset = Math.min(160, viewport.height * 0.28);

        let thresholdOffset = 28;
        if (index < STATE.messages.length - 1) {
            const nextMessage = STATE.messages[index + 1];
            const nextTarget = getMessageTarget(nextMessage);
            if (nextTarget && nextTarget.isConnected) {
                const nextRect = nextTarget.getBoundingClientRect();
                const nextAbsoluteTop = currentTop + nextRect.top - viewport.top;
                const gap = Math.max(0, nextAbsoluteTop - absoluteTop);
                thresholdOffset = Math.min(64, Math.max(28, gap * 0.25));
            }
        }

        return Math.max(0, Math.min(absoluteTop + thresholdOffset - offset, getScrollMaxTop(container)));
    }

    // Navigation and active-item state
    function resolveTargetScrollTop(target, container, index) {
        return typeof index === 'number'
            ? getMessageScrollTopByIndex(index, container)
            : getElementScrollTop(target, container);
    }

    function clearJumpSyncTimer() {
        if (STATE.jumpSyncTimer) {
            window.clearTimeout(STATE.jumpSyncTimer);
            STATE.jumpSyncTimer = 0;
        }
    }

    function scheduleJumpCorrection(target, remainingAttempts, index) {
        clearJumpSyncTimer();
        if (!target || !target.isConnected || remainingAttempts <= 0) return;

        STATE.jumpSyncTimer = window.setTimeout(() => {
            STATE.jumpSyncTimer = 0;
            const currentContainer = findScrollContainerForElement(target);
            if (STATE.scrollContainer !== currentContainer) bindScrollSync();

            const exactTop = resolveTargetScrollTop(target, currentContainer, index);
            if (typeof exactTop !== 'number') return;

            const currentTop = getScrollTop(currentContainer);
            if (Math.abs(currentTop - exactTop) > 4) {
                scrollTargetTo(currentContainer, exactTop, 'auto');
            }

            scheduleActiveSync();
            scheduleJumpCorrection(target, remainingAttempts - 1, index);
        }, TIMINGS.jumpCorrection);
    }

    function scrollMessageIntoView(message, index) {
        const target = getMessageTarget(message);
        if (!target || !target.isConnected) return;

        const container = findScrollContainerForElement(target);
        if (STATE.scrollContainer !== container) bindScrollSync();

        const initialTop = resolveTargetScrollTop(target, container, index);
        if (typeof initialTop !== 'number') return;

        scrollTargetTo(container, initialTop, 'smooth');
        scheduleJumpCorrection(target, 4, index);
    }

    function holdManualActiveIndex(index, duration) {
        STATE.manualActiveIndex = index;
        scheduleManualActiveRelease(typeof duration === 'number' ? duration : TIMINGS.manualRelease);
    }

    function clearManualActiveIndex() {
        STATE.manualActiveIndex = -1;
        if (STATE.scrollSettleTimer) {
            window.clearTimeout(STATE.scrollSettleTimer);
            STATE.scrollSettleTimer = 0;
        }
    }

    function cancelClickNavigationTracking() {
        STATE.clickLockIndex = -1;
        clearManualActiveIndex();
        clearJumpSyncTimer();
    }

    function beginForcedBoundaryNavigation(index) {
        cancelClickNavigationTracking();
        STATE.forcedActiveIndex = index;
    }

    function finishForcedBoundaryNavigation(btn, iconKey) {
        btn.disabled = false;
        setButtonIcon(btn, iconKey);
        STATE.forcedActiveIndex = -1;
        clearManualActiveIndex();
        scanContent();
    }

    function getActiveThreshold(container) {
        const viewport = getViewportRect(container);
        return getScrollTop(container) + Math.min(160, viewport.height * 0.28);
    }

    function isIndexAligned(index, container) {
        if (index < 0 || index >= STATE.messages.length) return false;

        if (STATE.positionsDirty || STATE.positionCache.length !== STATE.messages.length) {
            refreshPositionCache();
        }

        const positions = STATE.positionCache;
        const threshold = getActiveThreshold(container);
        const currentTop = positions[index];
        const nextTop = index < positions.length - 1 ? positions[index + 1] : Infinity;
        const tolerance = 12;

        return currentTop <= threshold + tolerance && nextTop > threshold - tolerance;
    }

    function scheduleManualActiveRelease(delay) {
        if (STATE.scrollSettleTimer) {
            window.clearTimeout(STATE.scrollSettleTimer);
        }
        STATE.scrollSettleTimer = window.setTimeout(() => {
            STATE.scrollSettleTimer = 0;

            if (STATE.manualActiveIndex >= 0) {
                const manualIndex = clampMessageIndex(STATE.manualActiveIndex);
                const targetMessage = STATE.messages[manualIndex];
                const target = getMessageTarget(targetMessage);
                if (target && target.isConnected) {
                    const currentContainer = findScrollContainerForElement(target);
                    const exactTop = getMessageScrollTopByIndex(manualIndex, currentContainer);
                    const aligned = isIndexAligned(manualIndex, currentContainer);
                    if (typeof exactTop === 'number' && (Math.abs(getScrollTop(currentContainer) - exactTop) > 4 || !aligned)) {
                        scrollTargetTo(currentContainer, exactTop, 'auto');
                        scheduleManualActiveRelease(TIMINGS.manualRelease);
                        scheduleActiveSync();
                        return;
                    }
                }
            }

            clearManualActiveIndex();
            scheduleActiveSync();
        }, typeof delay === 'number' ? delay : TIMINGS.manualRelease);
    }

    function resolveActiveIndex(index) {
        if (STATE.forcedActiveIndex >= 0) {
            return clampMessageIndex(STATE.forcedActiveIndex);
        }
        if (STATE.clickLockIndex >= 0) {
            return clampMessageIndex(STATE.clickLockIndex);
        }
        if (STATE.manualActiveIndex < 0) return index;

        const manualIndex = clampMessageIndex(STATE.manualActiveIndex);
        const container = getActiveScrollContainer();
        if (isIndexAligned(manualIndex, container)) {
            clearManualActiveIndex();
            return manualIndex;
        }

        return manualIndex;
    }

    function handleScrollSync() {
        if (STATE.manualActiveIndex >= 0) {
            scheduleManualActiveRelease(TIMINGS.manualRelease);
        }
        scheduleActiveSync();
    }

    function setButtonIcon(btn, iconKey, className) {
        while (btn.firstChild) btn.removeChild(btn.firstChild);
        btn.appendChild(createIcon(iconKey, className));
    }

    function markTocUserScroll(duration) {
        STATE.tocUserScrollUntil = Date.now() + (typeof duration === 'number' ? duration : TIMINGS.tocFollowPause);
    }

    function shouldPauseTocFollow() {
        return Date.now() < STATE.tocUserScrollUntil;
    }

    function getTocList() {
        return document.getElementById('toc-list');
    }

    function getPanelElement() {
        return document.getElementById('ai-toc-v2_2');
    }

    function setTocListScrollTop(list, top) {
        STATE.tocSyncing = true;
        list.scrollTop = top;
        window.setTimeout(() => {
            STATE.tocSyncing = false;
        }, 0);
    }

    function syncItemIntoView(list, item) {
        if (!list || !item) return;
        if (shouldPauseTocFollow()) return;

        const itemTop = item.offsetTop;
        const itemBottom = itemTop + item.offsetHeight;
        const viewTop = list.scrollTop;
        const viewBottom = viewTop + list.clientHeight;

        if (itemTop >= viewTop && itemBottom <= viewBottom) return;

        const targetTop = Math.max(0, itemTop - Math.max(0, (list.clientHeight - item.offsetHeight) / 2));
        setTocListScrollTop(list, targetTop);
    }

    function syncTocToTopIfNeeded() {
        const list = getTocList();
        if (!list) return;
        if (shouldPauseTocFollow()) return;

        const container = getActiveScrollContainer();
        if (getScrollTop(container) <= 1) {
            setTocListScrollTop(list, 0);
        }
    }

    function setActiveIndex(index) {
        const list = getTocList();
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

        const container = getActiveScrollContainer();
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
        setActiveIndex(resolveActiveIndex(findActiveMessageIndex(STATE.messages)));
        syncTocToTopIfNeeded();
    }

    function scheduleActiveSync() {
        if (STATE.syncFrame) return;
        STATE.syncFrame = window.requestAnimationFrame(() => {
            STATE.syncFrame = 0;
            syncActiveTocItem();
        });
    }

    // TOC interactions and global input handling
    function bindScrollSync() {
        const nextContainer = getScrollContainer();
        if (STATE.scrollContainer === nextContainer) return;

        if (STATE.scrollContainer) {
            STATE.scrollContainer.removeEventListener('scroll', handleScrollSync);
        }

        nextContainer.addEventListener('scroll', handleScrollSync, { passive: true });
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

    function handleSearchInput(event) {
        filterList(event.target.value);
    }

    function handleTocUserWheel() {
        markTocUserScroll(TIMINGS.tocUserScroll);
    }

    function handleTocListScroll() {
        if (!STATE.tocSyncing) {
            markTocUserScroll(TIMINGS.tocUserScroll);
        }
    }

    function triggerBottomBoundaryNavigation() {
        const panel = getPanelElement();
        const buttons = panel ? panel.querySelectorAll('.toc-btn') : null;
        const bottomButton = buttons && buttons.length > 1 ? buttons[1] : null;
        if (bottomButton) {
            handleBot.call(bottomButton);
        }
    }

    function handleTocItemClick(event, list) {
        const item = event.target.closest('.toc-item');
        if (!item || !list.contains(item)) return;

        const index = Number(item.dataset.index);
        const msg = STATE.messages[index];
        if (!msg) return;

        if (isMessageConnected(msg)) {
            STATE.clickLockIndex = index;
            setActiveIndex(index);
            holdManualActiveIndex(index);
            scrollMessageIntoView(msg, index);
            return;
        }

        triggerBottomBoundaryNavigation();
    }

    function bindTocListInteractions(list) {
        list.addEventListener('wheel', handleTocUserWheel, { passive: true });
        list.addEventListener('touchmove', handleTocUserWheel, { passive: true });
        list.addEventListener('scroll', handleTocListScroll, { passive: true });
        list.addEventListener('click', (event) => handleTocItemClick(event, list));
    }

    function shouldIgnoreNavigationRelease(event) {
        const panel = getPanelElement();
        return !!(panel && event.target && panel.contains(event.target));
    }

    function shouldReleaseNavigationForKey(event) {
        const navKeys = ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '];
        return navKeys.includes(event.key);
    }

    function hasNavigationTracking() {
        return STATE.clickLockIndex >= 0 || STATE.manualActiveIndex >= 0 || !!STATE.jumpSyncTimer;
    }

    function handleNavigationReleaseEvent(event) {
        if (!hasNavigationTracking()) return;
        if (shouldIgnoreNavigationRelease(event)) return;
        if (event.type === 'keydown' && !shouldReleaseNavigationForKey(event)) return;

        cancelClickNavigationTracking();
        scheduleActiveSync();
    }

    function bindGlobalInteractionEvents() {
        if (STATE.globalEventsBound) return;

        window.addEventListener('wheel', handleNavigationReleaseEvent, { passive: true });
        window.addEventListener('touchmove', handleNavigationReleaseEvent, { passive: true });
        window.addEventListener('pointerdown', handleNavigationReleaseEvent, { passive: true });
        window.addEventListener('keydown', handleNavigationReleaseEvent);
        STATE.globalEventsBound = true;
    }

    function handleHeaderDragStart(event, panel) {
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
    }

    function bindPanelDrag(panel, header) {
        header.addEventListener('mousedown', (event) => handleHeaderDragStart(event, panel));
    }

    function bindWindowResizeRefresh() {
        if (STATE.resizeBound) return;

        window.addEventListener('resize', () => {
            schedulePositionRefresh();
        }, { passive: true });
        STATE.resizeBound = true;
    }

    function normalizeBoundaryScrollOptions(options) {
        return Object.assign({
            initialForcedIndex: -1,
            intervalMs: TIMINGS.boundaryInterval,
            onStart() {},
            getTargetTop() {},
            onHeightChange() {},
            isStable() {
                return false;
            },
            onTick() {}
        }, options);
    }

    function runBoundaryScroll(btn, options) {
        const resolvedOptions = normalizeBoundaryScrollOptions(options);
        btn.disabled = true;
        setButtonIcon(btn, 'spin', 'toc-spin');

        const initialForcedIndex = resolvedOptions.initialForcedIndex;
        if (initialForcedIndex >= 0) {
            beginForcedBoundaryNavigation(initialForcedIndex);
            setActiveIndex(initialForcedIndex);
        }

        resolvedOptions.onStart();

        let attempts = 0;
        let stableSince = 0;
        let lastHeight = -1;

        const timer = setInterval(() => {
            attempts++;
            const container = getScrollContainer();
            if (STATE.scrollContainer !== container) bindScrollSync();

            const currentHeight = getScrollHeight(container);
            const heightChanged = currentHeight !== lastHeight;

            const nextTop = resolvedOptions.getTargetTop(container);
            if (typeof nextTop === 'number') {
                scrollTargetTo(container, nextTop, 'auto');
            }

            if (heightChanged) {
                resolvedOptions.onHeightChange(container, currentHeight);
            }

            const isStable = resolvedOptions.isStable(container, heightChanged, currentHeight);

            if (isStable) {
                if (!stableSince) stableSince = Date.now();
            } else {
                stableSince = 0;
            }

            lastHeight = currentHeight;

            resolvedOptions.onTick(container, heightChanged, currentHeight);

            if ((stableSince && Date.now() - stableSince >= resolvedOptions.stableMs) || attempts >= resolvedOptions.maxAttempts) {
                clearInterval(timer);
                finishForcedBoundaryNavigation(btn, resolvedOptions.iconKey);
            }
        }, resolvedOptions.intervalMs);
    }

    // Boundary navigation actions
    function createTopBoundaryScrollOptions() {
        return {
            iconKey: 'top',
            initialForcedIndex: 0,
            stableMs: TIMINGS.topBoundaryStable,
            maxAttempts: TIMINGS.topBoundaryMaxAttempts,
            getTargetTop() {
                return 0;
            },
            onStart() {
                syncTocToTopIfNeeded();
            },
            onHeightChange() {
                scanContent();
            },
            isStable(container, heightChanged) {
                return getScrollTop(container) <= 1 && !heightChanged;
            },
            onTick() {
                syncTocToTopIfNeeded();
                scheduleActiveSync();
            }
        };
    }

    function createBottomBoundaryScrollOptions() {
        return {
            iconKey: 'bottom',
            initialForcedIndex: getLastMessageIndex(),
            stableMs: TIMINGS.bottomBoundaryStable,
            maxAttempts: TIMINGS.bottomBoundaryMaxAttempts,
            getTargetTop(container) {
                return getScrollMaxTop(container);
            },
            onHeightChange() {
                scanContent();
                STATE.forcedActiveIndex = getLastMessageIndex();
            },
            isStable(container, heightChanged) {
                const maxTop = getScrollMaxTop(container);
                return Math.abs(getScrollTop(container) - maxTop) <= 1 && !heightChanged;
            },
            onTick() {
                scheduleActiveSync();
            }
        };
    }

    function handleTop() {
        runBoundaryScroll(this, createTopBoundaryScrollOptions());
    }

    function handleBot() {
        runBoundaryScroll(this, createBottomBoundaryScrollOptions());
    }

    // UI builders and TOC rendering
    function createPanelElement() {
        const panel = document.createElement('div');
        panel.id = 'ai-toc-v2_2';
        panel.className = 'notranslate';
        panel.setAttribute('translate', 'no');
        return panel;
    }

    function createActionButton(title, iconKey, handler) {
        const button = document.createElement('button');
        button.className = 'toc-btn';
        button.title = title;
        button.appendChild(createIcon(iconKey));
        button.onclick = handler;
        return button;
    }

    function createHeaderRow() {
        const row = document.createElement('div');
        row.className = 'toc-row';

        const title = document.createElement('span');
        title.className = 'toc-title';
        title.textContent = ADAPTER.title;

        const btnGroup = document.createElement('div');
        btnGroup.style.display = 'flex';
        btnGroup.style.gap = '4px';
        btnGroup.append(
            createActionButton('回到顶部', 'top', handleTop),
            createActionButton('直达底部', 'bottom', handleBot)
        );

        row.append(title, btnGroup);
        return row;
    }

    function createSearchSection() {
        const searchDiv = document.createElement('div');
        searchDiv.className = 'toc-search';

        const searchIcon = document.createElement('span');
        searchIcon.className = 'toc-search-icon';
        searchIcon.appendChild(createIcon('search'));

        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = '搜索...';
        input.addEventListener('input', handleSearchInput);

        searchDiv.append(searchIcon, input);
        return searchDiv;
    }

    function createHeaderSection() {
        const header = document.createElement('div');
        header.className = 'toc-header';
        header.append(createHeaderRow(), createSearchSection());
        return header;
    }

    function createTocListElement() {
        const list = document.createElement('ul');
        list.id = 'toc-list';
        bindTocListInteractions(list);
        return list;
    }

    function clearElementChildren(element) {
        while (element.firstChild) element.removeChild(element.firstChild);
    }

    function renderEmptyTocState(list) {
        setActiveIndex(-1);
        if (list.querySelector('.toc-status')) return;

        clearElementChildren(list);
        const item = document.createElement('li');
        item.className = 'toc-status';
        item.textContent = '...';
        list.appendChild(item);
    }

    function ensureTocItem(list, index) {
        let item = list.children[index];
        if (item) return item;

        item = document.createElement('li');
        item.className = 'toc-item';

        const icon = document.createElement('span');
        icon.className = 'toc-icon';
        icon.appendChild(createIcon('bullet'));

        const label = document.createElement('span');
        label.className = 'toc-text';

        item.append(icon, label);
        list.appendChild(item);
        return item;
    }

    function updateTocItem(item, text, index) {
        const normalizedText = text.toLowerCase();
        if (item.getAttribute('data-text') !== normalizedText) {
            item.setAttribute('data-text', normalizedText);
            item.title = text;
            item.querySelector('.toc-text').textContent = text;
        }

        item.dataset.index = String(index);
    }

    function trimExtraTocItems(list, total) {
        while (list.children.length > total) {
            list.removeChild(list.lastChild);
        }
    }

    function renderTocItems(list, messages) {
        for (let i = 0; i < messages.length; i++) {
            const item = ensureTocItem(list, i);
            updateTocItem(item, messages[i].text, i);
        }

        trimExtraTocItems(list, messages.length);
    }

    function resetTocActiveState(list, previousActiveIndex, total) {
        if (previousActiveIndex >= 0 && list.children[previousActiveIndex]) {
            list.children[previousActiveIndex].classList.remove('toc-active');
        }

        STATE.activeIndex = -1;
        if (STATE.clickLockIndex >= total) {
            STATE.clickLockIndex = -1;
        }
        clearManualActiveIndex();
    }

    function syncTocSearchFilter() {
        const input = document.querySelector('.toc-search input');
        if (input && input.value) {
            filterList(input.value);
        }
    }

    function finalizeRenderedToc(list, previousActiveIndex, total) {
        resetTocActiveState(list, previousActiveIndex, total);
        syncTocSearchFilter();
        bindScrollSync();
        refreshPositionCache();
        scheduleActiveSync();
    }

    function collectCurrentMessages() {
        const messages = collectMessagesFromAdapter(ADAPTER);
        STATE.messages = messages;
        return messages;
    }

    function clearTocStatusState(list) {
        if (list.querySelector('.toc-status')) {
            clearElementChildren(list);
        }
    }

    function renderScanResult(list, messages, previousActiveIndex) {
        const total = messages.length;
        if (total === 0) {
            renderEmptyTocState(list);
            return;
        }

        clearTocStatusState(list);
        renderTocItems(list, messages);
        finalizeRenderedToc(list, previousActiveIndex, total);
    }

    // App bootstrap
    function createUI() {
        if (getPanelElement()) return;
        if (!document.body) return;

        injectStyles();

        const panel = createPanelElement();
        const header = createHeaderSection();
        const list = createTocListElement();

        panel.append(header, list);
        document.body.appendChild(panel);

        bindGlobalInteractionEvents();
        bindPanelDrag(panel, header);

        setTimeout(() => panel.classList.add('toc-visible'), 100);
        bindWindowResizeRefresh();
        startObserver();
        scanContent();
    }

    function scanContent() {
        const list = getTocList();
        if (!list) return;
        renderScanResult(list, collectCurrentMessages(), STATE.activeIndex);
    }

    function ensureAppRunning() {
        const panel = getPanelElement();
        if (!panel) {
            createUI();
        }
        if (!STATE.observer) {
            startObserver();
        }
    }

    function bootstrap() {
        ensureAppRunning();
        if (getPanelElement()) {
            scheduleScan(0);
        }
        window.setInterval(ensureAppRunning, 2000);
    }

    bootstrap();
})();
