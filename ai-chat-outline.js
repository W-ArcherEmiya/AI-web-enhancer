// ==UserScript==
// @name         ai-chat-outline
// @namespace    http://tampermonkey.net/
// @version      2.8.7
// @description  Adds a sidebar table of contents to ChatGPT, Gemini and Claude.
// @author       ArcherEmiya
// @match        https://gemini.google.com/*
// @match        https://chatgpt.com/*
// @match        https://claude.ai/*
// @grant        unsafeWindow
// @run-at       document-start
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
    console.log('ai-chat-outline v2.8.7: started');

    function getPageWindow() {
        try {
            if (typeof unsafeWindow !== 'undefined' && unsafeWindow) return unsafeWindow;
        } catch (error) {
            // Some script managers expose unsafeWindow lazily; window remains a valid fallback.
        }
        return window;
    }

    const CONFIG = {
        displayCount: 8,
        panelWidth: 280,
        panelMargin: 8,
        bubbleSize: 48,
        autoCollapse: true,
        autoCollapseDelay: 12000
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
        bottomBoundaryMaxAttempts: 120,
        virtualSeekInterval: 260,
        virtualSeekMaxAttempts: 120
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
        autoCollapseTimer: 0,
        positionCache: [],
        positionsDirty: true,
        chatGptCatalogMessages: [],
        chatGptCatalogContext: '',
        chatGptCatalogSource: '',
        remoteMessages: [],
        remoteMessageContext: '',
        remoteMessageSource: '',
        remoteMessageIsAuthoritative: false,
        remoteFetchContext: '',
        remoteFetchInFlight: false,
        remoteFetchStatus: '',
        remoteResponseUrl: '',
        remoteResponseStatus: 0,
        remotePayloadShape: '',
        remotePayloadPath: '',
        chatGptPathIndexByIdentity: new Map(),
        conversationInterceptorInstalled: false,
        claudeCatalogMessages: [],
        claudeCatalogContext: '',
        claudeCatalogSource: '',
        claudeRemoteMessages: [],
        claudeRemoteContext: '',
        claudeRemoteSource: '',
        claudeRemoteStatus: '',
        claudeLastConversationUrl: '',
        claudeObservedUrls: [],
        claudeHydrateUrl: '',
        claudeResourceObserver: null,
        claudeConversationInterceptorInstalled: false,
        claudeDirectDomMessages: 0,
        claudeDocumentUserMessages: 0,
        claudeDirectDomSamples: [],
        claudeDirectScrollContainer: '',
        claudeDirectScrollStats: null,
        lastTocSource: '',
        messageListContext: '',
        lastTocClick: null,
        lastNavigationDebug: null,
        lastActiveDebug: null,
        virtualSeekTimer: 0,
        observer: null,
        globalEventsBound: false
    };

    const STORAGE_KEYS = {
        panelPosition: 'ai-toc-v2_5-panel-position',
        expandedPosition: 'ai-toc-v2_5-expanded-position',
        bubblePosition: 'ai-toc-v2_5-bubble-position',
        collapsed: 'ai-toc-v2_5-collapsed'
    };

    const PATHS = {
        search: 'M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
        top: 'M7 4h10v2H7V4zm5 3l-5 5h3v8h4v-8h3l-5-5z',
        bottom: 'M10 4h4v8h3l-5 5-5-5h3V4zM7 18h10v2H7v-2z',
        spin: 'M12 4V2A10 10 0 0 0 2 12h2a8 8 0 0 1 8-8z',
        bullet: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z',
        collapse: 'M19 13H5v-2h14v2z',
        expand: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
        clear: 'M18.3 5.71 16.89 4.3 12 9.17 7.11 4.3 5.7 5.71 10.59 10.6 5.7 15.49 7.11 16.9 12 12.01 16.89 16.9 18.3 15.49 13.41 10.6z'
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

    function extractChatGptUserQueryText(element) {
        if (!element || !element.querySelector) return normalizeMessageText(element);
        const content = element.matches && element.matches('.whitespace-pre-wrap')
            ? element
            : element.querySelector('.whitespace-pre-wrap');
        return normalizeMessageText(content || element);
    }

    function normalizePlainText(text) {
        return (text || '').replace(/\s+/g, ' ').trim();
    }

    function getComparableMessageText(text) {
        return normalizePlainText(text)
            .replace(/[\u200b-\u200f\ufeff]/g, '')
            .replace(/^\[(image|photo|picture|file|attachment|图片|图像|文件|附件)\]\s*/i, '')
            .replace(/\[(image|photo|picture|file|attachment|图片|图像|文件|附件)\]\s*/gi, '')
            .replace(/^(you said|user said|您说|你说|我说)[:：]\s*/i, '')
            .replace(/\s*(copy|copied|edit|复制|已复制|编辑)$/i, '')
            .toLowerCase()
            .replace(/\s+/g, '');
    }

    function isComparableTextMatch(remoteText, liveText) {
        if (!remoteText || !liveText) return false;
        if (remoteText === liveText) return true;

        const minLength = Math.min(remoteText.length, liveText.length);
        if (minLength < 4) return false;

        return liveText.includes(remoteText) || remoteText.includes(liveText);
    }

    function findOrderedComparableTextIndex(texts, comparable, startIndex, usedIndexes) {
        if (!comparable) return -1;
        const start = typeof startIndex === 'number' ? startIndex : 0;

        for (let i = start; i < texts.length; i++) {
            if (usedIndexes && usedIndexes.has(i)) continue;
            if (texts[i] === comparable) return i;
        }

        const compatibleIndexes = [];
        for (let i = start; i < texts.length; i++) {
            if (usedIndexes && usedIndexes.has(i)) continue;
            if (isComparableTextMatch(texts[i], comparable)) compatibleIndexes.push(i);
        }
        return compatibleIndexes.length === 1 ? compatibleIndexes[0] : -1;
    }

    function normalizeNativeTocText(text) {
        return normalizePlainText(text);
    }

    function isCompatibleNativeTocText(liveText, tocText) {
        const live = normalizeNativeTocText(liveText);
        const toc = normalizeNativeTocText(tocText);
        if (!live || !toc) return false;
        if (live === toc) return true;
        return Math.min(live.length, toc.length) >= 200 && (live.startsWith(toc) || toc.startsWith(live));
    }

    function getChatGptNativeTocButtonIndex(button, fallbackIndex) {
        const label = (button.getAttribute('aria-label') || '').trim();
        const match = /^Prompt\s+(\d+)$/i.exec(label);
        if (!match || !match[1]) return fallbackIndex;

        const parsed = Number.parseInt(match[1], 10);
        return Number.isNaN(parsed) ? fallbackIndex : Math.max(0, parsed - 1);
    }

    function getChatGptNativeTocButtons() {
        if (!window.location.hostname.includes('chatgpt.com')) return [];

        return Array.from(document.querySelectorAll('button[aria-label^="Prompt "]'))
            .filter((button) => {
                if (!(button instanceof HTMLElement)) return false;
                const label = (button.getAttribute('aria-label') || '').trim();
                if (!/^Prompt\s+\d+$/i.test(label)) return false;

                const nativeTocContainer = button.closest('.no-scrollbar');
                return !!(nativeTocContainer && nativeTocContainer.querySelectorAll('button[aria-label^="Prompt "]').length);
            })
            .sort((a, b) => getChatGptNativeTocButtonIndex(a, 0) - getChatGptNativeTocButtonIndex(b, 0));
    }

    function getChatGptNativeTocTexts(buttons) {
        const firstButton = buttons[0];
        const container = firstButton
            ? firstButton.closest('.no-scrollbar')?.parentElement ||
                firstButton.closest('.relative.flex.items-start') ||
                firstButton.closest('.fixed')
            : null;
        if (!container) return [];

        const titleElements = Array.from(container.querySelectorAll([
            'button[data-fill] [title]',
            'button[class*="__menu-item"] [title]',
            'ul button [title]',
            '[role="menu"] [title]',
            '.absolute [title]'
        ].join(', ')));
        const seen = new Set();

        return titleElements
            .filter((element) => {
                if (!(element instanceof HTMLElement)) return false;
                if (seen.has(element)) return false;
                seen.add(element);
                return true;
            })
            .map((element) => normalizeNativeTocText(element.getAttribute('title') || element.textContent || ''))
            .filter(Boolean);
    }

    function getChatGptNativeTocEntries() {
        const buttons = getChatGptNativeTocButtons();
        if (!buttons.length) return [];

        const texts = getChatGptNativeTocTexts(buttons);
        if (texts.length !== buttons.length) return [];

        const textCounts = new Map();
        texts.forEach((text) => {
            const normalized = normalizeNativeTocText(text);
            textCounts.set(normalized, (textCounts.get(normalized) || 0) + 1);
        });
        const hasPrefixAmbiguity = (text) => {
            const normalized = normalizeNativeTocText(text);
            if (!normalized) return true;
            return texts.some((candidate) => {
                const comparable = normalizeNativeTocText(candidate);
                return comparable && comparable !== normalized &&
                    (normalized.startsWith(comparable) || comparable.startsWith(normalized));
            });
        };

        const liveByText = new Map();
        Array.from(document.querySelectorAll('[data-message-author-role="user"]')).forEach((element) => {
            const text = normalizeNativeTocText(extractChatGptUserQueryText(element));
            if (!text) return;
            const group = liveByText.get(text) || [];
            group.push(element);
            liveByText.set(text, group);
        });

        return buttons.map((button, index) => {
            const text = texts[index] || '';
            const normalizedText = normalizeNativeTocText(text);
            const liveMatches = liveByText.get(normalizedText) || [];
            const uniqueLiveElement = textCounts.get(normalizedText) === 1 &&
                !hasPrefixAmbiguity(text) &&
                liveMatches.length === 1
                ? liveMatches[0]
                : null;
            return {
                index: getChatGptNativeTocButtonIndex(button, index),
                text,
                button,
                element: uniqueLiveElement,
                isActive: button.hasAttribute('data-toc-active')
            };
        });
    }

    function getChatGptNativeTocEntryForIndex(index) {
        return getChatGptNativeTocEntries().find((entry) => entry.index === index) || null;
    }

    function getChatGptActiveNativeTocIndex() {
        const buttons = getChatGptNativeTocButtons();
        const activeButton = buttons.find((button) => button.hasAttribute('data-toc-active'));
        if (!activeButton) return null;

        const buttonIndex = buttons.indexOf(activeButton);
        return getChatGptNativeTocButtonIndex(activeButton, buttonIndex);
    }

    function annotateMessagesWithNativeToc(messages) {
        if (!window.location.hostname.includes('chatgpt.com') || !messages.length) return messages;

        const entries = getChatGptNativeTocEntries();
        if (!entries.length) return messages;

        const used = new Set();
        const canUseListPosition = messages.length === entries.length;
        messages.forEach((message, messageIndex) => {
            const remoteIndex = getMessageRemoteIndex(message, messageIndex);
            const hasAuthoritativeIndex = typeof message.remoteIndex === 'number' ||
                typeof message.nativeTocIndex === 'number';
            let entry = null;
            if (hasAuthoritativeIndex || canUseListPosition) {
                entry = entries.find((candidate) => (
                    candidate.index === remoteIndex &&
                    !used.has(candidate.index) &&
                    isCompatibleNativeTocText(message.text, candidate.text)
                ));
            }
            if (!entry) {
                const compatibleEntries = entries.filter((candidate) => {
                    if (used.has(candidate.index)) return false;
                    return isCompatibleNativeTocText(message.text, candidate.text);
                });
                entry = compatibleEntries.length === 1 ? compatibleEntries[0] : null;
            }
            if (!entry) return;

            used.add(entry.index);
            message.nativeTocIndex = entry.index;
            message.nativeTocText = entry.text;
            message.navigationId = `chatgpt-native-user-query::${entry.index}`;
            if (entry.element) {
                const domIdentityKey = getMessageIdentityKeyFromElement(entry.element);
                if (domIdentityKey) {
                    message.identityKeys = createMessageIdentityKeys.apply(
                        null,
                        getMessageIdentityKeys(message).concat([domIdentityKey])
                    );
                    message.identityKey = message.identityKeys[0] || message.identityKey;
                    message.anchor = entry.element;
                    message.container = ADAPTER ? ADAPTER.resolveMessageContainer(entry.element) : entry.element;
                    message.anchorSource = 'native-toc';
                }
            }
        });

        return messages;
    }

    function collectChatGptNativeTocMessages() {
        const entries = getChatGptNativeTocEntries();
        return entries
            .filter((entry) => entry.text && entry.text.trim())
            .map((entry) => {
                const identityKey = entry.element ? getMessageIdentityKeyFromElement(entry.element) : '';
                const message = {
                    container: entry.element || null,
                    anchor: entry.element || null,
                    text: entry.text,
                    identityKey,
                    identityKeys: createMessageIdentityKeys(identityKey),
                    nativeTocIndex: entry.index,
                    nativeTocText: entry.text,
                    navigationId: `chatgpt-native-user-query::${entry.index}`,
                    source: 'chatgpt-native-toc',
                    anchorSource: entry.element ? 'native-toc' : 'native-toc-button'
                };
                return message;
            });
    }

    function getChatGptConversationIdFromText(text) {
        if (!text) return '';

        const patterns = [
            /\/c\/([0-9a-f-]{20,})/i,
            /\/backend-api\/(?:f\/)?conversations?\/([0-9a-f-]{20,})/i,
            /[?&]conversation_id=([0-9a-f-]{20,})/i
        ];

        for (let i = 0; i < patterns.length; i++) {
            const match = text.match(patterns[i]);
            if (match && match[1]) return match[1];
        }

        return '';
    }

    function getChatGptConversationId() {
        if (!window.location.hostname.includes('chatgpt.com')) return '';

        try {
            const params = new URLSearchParams(window.location.search);
            const queryId = params.get('conversation_id');
            if (queryId) return queryId;
        } catch (error) {
            // URLSearchParams can fail on malformed extension URLs; path parsing still covers normal pages.
        }

        return getChatGptConversationIdFromText(window.location.href);
    }

    function getMessageIdentityKeyFromElement(element) {
        if (!element || !element.getAttribute) return '';

        const directId = element.getAttribute('data-message-id') || element.getAttribute('data-message-uuid');
        if (directId) return `message:${directId}`;

        const closest = element.closest ? element.closest('[data-message-id], [data-message-uuid]') : null;
        const closestId = closest
            ? closest.getAttribute('data-message-id') || closest.getAttribute('data-message-uuid') || ''
            : '';
        return closestId ? `message:${closestId}` : '';
    }

    function createMessageIdentityKeys() {
        const seen = new Set();
        const keys = [];

        for (let i = 0; i < arguments.length; i++) {
            const id = arguments[i];
            if (!id) continue;

            const key = String(id).startsWith('message:') ? String(id) : `message:${id}`;
            if (seen.has(key)) continue;

            seen.add(key);
            keys.push(key);
        }

        return keys;
    }

    function getMessageIdentityKeys(message) {
        if (!message) return [];

        const keys = [];
        if (Array.isArray(message.identityKeys)) keys.push(...message.identityKeys);
        if (message.identityKey) keys.push(message.identityKey);

        const elementKey = getMessageIdentityKeyFromElement(getMessageTarget(message));
        if (elementKey) keys.push(elementKey);

        return createMessageIdentityKeys.apply(null, keys);
    }

    function getMessageIdentityKey(message) {
        const keys = getMessageIdentityKeys(message);
        return keys[0] || '';
    }

    function getMessageIdFromIdentityKey(identityKey) {
        return identityKey && identityKey.indexOf('message:') === 0 ? identityKey.slice(8) : '';
    }

    function escapeCssValue(value) {
        if (window.CSS && typeof window.CSS.escape === 'function') {
            return window.CSS.escape(value);
        }
        return String(value).replace(/["\\]/g, '\\$&');
    }

    function getChatGptMessageCacheContext() {
        const conversationId = getChatGptConversationId();
        if (conversationId) return `chatgpt:${conversationId}`;
        return `${window.location.hostname}${window.location.pathname}${window.location.search}`;
    }

    function flattenConversationPart(part) {
        if (typeof part === 'string') return part;
        if (!part) return '';

        if (Array.isArray(part)) {
            return part.map(flattenConversationPart).filter(Boolean).join(' ');
        }

        if (typeof part !== 'object') return '';
        if (typeof part.text === 'string') return part.text;
        if (typeof part.content === 'string') return part.content;
        if (Array.isArray(part.parts)) return flattenConversationPart(part.parts);
        if (Array.isArray(part.content)) return flattenConversationPart(part.content);
        if (part.content_type && /image/i.test(String(part.content_type))) return '[image]';
        return '';
    }

    function getConversationMessageText(message) {
        if (!message || !message.content) return '';

        const content = message.content;
        if (Array.isArray(content.parts)) {
            return normalizePlainText(content.parts.map(flattenConversationPart).filter(Boolean).join(' '));
        }

        return normalizePlainText(flattenConversationPart(content));
    }

    function getChatGptConversationCandidate(data) {
        const queue = [{ value: data, path: '$', depth: 0 }];
        const visited = new WeakSet();
        let best = null;
        let inspected = 0;

        while (queue.length && inspected < 4000) {
            const current = queue.shift();
            let value = current.value;
            if (typeof value === 'string' && /^[\s]*[{[]/.test(value)) {
                try {
                    value = JSON.parse(value);
                } catch (error) {
                    continue;
                }
            }
            if (!value || typeof value !== 'object') continue;
            if (visited.has(value)) continue;
            visited.add(value);
            inspected += 1;

            const mapping = value.mapping || value.message_mapping || value.messageMapping;
            const rawCurrentNode = value.current_node || value.currentNode || value.current_node_id || value.currentNodeId;
            const currentNode = rawCurrentNode && typeof rawCurrentNode === 'object'
                ? rawCurrentNode.id || rawCurrentNode.node_id || rawCurrentNode.nodeId || ''
                : rawCurrentNode;
            if (mapping && (Array.isArray(mapping) || typeof mapping === 'object')) {
                const mappingCount = Array.isArray(mapping) ? mapping.length : Object.keys(mapping).length;
                const score = 1000 + mappingCount + (currentNode ? 10000 : 0);
                if (!best || score > best.score) {
                    best = {
                        value,
                        mapping,
                        currentNode: currentNode || '',
                        mappingCount,
                        path: current.path,
                        score
                    };
                }
            }

            if (current.depth >= 7) continue;
            const priorityKeys = ['conversation', 'data', 'result', 'payload', 'body', 'value', 'response'];
            const keys = Object.keys(value);
            priorityKeys.concat(keys.filter((key) => !priorityKeys.includes(key))).forEach((key) => {
                const child = value[key];
                if (!child || (typeof child !== 'object' && typeof child !== 'string')) return;
                queue.push({ value: child, path: `${current.path}.${key}`, depth: current.depth + 1 });
            });
        }

        if (!best) return null;
        const mappingEntries = Array.isArray(best.mapping)
            ? best.mapping.map((node, index) => [
                node && (node.id || (node.message && node.message.id)) || String(index),
                node
            ])
            : Object.entries(best.mapping);
        const normalizedMapping = mappingEntries.reduce((result, entry) => {
            const id = entry[0];
            const node = entry[1];
            if (!node || typeof node !== 'object') return result;
            result[id] = node.id ? node : Object.assign({ id }, node);
            return result;
        }, {});

        return {
            data: Object.assign({}, best.value, {
                mapping: normalizedMapping,
                current_node: best.currentNode
            }),
            path: best.path,
            mappingCount: best.mappingCount
        };
    }

    function describeChatGptPayload(data) {
        if (Array.isArray(data)) return `array:${data.length}`;
        if (!data || typeof data !== 'object') return typeof data;
        return `object:${Object.keys(data).slice(0, 16).join(',')}`;
    }

    function getConversationPathNodes(data) {
        const mapping = data && data.mapping ? data.mapping : null;
        if (!mapping) return [];

        if (data.current_node && mapping[data.current_node]) {
            const path = [];
            const seen = new Set();
            let node = mapping[data.current_node];

            while (node && !seen.has(node.id)) {
                seen.add(node.id);
                path.push(node);
                node = node.parent ? mapping[node.parent] : null;
            }

            return path.reverse();
        }

        return Object.keys(mapping)
            .map((key) => mapping[key])
            .sort((a, b) => {
                const aTime = a && a.message && typeof a.message.create_time === 'number' ? a.message.create_time : 0;
                const bTime = b && b.message && typeof b.message.create_time === 'number' ? b.message.create_time : 0;
                return aTime - bTime;
            });
    }

    function shouldUseConversationMessage(message) {
        if (!message) return false;
        const metadata = message.metadata || {};
        return !metadata.is_visually_hidden_from_conversation && !metadata.is_hidden;
    }

    function extractChatGptUserMessagesFromNodes(nodes) {
        const seen = new Set();
        return nodes.reduce((messages, node) => {
            const message = node && node.message;
            const role = message && message.author ? message.author.role : '';
            if (role !== 'user') return messages;
            if (!shouldUseConversationMessage(message)) return messages;

            const text = getConversationMessageText(message);
            if (!text) return messages;

            const identityKeys = createMessageIdentityKeys(message.id, node.id);
            const seenKey = identityKeys[0] || '';
            if (seenKey && seen.has(seenKey)) return messages;
            if (seenKey) seen.add(seenKey);

            messages.push({
                container: null,
                anchor: null,
                text,
                identityKey: seenKey,
                identityKeys,
                source: 'conversation'
            });
            return messages;
        }, []);
    }

    function extractChatGptUserMessages(data) {
        return extractChatGptUserMessagesFromNodes(getConversationPathNodes(data));
    }

    function buildChatGptPathIndexByIdentity(data) {
        const indexByIdentity = new Map();
        let userIndex = -1;

        getConversationPathNodes(data).forEach((node) => {
            const message = node && node.message;
            const role = message && message.author ? message.author.role : '';
            if (role === 'user' && shouldUseConversationMessage(message) && getConversationMessageText(message)) {
                userIndex += 1;
            }
            if (userIndex < 0 || !shouldUseConversationMessage(message)) return;

            createMessageIdentityKeys(message && message.id, node && node.id).forEach((key) => {
                if (key && !indexByIdentity.has(key)) indexByIdentity.set(key, userIndex);
            });
        });

        return indexByIdentity;
    }

    function applyChatGptConversationData(data, source, contextOverride) {
        const candidate = getChatGptConversationCandidate(data);
        STATE.remotePayloadShape = describeChatGptPayload(data);
        STATE.remotePayloadPath = candidate ? candidate.path : '';
        const conversationData = candidate ? candidate.data : null;
        const messages = conversationData ? extractChatGptUserMessages(conversationData) : [];
        if (!messages.length) {
            if (!STATE.remoteMessages.length) {
                STATE.remoteFetchStatus = `${source}:${candidate ? 'no-user-messages' : 'unsupported-payload'}`;
            }
            return false;
        }

        const context = contextOverride || getChatGptMessageCacheContext();
        const mapping = conversationData.mapping;
        const hasCurrentPath = !!(mapping && conversationData.current_node && mapping[conversationData.current_node]);
        if (!hasCurrentPath && STATE.remoteMessageContext === context && STATE.remoteMessageIsAuthoritative) {
            STATE.remoteFetchStatus = `${source}:ignored-non-current-path`;
            return false;
        }
        if (!hasCurrentPath && STATE.remoteMessageContext === context && STATE.remoteMessages.length > messages.length) {
            STATE.remoteFetchStatus = `${source}:ignored-short:${messages.length}<${STATE.remoteMessages.length}`;
            return false;
        }

        STATE.remoteMessages = messages;
        STATE.remoteMessageContext = context;
        STATE.remoteMessageSource = source;
        STATE.remoteMessageIsAuthoritative = hasCurrentPath;
        if (hasCurrentPath) {
            STATE.chatGptPathIndexByIdentity = buildChatGptPathIndexByIdentity(conversationData);
        }
        STATE.remoteFetchStatus = `${source}:${hasCurrentPath ? 'current-path' : 'fallback'}:ok:${messages.length}`;
        scheduleScan(0);
        return true;
    }

    function alignLiveMessagesByComparableText(remoteMessages, liveMessages) {
        const liveByRemoteIndex = new Map();
        const usedRemoteIndexes = new Set();
        let nextRemoteIndex = 0;
        const remoteTexts = remoteMessages.map((message) => getComparableMessageText(message.text));

        liveMessages.forEach((liveMessage) => {
            const liveText = getComparableMessageText(liveMessage.text);
            if (!liveText) return;

            const matchedIndex = findOrderedComparableTextIndex(
                remoteTexts,
                liveText,
                nextRemoteIndex,
                usedRemoteIndexes
            );

            if (matchedIndex < 0) return;

            const matchType = remoteTexts[matchedIndex] === liveText
                ? 'exact-text-order'
                : 'contained-text-order';

            usedRemoteIndexes.add(matchedIndex);
            liveByRemoteIndex.set(matchedIndex, liveMessage);
            liveMessage.remoteIndex = matchedIndex;
            liveMessage.anchorSource = matchType;
            nextRemoteIndex = matchedIndex + 1;
        });

        return liveByRemoteIndex;
    }

    function getTextAlignmentPreview() {
        const remoteTexts = STATE.remoteMessages.map((message) => getComparableMessageText(message.text));
        let nextRemoteIndex = 0;

        return Array.from(document.querySelectorAll('[data-message-author-role="user"]')).map((element, liveIndex) => {
            const liveText = extractChatGptUserQueryText(element);
            const comparable = getComparableMessageText(liveText);
            const matchedRemoteIndex = findOrderedComparableTextIndex(remoteTexts, comparable, nextRemoteIndex);
            if (matchedRemoteIndex >= 0) nextRemoteIndex = matchedRemoteIndex + 1;

            return {
                liveIndex,
                matchedRemoteIndex,
                liveText: liveText.slice(0, 80),
                remoteText: matchedRemoteIndex >= 0 ? STATE.remoteMessages[matchedRemoteIndex].text.slice(0, 80) : ''
            };
        });
    }

    function getCurrentTextAlignmentMatches() {
        const remoteTexts = STATE.remoteMessages.map((message) => getComparableMessageText(message.text));
        const remoteByIdentity = new Map();
        STATE.remoteMessages.forEach((message, remoteIndex) => {
            getMessageIdentityKeys(message).forEach((key) => {
                if (key && !remoteByIdentity.has(key)) remoteByIdentity.set(key, remoteIndex);
            });
        });
        let nextRemoteIndex = 0;

        return Array.from(document.querySelectorAll('[data-message-author-role="user"]')).reduce((matches, element, liveIndex) => {
            const liveText = extractChatGptUserQueryText(element);
            const comparable = getComparableMessageText(liveText);
            const identityKey = getMessageIdentityKeyFromElement(element);
            let matchedRemoteIndex = identityKey && remoteByIdentity.has(identityKey)
                ? remoteByIdentity.get(identityKey)
                : -1;
            let matchType = matchedRemoteIndex >= 0 ? 'message-id' : '';
            if (matchedRemoteIndex < 0) {
                matchedRemoteIndex = findOrderedComparableTextIndex(remoteTexts, comparable, nextRemoteIndex);
                matchType = matchedRemoteIndex >= 0
                    ? (remoteTexts[matchedRemoteIndex] === comparable ? 'exact-text-order' : 'contained-text-order')
                    : '';
            }
            if (matchedRemoteIndex >= 0) nextRemoteIndex = matchedRemoteIndex + 1;

            if (matchedRemoteIndex >= 0) {
                matches.push({
                    element,
                    liveIndex,
                    remoteIndex: matchedRemoteIndex,
                    source: matchType,
                    liveText
                });
            }

            return matches;
        }, []);
    }

    function getCurrentChatGptTurnAlignmentMatches() {
        if (!STATE.chatGptPathIndexByIdentity.size) return [];

        return Array.from(document.querySelectorAll('[data-message-author-role]')).reduce((matches, element) => {
            const identityKey = getMessageIdentityKeyFromElement(element);
            if (!identityKey || !STATE.chatGptPathIndexByIdentity.has(identityKey)) return matches;
            matches.push({
                element,
                remoteIndex: STATE.chatGptPathIndexByIdentity.get(identityKey),
                role: element.getAttribute('data-message-author-role') || '',
                source: 'conversation-path-id'
            });
            return matches;
        }, []);
    }

    function mergeRemoteAndLiveMessages(remoteMessages, liveMessages) {
        if (!remoteMessages.length) return liveMessages;

        const liveByIdentity = new Map();
        const liveByRemoteIndex = alignLiveMessagesByComparableText(remoteMessages, liveMessages);
        const usedLiveMessages = new Set();

        liveMessages.forEach((message) => {
            const keys = getMessageIdentityKeys(message);
            if (!keys.length) return;

            message.identityKey = keys[0];
            message.identityKeys = keys;

            keys.forEach((key) => {
                if (!liveByIdentity.has(key)) liveByIdentity.set(key, message);
            });
        });

        const merged = remoteMessages.map((remoteMessage, remoteIndex) => {
            const keys = getMessageIdentityKeys(remoteMessage);
            const key = keys[0] || '';
            let liveMessage = null;
            let anchorSource = '';

            for (let i = 0; i < keys.length; i++) {
                liveMessage = liveByIdentity.get(keys[i]);
                if (liveMessage) {
                    anchorSource = 'id';
                    break;
                }
            }

            if (!liveMessage) {
                liveMessage = liveByRemoteIndex.get(remoteIndex) || null;
                if (liveMessage) anchorSource = liveMessage.anchorSource || 'text-order';
            }

            if (!liveMessage) return {
                container: null,
                anchor: null,
                text: remoteMessage.text,
                identityKey: key,
                identityKeys: keys,
                remoteIndex,
                source: remoteMessage.source
            };

            usedLiveMessages.add(liveMessage);
            return {
                container: liveMessage.container,
                anchor: liveMessage.anchor,
                text: liveMessage.text || remoteMessage.text,
                identityKey: key,
                identityKeys: keys,
                remoteIndex,
                anchorSource,
                source: 'live'
            };
        });

        liveMessages.forEach((message) => {
            if (!usedLiveMessages.has(message)) merged.push(message);
        });

        return merged;
    }

    function snapshotChatGptCatalogMessages(messages) {
        return messages.map((message, index) => {
            const snapshot = snapshotChatGptCatalogMessage(message, index);
            if (typeof snapshot.remoteIndex !== 'number' && typeof snapshot.nativeTocIndex !== 'number') {
                snapshot.remoteIndex = index;
            }
            return snapshot;
        });
    }

    function replaceChatGptCatalog(messages, context, source) {
        STATE.chatGptCatalogMessages = snapshotChatGptCatalogMessages(messages);
        STATE.chatGptCatalogContext = context;
        STATE.chatGptCatalogSource = source;
    }

    function getChatGptMessageTurnIndex(message, fallbackIndex) {
        if (message && typeof message.turnIndex === 'number') return message.turnIndex;
        const target = getMessageTarget(message);
        const turn = target && target.closest
            ? target.closest('[data-testid^="conversation-turn-"]')
            : null;
        if (turn) {
            const match = /^conversation-turn-(\d+)/.exec(turn.getAttribute('data-testid') || '');
            if (match && match[1]) {
                const parsed = Number.parseInt(match[1], 10);
                if (!Number.isNaN(parsed)) return parsed;
            }
        }
        return typeof fallbackIndex === 'number' ? fallbackIndex + 1000000 : Number.MAX_SAFE_INTEGER;
    }

    function getChatGptMessageTurnId(message) {
        if (message && message.turnId) return message.turnId;
        const target = getMessageTarget(message);
        const turn = target && target.closest
            ? target.closest('[data-turn-id-container], [data-turn-id]')
            : null;
        return turn
            ? turn.getAttribute('data-turn-id-container') || turn.getAttribute('data-turn-id') || ''
            : '';
    }

    function mergeLiveMessagesIntoChatGptCatalog(liveMessages, context) {
        const existing = STATE.chatGptCatalogContext === context
            ? STATE.chatGptCatalogMessages.map(snapshotChatGptCatalogMessage)
            : [];
        const byIdentity = new Map();
        const byTurnId = new Map();

        existing.forEach((message) => {
            getMessageIdentityKeys(message).forEach((key) => {
                if (!byIdentity.has(key)) byIdentity.set(key, message);
            });
            const turnId = getChatGptMessageTurnId(message);
            if (turnId && !byTurnId.has(turnId)) byTurnId.set(turnId, message);
        });

        liveMessages.forEach((liveMessage, liveIndex) => {
            const identityKeys = getMessageIdentityKeys(liveMessage);
            let cached = null;
            for (let i = 0; i < identityKeys.length; i++) {
                if (byIdentity.has(identityKeys[i])) {
                    cached = byIdentity.get(identityKeys[i]);
                    break;
                }
            }
            const liveTurnId = getChatGptMessageTurnId(liveMessage);
            if (!cached && liveTurnId && byTurnId.has(liveTurnId)) {
                cached = byTurnId.get(liveTurnId);
            }

            if (!cached) {
                cached = snapshotChatGptCatalogMessage(liveMessage, liveIndex);
                cached.turnIndex = getChatGptMessageTurnIndex(liveMessage, liveIndex);
                cached.turnId = liveTurnId;
                existing.push(cached);
            } else {
                const rebound = snapshotChatGptCatalogMessage(liveMessage, liveIndex);
                cached.anchor = rebound.anchor;
                cached.container = rebound.container;
                cached.text = rebound.text || cached.text;
                cached.identityKeys = createMessageIdentityKeys.apply(
                    null,
                    getMessageIdentityKeys(cached).concat(identityKeys)
                );
                cached.identityKey = cached.identityKeys[0] || '';
                cached.turnIndex = Math.min(
                    getChatGptMessageTurnIndex(cached, liveIndex),
                    getChatGptMessageTurnIndex(liveMessage, liveIndex)
                );
                cached.turnId = cached.turnId || liveTurnId;
                cached.anchorSource = 'turn-cache-live-anchor';
            }

            getMessageIdentityKeys(cached).forEach((key) => byIdentity.set(key, cached));
            if (cached.turnId) byTurnId.set(cached.turnId, cached);
        });

        existing.sort((a, b) => {
            const aTurn = getChatGptMessageTurnIndex(a);
            const bTurn = getChatGptMessageTurnIndex(b);
            if (aTurn !== bTurn) return aTurn - bTurn;
            return (a.observedIndex || 0) - (b.observedIndex || 0);
        });
        existing.forEach((message, index) => {
            message.remoteIndex = index;
        });

        replaceChatGptCatalog(existing, context, 'live-turn-cache');
        return bindLiveMessagesToChatGptCatalog(STATE.chatGptCatalogMessages, liveMessages);
    }

    function bindLiveMessagesToChatGptCatalog(catalogMessages, liveMessages) {
        if (!catalogMessages.length) return [];
        annotateMessagesWithNativeToc(liveMessages);

        const usedLiveMessages = new Set();
        const liveByIdentity = new Map();
        const liveByOrder = new Map();
        const catalogTextCounts = new Map();
        const liveByText = new Map();

        catalogMessages.forEach((message) => {
            const comparable = getComparableMessageText(message.text);
            if (comparable) catalogTextCounts.set(comparable, (catalogTextCounts.get(comparable) || 0) + 1);
        });

        liveMessages.forEach((message) => {
            getMessageIdentityKeys(message).forEach((key) => {
                if (!liveByIdentity.has(key)) liveByIdentity.set(key, message);
            });

            const order = typeof message.nativeTocIndex === 'number'
                ? message.nativeTocIndex
                : message.remoteIndex;
            if (typeof order === 'number' && !liveByOrder.has(order)) liveByOrder.set(order, message);

            const comparable = getComparableMessageText(message.text);
            if (comparable) {
                const group = liveByText.get(comparable) || [];
                group.push(message);
                liveByText.set(comparable, group);
            }
        });

        const rebound = catalogMessages.map((catalogMessage, index) => {
            const snapshot = snapshotChatGptCatalogMessage(catalogMessage, index);
            const catalogOrder = typeof snapshot.nativeTocIndex === 'number'
                ? snapshot.nativeTocIndex
                : snapshot.remoteIndex;
            let liveMessage = typeof catalogOrder === 'number' ? liveByOrder.get(catalogOrder) : null;

            if (!liveMessage) {
                const keys = getMessageIdentityKeys(snapshot);
                for (let i = 0; i < keys.length; i++) {
                    const candidate = liveByIdentity.get(keys[i]);
                    if (candidate && !usedLiveMessages.has(candidate)) {
                        liveMessage = candidate;
                        break;
                    }
                }
            }

            if (!liveMessage) {
                const comparable = getComparableMessageText(snapshot.text);
                const candidates = comparable ? liveByText.get(comparable) || [] : [];
                if (catalogTextCounts.get(comparable) === 1 && candidates.length === 1) {
                    liveMessage = candidates[0];
                }
            }

            if (!liveMessage || usedLiveMessages.has(liveMessage)) return snapshot;
            usedLiveMessages.add(liveMessage);

            snapshot.anchor = liveMessage.anchor && liveMessage.anchor.isConnected ? liveMessage.anchor : null;
            snapshot.container = liveMessage.container && liveMessage.container.isConnected ? liveMessage.container : null;
            snapshot.identityKeys = createMessageIdentityKeys.apply(
                null,
                getMessageIdentityKeys(snapshot).concat(getMessageIdentityKeys(liveMessage))
            );
            snapshot.identityKey = snapshot.identityKeys[0] || '';
            snapshot.anchorSource = liveMessage.anchorSource || 'catalog-live-anchor';
            return snapshot;
        });

        STATE.chatGptCatalogMessages = snapshotChatGptCatalogMessages(rebound);
        return rebound;
    }

    function snapshotChatGptCatalogMessage(message, fallbackIndex) {
        const target = getMessageTarget(message);
        const targetConnected = !!(target && target.isConnected);
        const anchorConnected = !!(message && message.anchor && message.anchor.isConnected);
        const containerConnected = !!(message && message.container && message.container.isConnected);
        const identityKeys = getMessageIdentityKeys(message);
        const snapshot = {
            container: containerConnected ? message.container : (targetConnected ? target : null),
            anchor: anchorConnected ? message.anchor : (targetConnected ? target : null),
            text: message && message.text ? message.text : '',
            identityKey: identityKeys[0] || '',
            identityKeys,
            navigationId: message && message.navigationId ? message.navigationId : '',
            nativeTocText: message && message.nativeTocText ? message.nativeTocText : '',
            source: message && message.source ? message.source : '',
            anchorSource: message && message.anchorSource ? message.anchorSource : '',
            observedIndex: message && typeof message.observedIndex === 'number' ? message.observedIndex : fallbackIndex
        };

        if (message && typeof message.turnIndex === 'number') {
            snapshot.turnIndex = message.turnIndex;
        }
        if (message && message.turnId) {
            snapshot.turnId = message.turnId;
        }

        if (message && typeof message.remoteIndex === 'number') {
            snapshot.remoteIndex = message.remoteIndex;
        }
        if (message && typeof message.nativeTocIndex === 'number') {
            snapshot.nativeTocIndex = message.nativeTocIndex;
        }
        return snapshot;
    }

    function getChatGptAccountId() {
        try {
            const raw = window.localStorage.getItem('_account');
            if (!raw) return '';
            const parsed = JSON.parse(raw);
            if (typeof parsed === 'string') return parsed === 'personal' ? '' : parsed;
            if (!parsed || typeof parsed !== 'object') return '';
            return parsed.account_id || parsed.accountId || parsed.id ||
                (parsed.account && (parsed.account.id || parsed.account.account_id)) || '';
        } catch (error) {
            return '';
        }
    }

    function getChatGptCookie(name) {
        const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = document.cookie.match(new RegExp(`(?:^|; )${escapedName}=([^;]*)`));
        if (!match) return '';
        try {
            return decodeURIComponent(match[1]);
        } catch (error) {
            return match[1];
        }
    }

    function getChatGptOriginalFetch() {
        const pageWindow = getPageWindow();
        const pageFetch = pageWindow.fetch;
        if (typeof pageFetch !== 'function') return null;
        return pageFetch.__aiTocOriginalFetch || pageFetch;
    }

    function fetchChatGptSessionToken(fetchFn) {
        return fetchFn.call(getPageWindow(), '/api/auth/session', {
            method: 'GET',
            credentials: 'include',
            headers: { accept: 'application/json' }
        })
            .then((response) => response.ok ? response.json() : null)
            .then((session) => {
                if (!session) return '';
                return session.accessToken || session.access_token || session.token ||
                    (session.user && session.user.accessToken) || '';
            })
            .catch(() => '');
    }

    function buildChatGptConversationHeaders(token) {
        const headers = { accept: 'application/json' };
        if (token) headers.authorization = `Bearer ${token}`;
        const accountId = getChatGptAccountId();
        if (accountId) headers['chatgpt-account-id'] = accountId;
        const deviceId = getChatGptCookie('oai-did');
        if (deviceId) headers['oai-device-id'] = deviceId;
        const language = document.documentElement.lang || navigator.language;
        if (language) headers['oai-language'] = language;
        return headers;
    }

    function hydrateChatGptConversationMessages() {
        const conversationId = getChatGptConversationId();
        if (!conversationId || STATE.remoteFetchInFlight) return;

        const context = getChatGptMessageCacheContext();
        if (STATE.remoteFetchContext === context) return;

        STATE.remoteFetchContext = context;
        STATE.remoteFetchInFlight = true;
        STATE.remoteFetchStatus = 'direct:loading';
        const fetchFn = getChatGptOriginalFetch();
        if (!fetchFn) {
            STATE.remoteFetchInFlight = false;
            STATE.remoteFetchStatus = 'direct:fetch-unavailable';
            return;
        }

        fetchChatGptSessionToken(fetchFn)
            .then((token) => {
                const encodedId = encodeURIComponent(conversationId);
                const urls = [
                    `/backend-api/conversation/${encodedId}`,
                    `/backend-api/f/conversation/${encodedId}`,
                    `/backend-api/conversations/${encodedId}`
                ];
                const headers = buildChatGptConversationHeaders(token);

                const tryNext = (index) => {
                    if (index >= urls.length) return Promise.resolve(false);
                    const url = urls[index];
                    return fetchFn.call(getPageWindow(), url, {
                        method: 'GET',
                        credentials: 'include',
                        headers
                    }).then((response) => {
                        STATE.remoteResponseUrl = response.url || url;
                        STATE.remoteResponseStatus = response.status || 0;
                        if (!response.ok) {
                            STATE.remoteFetchStatus = `direct:http-${response.status}`;
                            return tryNext(index + 1);
                        }
                        return response.json()
                            .then((data) => {
                                const applied = applyChatGptConversationData(data, 'direct', context);
                                const authoritative = applied &&
                                    STATE.remoteMessageContext === context &&
                                    STATE.remoteMessageIsAuthoritative;
                                return authoritative ? true : tryNext(index + 1);
                            }, () => {
                                STATE.remoteFetchStatus = 'direct:read-error';
                                return tryNext(index + 1);
                            });
                    });
                };

                return tryNext(0);
            })
            .catch(() => {
                STATE.remoteFetchContext = '';
                STATE.remoteFetchStatus = 'direct:error';
            })
            .finally(() => {
                STATE.remoteFetchInFlight = false;
            });
    }

    function isChatGptConversationResponseUrl(url) {
        return !!(url && (
            /\/backend-api\/(?:f\/)?conversations?\/[0-9a-f-]{20,}/i.test(url) ||
            /\/backend-api\/(?:f\/)?conversations?[^#]*[?&]conversation_id=[0-9a-f-]{20,}/i.test(url)
        ));
    }

    function readConversationResponse(response, source) {
        if (!response || !isChatGptConversationResponseUrl(response.url)) return;

        const conversationId = getChatGptConversationIdFromText(response.url);
        const currentConversationId = getChatGptConversationId();
        if (conversationId && currentConversationId && conversationId !== currentConversationId) return;
        const context = conversationId ? `chatgpt:${conversationId}` : getChatGptMessageCacheContext();
        STATE.remoteResponseUrl = response.url || '';
        STATE.remoteResponseStatus = response.status || 0;
        if (!response.ok) {
            if (STATE.remoteMessageContext !== context || !STATE.remoteMessageIsAuthoritative) {
                STATE.remoteFetchStatus = `${source}:http-${response.status}`;
            }
            return;
        }

        response.clone().json()
            .then((data) => applyChatGptConversationData(data, source, context))
            .catch(() => {
                STATE.remoteFetchStatus = `${source}:read-error`;
            });
    }

    function installChatGptConversationInterceptors() {
        if (!window.location.hostname.includes('chatgpt.com')) return;
        if (STATE.conversationInterceptorInstalled) return;
        STATE.conversationInterceptorInstalled = true;

        const pageWindow = getPageWindow();
        const originalFetch = pageWindow.fetch;
        if (typeof originalFetch === 'function') {
            const interceptedFetch = function interceptedFetch() {
                const result = originalFetch.apply(this, arguments);
                Promise.resolve(result)
                    .then((response) => readConversationResponse(response, 'page-fetch'))
                    .catch(() => {});
                return result;
            };
            interceptedFetch.__aiTocOriginalFetch = originalFetch.__aiTocOriginalFetch || originalFetch;
            pageWindow.fetch = interceptedFetch;
        }

        const OriginalXHR = pageWindow.XMLHttpRequest;
        if (typeof OriginalXHR === 'function' && OriginalXHR.prototype && !OriginalXHR.prototype.__aiTocConversationPatched) {
            const xhrProto = OriginalXHR.prototype;
            const originalOpen = xhrProto.open;
            const originalSend = xhrProto.send;

            xhrProto.open = function interceptedOpen(method, url) {
                this.__aiTocConversationUrl = typeof url === 'string' ? url : String(url || '');
                return originalOpen.apply(this, arguments);
            };

            xhrProto.send = function interceptedSend() {
                if (!this.__aiTocConversationListener) {
                    this.__aiTocConversationListener = true;
                    this.addEventListener('load', () => {
                        const requestUrl = this.__aiTocConversationUrl || '';
                        if (!isChatGptConversationResponseUrl(requestUrl)) return;
                        const conversationId = getChatGptConversationIdFromText(requestUrl);
                        const currentConversationId = getChatGptConversationId();
                        if (conversationId && currentConversationId && conversationId !== currentConversationId) return;
                        STATE.remoteResponseUrl = requestUrl;
                        STATE.remoteResponseStatus = this.status || 0;
                        if (this.status < 200 || this.status >= 300) {
                            const responseContext = conversationId
                                ? `chatgpt:${conversationId}`
                                : getChatGptMessageCacheContext();
                            if (STATE.remoteMessageContext !== responseContext || !STATE.remoteMessageIsAuthoritative) {
                                STATE.remoteFetchStatus = `page-xhr:http-${this.status}`;
                            }
                            return;
                        }

                        try {
                            const data = JSON.parse(this.responseText);
                            const context = conversationId ? `chatgpt:${conversationId}` : getChatGptMessageCacheContext();
                            applyChatGptConversationData(data, 'page-xhr', context);
                        } catch (error) {
                            STATE.remoteFetchStatus = 'page-xhr:read-error';
                        }
                    });
                }

                return originalSend.apply(this, arguments);
            };

            xhrProto.__aiTocConversationPatched = true;
        }
    }

    function exposeDebugInfo() {
        const pageWindow = getPageWindow();
        const debugFn = function aiTocDebug() {
            const alignmentMatches = getCurrentTextAlignmentMatches();
            const nativeTocButtons = getChatGptNativeTocButtons();
            const nativeTocTexts = getChatGptNativeTocTexts(nativeTocButtons);
            const liveSamples = Array.from(document.querySelectorAll('[data-message-author-role="user"]')).map((element, index) => {
                const text = extractChatGptUserQueryText(element);
                return {
                    index,
                    identityKey: getMessageIdentityKeyFromElement(element),
                    text: text.slice(0, 120),
                    comparable: getComparableMessageText(text).slice(0, 120)
                };
            });
            const remoteSamples = STATE.remoteMessages.map((message, index) => ({
                index,
                identityKeys: getMessageIdentityKeys(message),
                text: message.text.slice(0, 120),
                comparable: getComparableMessageText(message.text).slice(0, 120)
            }));
            const nativeTocSamples = getChatGptNativeTocEntries().map((entry) => ({
                index: entry.index,
                text: entry.text.slice(0, 120),
                hasElement: !!(entry.element && entry.element.isConnected),
                isActive: entry.isActive
            }));
            const adapterSamples = Array.from(document.querySelectorAll(ADAPTER.selector)).map((element, index) => ({
                index,
                text: ADAPTER.id === 'chatgpt'
                    ? extractChatGptUserQueryText(element).slice(0, 120)
                    : normalizeMessageText(element).slice(0, 120)
            }));
            const duplicateTextGroups = Array.from(STATE.messages.reduce((groups, message, index) => {
                const comparable = getComparableMessageText(message.text);
                if (!comparable) return groups;
                const group = groups.get(comparable) || [];
                group.push({
                    index,
                    identityKeys: getMessageIdentityKeys(message),
                    remoteIndex: typeof message.remoteIndex === 'number' ? message.remoteIndex : null,
                    nativeTocIndex: typeof message.nativeTocIndex === 'number' ? message.nativeTocIndex : null,
                    stableOrder: typeof message.stableOrder === 'number' ? message.stableOrder : null,
                    text: message.text.slice(0, 120)
                });
                groups.set(comparable, group);
                return groups;
            }, new Map()).values()).filter((group) => group.length > 1);

            return {
                version: '2.8.7',
                conversationId: getChatGptConversationId(),
                url: window.location.href,
                adapterId: ADAPTER.id,
                adapterSelector: ADAPTER.selector,
                adapterMatches: adapterSamples.length,
                liveDomUserMessages: document.querySelectorAll('[data-message-author-role="user"]').length,
                nativeTocMessages: getChatGptNativeTocEntries().length,
                nativeTocButtons: nativeTocButtons.length,
                nativeTocTexts: nativeTocTexts.length,
                nativeTocButtonLabels: nativeTocButtons.slice(0, 12).map((button) => button.getAttribute('aria-label') || ''),
                nativeTocTextSamples: nativeTocTexts.slice(0, 12),
                userMessageSlots: getChatGptMessageSlotSummary().filter((slot) => slot.userIndex !== null).length,
                chatGptIndexedSlotLayoutComplete: hasCompleteChatGptIndexedSlotLayout(getChatGptMessageSlotRoot()),
                chatGptSlotRootCount: document.querySelectorAll('[class*="convSearchResultHighlightRoot"]').length,
                tocMessages: STATE.messages.length,
                chatGptCatalogMessages: STATE.chatGptCatalogMessages.length,
                chatGptCatalogContext: STATE.chatGptCatalogContext,
                chatGptCatalogSource: STATE.chatGptCatalogSource,
                remoteMessages: STATE.remoteMessages.length,
                remoteMessageContext: STATE.remoteMessageContext,
                remoteMessageSource: STATE.remoteMessageSource,
                remoteMessageIsAuthoritative: STATE.remoteMessageIsAuthoritative,
                remoteFetchContext: STATE.remoteFetchContext,
                remoteFetchInFlight: STATE.remoteFetchInFlight,
                remoteFetchStatus: STATE.remoteFetchStatus,
                remoteResponseUrl: STATE.remoteResponseUrl,
                remoteResponseStatus: STATE.remoteResponseStatus,
                remotePayloadShape: STATE.remotePayloadShape,
                remotePayloadPath: STATE.remotePayloadPath,
                chatGptPathIdentityMappings: STATE.chatGptPathIndexByIdentity.size,
                claudeConversationId: getClaudeConversationId(),
                claudeCatalogMessages: STATE.claudeCatalogMessages.length,
                claudeCatalogContext: STATE.claudeCatalogContext,
                claudeCatalogSource: STATE.claudeCatalogSource,
                claudeRemoteMessages: STATE.claudeRemoteMessages.length,
                claudeRemoteContext: STATE.claudeRemoteContext,
                claudeRemoteSource: STATE.claudeRemoteSource,
                claudeRemoteStatus: STATE.claudeRemoteStatus,
                claudeLastConversationUrl: STATE.claudeLastConversationUrl,
                claudeObservedUrls: STATE.claudeObservedUrls.slice(),
                claudeHydrateUrl: STATE.claudeHydrateUrl,
                claudeResourceObserverInstalled: !!STATE.claudeResourceObserver,
                claudeInterceptorInstalled: STATE.claudeConversationInterceptorInstalled,
                claudeDirectDomMessages: STATE.claudeDirectDomMessages,
                claudeDocumentUserMessages: STATE.claudeDocumentUserMessages,
                claudeDirectDomSamples: STATE.claudeDirectDomSamples.slice(),
                claudeDirectScrollContainer: STATE.claudeDirectScrollContainer,
                claudeDirectScrollStats: STATE.claudeDirectScrollStats,
                tocSource: STATE.lastTocSource,
                interceptorInstalled: STATE.conversationInterceptorInstalled,
                exactTextOrderAnchors: STATE.messages.filter((message) => message.anchorSource === 'exact-text-order').length,
                containedTextOrderAnchors: STATE.messages.filter((message) => message.anchorSource === 'contained-text-order').length,
                textOrderAnchors: STATE.messages.filter((message) => /text-order$/.test(message.anchorSource || '')).length,
                currentTextAlignmentMatches: alignmentMatches.map((match) => ({
                    liveIndex: match.liveIndex,
                    remoteIndex: match.remoteIndex,
                    source: match.source,
                    liveText: match.liveText.slice(0, 80)
                })),
                slotSummary: getChatGptMessageSlotSummary(),
                alignmentPreview: getTextAlignmentPreview(),
                adapterSamples,
                liveSamples,
                remoteSamples,
                nativeTocSamples,
                duplicateTextGroups,
                lastTocClick: STATE.lastTocClick,
                lastNavigationDebug: STATE.lastNavigationDebug,
                lastActiveDebug: STATE.lastActiveDebug
            };
        };
        window.__aiTocDebug = debugFn;
        window.__aiTocVersion = '2.8.7';
        pageWindow.__aiTocDebug = debugFn;
        pageWindow.__aiTocVersion = '2.8.7';
    }

    function collectMessagesFromAdapter(adapter) {
        if (adapter.beforeCollect) adapter.beforeCollect();

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
            currentGroup = {
                container,
                anchor: line,
                text,
                identityKey: getMessageIdentityKeyFromElement(line),
                identityKeys: createMessageIdentityKeys(getMessageIdentityKeyFromElement(line))
            };
        });

        if (currentGroup) messages.push(currentGroup);

        const usedContainers = new Set(messages.map((message) => message.container));
        const knownSignatures = new Set(messages.map((message) => getContainerSignature(message.container)).filter(Boolean));
        const extraMessages = adapter.collectExtraMessages(knownSignatures, usedContainers, isPanelMutation) || [];

        if (extraMessages.length) {
            messages.push(...extraMessages);
            messages.sort(compareMessageOrder);
        }

        if (adapter.mergeMessages) {
            return adapter.mergeMessages(messages);
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
            const targets = [
                getMessageTarget(messages[0]),
                getMessageTarget(messages[(messages.length - 1) >> 1]),
                getMessageTarget(messages[messages.length - 1])
            ].filter(Boolean);
            if (targets.length) return targets;
        }

        const fallback = document.querySelector(selector);
        return fallback ? [fallback] : [];
    }

    const CLAUDE_USER_SELECTOR = [
        '[data-testid="user-message"]',
        '[data-testid^="user-message"]',
        '.font-user-message',
        '[class*="font-user-message"]'
    ].join(', ');

    function getClaudeMessageTextElement(container) {
        if (!container || !container.querySelector) return container;
        return container.querySelector('.font-user-message, [class*="font-user-message"]') || container;
    }

    function isClaudeScrollableContainer(element) {
        if (!element) return false;
        const overflowY = window.getComputedStyle(element).overflowY;
        const allowsScroll = overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay' ||
            element.getAttribute('data-autoscroll-container') === 'true';
        return allowsScroll && element.scrollHeight > element.clientHeight + 4;
    }

    function findClaudeScrollContainer() {
        const candidates = Array.from(document.querySelectorAll('.font-claude-response, [data-testid="user-message"]'));
        let current = candidates.find((element) => !element.closest('#ai-toc-v2_2')) || null;
        while (current && current !== document.body) {
            if (isClaudeScrollableContainer(current)) return current;
            current = current.parentElement;
        }

        const fallbacks = [
            '[data-autoscroll-container="true"]',
            '#main-content .overflow-y-scroll',
            '#root .overflow-y-auto.overflow-x-hidden'
        ];
        for (let i = 0; i < fallbacks.length; i++) {
            const element = document.querySelector(fallbacks[i]);
            if (isClaudeScrollableContainer(element)) return element;
        }
        return null;
    }

    function getClaudeReferenceScrollContainer() {
        const internal = findClaudeScrollContainer();
        const pageScroller = document.scrollingElement;
        const internalRange = internal ? internal.scrollHeight - internal.clientHeight : -1;
        const pageRange = pageScroller ? pageScroller.scrollHeight - pageScroller.clientHeight : -1;
        if (
            internal &&
            pageScroller &&
            pageRange > internalRange + 100 &&
            pageScroller.scrollHeight > pageScroller.clientHeight + 4
        ) {
            return pageScroller;
        }
        if (internal) return internal;
        if (pageScroller && pageScroller.scrollHeight > pageScroller.clientHeight + 4) return pageScroller;
        return null;
    }

    function describeClaudeScrollContainer(element) {
        if (!element) return '';
        const id = element.id ? `#${element.id}` : '';
        const classes = typeof element.className === 'string'
            ? element.className.trim().split(/\s+/).slice(0, 5).join('.')
            : '';
        return `${element.tagName || ''}${id}${classes ? `.${classes}` : ''}`;
    }

    function collectClaudeDirectDomMessages() {
        const internal = findClaudeScrollContainer();
        const root = getClaudeReferenceScrollContainer() || document;
        const elements = Array.from(root.querySelectorAll('[data-testid="user-message"]'))
            .filter((element) => !isClaudeComposerElement(element) && !element.closest('#ai-toc-v2_2'));
        const messages = elements.reduce((result, element, observedIndex) => {
            const text = normalizeMessageText(element);
            if (!text) return result;
            const messageId = element.getAttribute('data-message-id') ||
                element.getAttribute('data-message-uuid') || '';
            const identityKeys = createMessageIdentityKeys(messageId);
            result.push({
                container: element,
                anchor: element,
                text,
                identityKey: identityKeys[0] || '',
                identityKeys,
                observedIndex,
                source: 'claude-direct-dom'
            });
            return result;
        }, []);

        STATE.claudeDirectDomMessages = messages.length;
        STATE.claudeDocumentUserMessages = document.querySelectorAll('[data-testid="user-message"]').length;
        STATE.claudeDirectDomSamples = messages.slice(0, 12).map((message, index) => ({
            index,
            text: message.text.slice(0, 120),
            identityKeys: getMessageIdentityKeys(message)
        }));
        STATE.claudeDirectScrollContainer = describeClaudeScrollContainer(root === document ? null : root);
        STATE.claudeDirectScrollStats = {
            selected: root === document ? 'document' : describeClaudeScrollContainer(root),
            selectedScrollTop: root === document ? 0 : Math.round(root.scrollTop || 0),
            selectedScrollHeight: root === document ? 0 : Math.round(root.scrollHeight || 0),
            selectedClientHeight: root === document ? 0 : Math.round(root.clientHeight || 0),
            internal: describeClaudeScrollContainer(internal),
            internalRange: internal ? Math.round(internal.scrollHeight - internal.clientHeight) : -1,
            pageRange: document.scrollingElement
                ? Math.round(document.scrollingElement.scrollHeight - document.scrollingElement.clientHeight)
                : -1
        };
        return messages;
    }

    function isClaudeComposerElement(element) {
        if (!element || !element.closest) return false;
        return !!element.closest('textarea, [contenteditable="true"], form, [data-testid*="composer"], [data-testid*="input"]');
    }

    function resolveClaudeMessageContainer(line) {
        if (!line) return null;

        const direct = line.closest('[data-testid="user-message"], [data-testid^="user-message"]');
        if (direct) return direct;

        const fontMessage = line.closest('.font-user-message, [class*="font-user-message"]');
        if (fontMessage) return fontMessage;

        return resolveGroupedMessageContainer(line, CLAUDE_USER_SELECTOR);
    }

    function getClaudeConversationIdFromText(text) {
        if (!text) return '';
        const patterns = [
            /\/chat\/([a-f0-9-]{20,})/i,
            /\/api\/(?:organizations\/[^/]+\/)?chat_conversations\/([a-f0-9-]{20,})/i,
            /\/api\/[^?#]*\/conversations\/([a-f0-9-]{20,})/i,
            /[?&](?:conversation_id|conversation_uuid|chat_conversation_id)=([a-f0-9-]{20,})/i
        ];
        for (let i = 0; i < patterns.length; i++) {
            const match = String(text).match(patterns[i]);
            if (match && match[1]) return match[1];
        }
        return '';
    }

    function getClaudeConversationId() {
        if (!window.location.hostname.includes('claude.ai')) return '';
        return getClaudeConversationIdFromText(window.location.href);
    }

    function getClaudeMessageContext() {
        const conversationId = getClaudeConversationId();
        return conversationId
            ? `claude:${conversationId}`
            : `${window.location.hostname}${window.location.pathname}${window.location.search}`;
    }

    function getClaudeMessageRole(message) {
        if (!message || typeof message !== 'object') return '';
        const sender = message.sender;
        if (typeof sender === 'string') return sender.toLowerCase();
        if (sender && typeof sender === 'object') {
            const senderRole = sender.role || sender.type || sender.name;
            if (senderRole) return String(senderRole).toLowerCase();
        }
        return String(message.role || message.author_role || message.authorRole || '').toLowerCase();
    }

    function flattenClaudeMessageContent(value) {
        if (typeof value === 'string') return value;
        if (!value) return '';
        if (Array.isArray(value)) {
            return value.map(flattenClaudeMessageContent).filter(Boolean).join(' ');
        }
        if (typeof value !== 'object') return '';
        if (typeof value.text === 'string') return value.text;
        if (typeof value.value === 'string' && /text/i.test(String(value.type || ''))) return value.value;
        if (Array.isArray(value.content)) return flattenClaudeMessageContent(value.content);
        if (Array.isArray(value.parts)) return flattenClaudeMessageContent(value.parts);
        if (/image/i.test(String(value.type || value.content_type || ''))) return '[image]';
        return '';
    }

    function getClaudeConversationMessageText(message) {
        if (!message || typeof message !== 'object') return '';
        if (typeof message.text === 'string' && message.text.trim()) return normalizePlainText(message.text);
        if (typeof message.prompt === 'string' && message.prompt.trim()) return normalizePlainText(message.prompt);
        return normalizePlainText(flattenClaudeMessageContent(message.content || message.parts));
    }

    function findClaudeConversationMessageArray(data) {
        const candidates = [];
        const seen = new WeakSet();

        function visit(value, depth, key) {
            if (!value || typeof value !== 'object' || depth > 5) return;
            if (seen.has(value)) return;
            seen.add(value);

            if (Array.isArray(value)) {
                const roleCount = value.reduce((count, item) => {
                    const role = getClaudeMessageRole(item);
                    return count + (/^(human|user|assistant|claude)$/.test(role) ? 1 : 0);
                }, 0);
                if (value.length && roleCount) {
                    const keyBonus = /chat_messages|messages/i.test(key || '') ? 1000 : 0;
                    candidates.push({ value, score: keyBonus + roleCount * 10 + value.length });
                }
                value.forEach((item) => visit(item, depth + 1, key));
                return;
            }

            Object.keys(value).forEach((childKey) => {
                visit(value[childKey], depth + 1, childKey);
            });
        }

        visit(data, 0, 'root');
        candidates.sort((a, b) => b.score - a.score);
        return candidates.length ? candidates[0].value : [];
    }

    function extractClaudeUserMessages(data) {
        const messages = findClaudeConversationMessageArray(data);
        return messages.reduce((result, message, messageIndex) => {
            const role = getClaudeMessageRole(message);
            if (role !== 'human' && role !== 'user') return result;
            if (message.deleted_at || message.is_deleted || message.hidden === true) return result;

            const text = getClaudeConversationMessageText(message);
            if (!text) return result;
            const messageId = message.uuid || message.id || message.message_uuid || message.messageId || '';
            const identityKeys = createMessageIdentityKeys(messageId);
            result.push({
                container: null,
                anchor: null,
                text,
                identityKey: identityKeys[0] || '',
                identityKeys,
                remoteIndex: result.length,
                source: 'claude-conversation',
                observedIndex: messageIndex
            });
            return result;
        }, []);
    }

    function applyClaudeConversationData(data, source, contextOverride) {
        const messages = extractClaudeUserMessages(data);
        if (!messages.length) {
            if (!STATE.claudeRemoteMessages.length) STATE.claudeRemoteStatus = `${source}:empty`;
            return false;
        }

        const context = contextOverride || getClaudeMessageContext();
        const currentContext = getClaudeMessageContext();
        if (context !== currentContext) {
            STATE.claudeRemoteStatus = `${source}:ignored-other-conversation`;
            return false;
        }
        STATE.claudeRemoteMessages = messages;
        STATE.claudeRemoteContext = context;
        STATE.claudeRemoteSource = source;
        STATE.claudeRemoteStatus = `${source}:ok:${messages.length}`;
        scheduleScan(0);
        return true;
    }

    function isClaudeConversationResponseUrl(url) {
        if (!url) return false;
        const value = String(url);
        if (/\/(?:completion|retry|feedback)(?:\/|\?|$)/i.test(value)) return false;
        if (/\/api\/(?:organizations\/[^/]+\/)?chat_conversations\/[a-f0-9-]{20,}(?:\/[^?#]*)?(?:[?#]|$)/i.test(value)) {
            return true;
        }
        return /\/api\/[^?#]*(?:chat_messages|messages|conversations)[^?#]*(?:\?|$)/i.test(value)
            && !!getClaudeConversationIdFromText(value);
    }

    function recordClaudeObservedUrl(url) {
        if (!url || !window.location.hostname.includes('claude.ai')) return;

        let parsed;
        try {
            parsed = new URL(String(url), window.location.href);
        } catch (error) {
            return;
        }
        if (parsed.origin !== window.location.origin || !parsed.pathname.startsWith('/api/')) return;

        const currentConversationId = getClaudeConversationId();
        const value = `${parsed.pathname}${parsed.search}`;
        const isConversationResource = /chat_conversations|conversation|chat_messages|messages/i.test(value);
        if (!isConversationResource && (!currentConversationId || !value.includes(currentConversationId))) return;

        const absoluteUrl = parsed.href;
        const existingIndex = STATE.claudeObservedUrls.indexOf(absoluteUrl);
        if (existingIndex >= 0) STATE.claudeObservedUrls.splice(existingIndex, 1);
        STATE.claudeObservedUrls.push(absoluteUrl);
        if (STATE.claudeObservedUrls.length > 30) STATE.claudeObservedUrls.splice(0, STATE.claudeObservedUrls.length - 30);
        if (/chat_conversations/i.test(value)) STATE.claudeLastConversationUrl = absoluteUrl;
    }

    function findClaudeObservedConversationUrl() {
        const performanceApi = window.performance;
        if (performanceApi && typeof performanceApi.getEntriesByType === 'function') {
            performanceApi.getEntriesByType('resource').forEach((entry) => {
                recordClaudeObservedUrl(entry && entry.name);
            });
        }

        const conversationId = getClaudeConversationId();
        if (!conversationId) return '';
        for (let i = STATE.claudeObservedUrls.length - 1; i >= 0; i--) {
            const url = STATE.claudeObservedUrls[i];
            if (getClaudeConversationIdFromText(url) === conversationId && isClaudeConversationResponseUrl(url)) {
                return url;
            }
        }
        return '';
    }

    function hydrateClaudeConversationFromObservedResource() {
        if (!window.location.hostname.includes('claude.ai')) return;
        const context = getClaudeMessageContext();
        if (STATE.claudeRemoteContext === context && STATE.claudeRemoteMessages.length) return;

        const url = findClaudeObservedConversationUrl();
        if (!url || STATE.claudeHydrateUrl === url) return;
        STATE.claudeHydrateUrl = url;
        STATE.claudeRemoteStatus = 'observed-resource:loading';

        const pageWindow = getPageWindow();
        const fetchFn = pageWindow && typeof pageWindow.fetch === 'function'
            ? pageWindow.fetch.bind(pageWindow)
            : window.fetch.bind(window);
        fetchFn(url, {
            credentials: 'include',
            headers: { accept: 'application/json' }
        })
            .then((response) => {
                if (!response.ok) throw new Error(`http-${response.status}`);
                return response.json();
            })
            .then((data) => {
                applyClaudeConversationData(data, 'observed-resource', context);
            })
            .catch((error) => {
                STATE.claudeRemoteStatus = `observed-resource:${error && error.message ? error.message : 'read-error'}`;
            });
    }

    function installClaudeResourceObserver() {
        if (!window.location.hostname.includes('claude.ai')) return;
        if (STATE.claudeResourceObserver) return;

        const inspectResources = (entries) => {
            entries.forEach((entry) => recordClaudeObservedUrl(entry && entry.name));
            hydrateClaudeConversationFromObservedResource();
        };

        const performanceApi = window.performance;
        if (performanceApi && typeof performanceApi.getEntriesByType === 'function') {
            inspectResources(performanceApi.getEntriesByType('resource'));
        }

        const Observer = window.PerformanceObserver;
        if (typeof Observer !== 'function') return;
        try {
            STATE.claudeResourceObserver = new Observer((list) => {
                inspectResources(list.getEntries());
            });
            STATE.claudeResourceObserver.observe({ type: 'resource', buffered: true });
        } catch (error) {
            STATE.claudeResourceObserver = null;
        }
    }

    function readClaudeConversationResponse(response, requestedUrl, source) {
        const responseUrl = response && response.url ? response.url : requestedUrl;
        if (responseUrl && /chat_conversations/i.test(String(responseUrl))) {
            STATE.claudeLastConversationUrl = String(responseUrl);
        }
        if (!response || !isClaudeConversationResponseUrl(responseUrl)) return;
        const conversationId = getClaudeConversationIdFromText(responseUrl);
        const context = conversationId ? `claude:${conversationId}` : getClaudeMessageContext();
        response.clone().json()
            .then((data) => applyClaudeConversationData(data, source, context))
            .catch(() => {
                STATE.claudeRemoteStatus = `${source}:read-error`;
            });
    }

    function installClaudeConversationInterceptors() {
        if (!window.location.hostname.includes('claude.ai')) return;
        if (STATE.claudeConversationInterceptorInstalled) return;
        STATE.claudeConversationInterceptorInstalled = true;

        const pageWindow = getPageWindow();
        const originalFetch = pageWindow.fetch;
        if (typeof originalFetch === 'function') {
            pageWindow.fetch = function interceptedClaudeFetch() {
                const input = arguments[0];
                const requestedUrl = typeof input === 'string'
                    ? input
                    : input && input.url ? input.url : '';
                recordClaudeObservedUrl(requestedUrl);
                if (requestedUrl && /chat_conversations/i.test(String(requestedUrl))) {
                    STATE.claudeLastConversationUrl = String(requestedUrl);
                }
                const result = originalFetch.apply(this, arguments);
                Promise.resolve(result)
                    .then((response) => readClaudeConversationResponse(response, requestedUrl, 'page-fetch'))
                    .catch(() => {});
                return result;
            };
        }

        const OriginalXHR = pageWindow.XMLHttpRequest;
        if (typeof OriginalXHR === 'function' && OriginalXHR.prototype && !OriginalXHR.prototype.__aiTocClaudeConversationPatched) {
            const xhrProto = OriginalXHR.prototype;
            const originalOpen = xhrProto.open;
            const originalSend = xhrProto.send;
            xhrProto.open = function interceptedClaudeOpen(method, url) {
                this.__aiTocClaudeConversationUrl = typeof url === 'string' ? url : String(url || '');
                recordClaudeObservedUrl(this.__aiTocClaudeConversationUrl);
                return originalOpen.apply(this, arguments);
            };
            xhrProto.send = function interceptedClaudeSend() {
                if (!this.__aiTocClaudeConversationListener) {
                    this.__aiTocClaudeConversationListener = true;
                    this.addEventListener('load', () => {
                        const requestUrl = this.__aiTocClaudeConversationUrl || '';
                        if (requestUrl && /chat_conversations/i.test(requestUrl)) {
                            STATE.claudeLastConversationUrl = requestUrl;
                        }
                        if (!isClaudeConversationResponseUrl(requestUrl)) return;
                        try {
                            const data = JSON.parse(this.responseText);
                            const conversationId = getClaudeConversationIdFromText(requestUrl);
                            const context = conversationId ? `claude:${conversationId}` : getClaudeMessageContext();
                            applyClaudeConversationData(data, 'page-xhr', context);
                        } catch (error) {
                            STATE.claudeRemoteStatus = 'page-xhr:read-error';
                        }
                    });
                }
                return originalSend.apply(this, arguments);
            };
            xhrProto.__aiTocClaudeConversationPatched = true;
        }
    }

    function replaceClaudeCatalog(messages, context, source) {
        STATE.claudeCatalogMessages = snapshotChatGptCatalogMessages(messages);
        STATE.claudeCatalogContext = context;
        STATE.claudeCatalogSource = source;
    }

    function areClaudeCatalogMessagesEqual(left, right) {
        if (!left || !right) return false;
        const leftKeys = getMessageIdentityKeys(left);
        const rightKeys = getMessageIdentityKeys(right);
        if (leftKeys.length && rightKeys.length && leftKeys.some((key) => rightKeys.includes(key))) return true;
        const leftText = getComparableMessageText(left.text);
        const rightText = getComparableMessageText(right.text);
        return !!leftText && leftText === rightText;
    }

    function findClaudeMessageSequence(haystack, needle) {
        if (!needle.length || needle.length > haystack.length) return -1;
        for (let start = 0; start <= haystack.length - needle.length; start++) {
            let matches = true;
            for (let index = 0; index < needle.length; index++) {
                if (!areClaudeCatalogMessagesEqual(haystack[start + index], needle[index])) {
                    matches = false;
                    break;
                }
            }
            if (matches) return start;
        }
        return -1;
    }

    function getClaudeSequenceOverlap(left, right) {
        const maxOverlap = Math.min(left.length, right.length);
        for (let length = maxOverlap; length > 0; length--) {
            let matches = true;
            for (let index = 0; index < length; index++) {
                if (!areClaudeCatalogMessagesEqual(left[left.length - length + index], right[index])) {
                    matches = false;
                    break;
                }
            }
            if (matches) return length;
        }
        return 0;
    }

    function updateClaudeCatalogAnchors(catalog, batch, startIndex) {
        const updated = catalog.map((message, index) => snapshotChatGptCatalogMessage(message, index));
        batch.forEach((message, batchIndex) => {
            const catalogIndex = startIndex + batchIndex;
            if (catalogIndex < 0 || catalogIndex >= updated.length) return;
            const snapshot = snapshotChatGptCatalogMessage(message, catalogIndex);
            snapshot.remoteIndex = catalogIndex;
            updated[catalogIndex] = snapshot;
        });
        return updated;
    }

    function mergeClaudeDirectDomCatalog(directMessages, context) {
        if (!directMessages.length) return;
        if (STATE.claudeCatalogContext !== context || !STATE.claudeCatalogMessages.length) {
            replaceClaudeCatalog(directMessages, context, 'claude-direct-dom');
            return;
        }

        const catalog = STATE.claudeCatalogMessages;
        const batch = snapshotChatGptCatalogMessages(directMessages);
        const batchInCatalog = findClaudeMessageSequence(catalog, batch);
        if (batchInCatalog >= 0) {
            STATE.claudeCatalogMessages = updateClaudeCatalogAnchors(catalog, batch, batchInCatalog);
            STATE.claudeCatalogSource = 'claude-direct-dom-retained';
            return;
        }

        const catalogInBatch = findClaudeMessageSequence(batch, catalog);
        if (catalogInBatch >= 0) {
            replaceClaudeCatalog(batch, context, 'claude-direct-dom-expanded');
            return;
        }

        const appendOverlap = getClaudeSequenceOverlap(catalog, batch);
        if (appendOverlap > 0) {
            replaceClaudeCatalog(
                [...catalog, ...batch.slice(appendOverlap)],
                context,
                'claude-direct-dom-appended'
            );
            return;
        }

        const prependOverlap = getClaudeSequenceOverlap(batch, catalog);
        if (prependOverlap > 0) {
            replaceClaudeCatalog(
                [...batch.slice(0, batch.length - prependOverlap), ...catalog],
                context,
                'claude-direct-dom-prepended'
            );
            return;
        }

        STATE.claudeCatalogSource = 'claude-direct-dom-retained-no-overlap';
    }

    function bindLiveMessagesToClaudeCatalog(catalogMessages, liveMessages) {
        const liveByIdentity = new Map();
        const liveByText = new Map();
        const catalogTextCounts = new Map();
        const usedLiveMessages = new Set();

        catalogMessages.forEach((message) => {
            const comparable = getComparableMessageText(message.text);
            if (comparable) catalogTextCounts.set(comparable, (catalogTextCounts.get(comparable) || 0) + 1);
        });
        liveMessages.forEach((message) => {
            getMessageIdentityKeys(message).forEach((key) => {
                if (!liveByIdentity.has(key)) liveByIdentity.set(key, message);
            });
            const comparable = getComparableMessageText(message.text);
            if (comparable) {
                const group = liveByText.get(comparable) || [];
                group.push(message);
                liveByText.set(comparable, group);
            }
        });

        const rebound = catalogMessages.map((catalogMessage, index) => {
            const snapshot = snapshotChatGptCatalogMessage(catalogMessage, index);
            let liveMessage = null;
            const identityKeys = getMessageIdentityKeys(snapshot);
            for (let i = 0; i < identityKeys.length; i++) {
                const candidate = liveByIdentity.get(identityKeys[i]);
                if (candidate && !usedLiveMessages.has(candidate)) {
                    liveMessage = candidate;
                    break;
                }
            }

            if (!liveMessage) {
                const comparable = getComparableMessageText(snapshot.text);
                const candidates = comparable ? liveByText.get(comparable) || [] : [];
                if (catalogTextCounts.get(comparable) === 1 && candidates.length === 1) {
                    liveMessage = candidates[0];
                }
            }
            if (!liveMessage || usedLiveMessages.has(liveMessage)) return snapshot;
            usedLiveMessages.add(liveMessage);
            snapshot.anchor = liveMessage.anchor && liveMessage.anchor.isConnected ? liveMessage.anchor : null;
            snapshot.container = liveMessage.container && liveMessage.container.isConnected ? liveMessage.container : null;
            snapshot.identityKeys = createMessageIdentityKeys.apply(
                null,
                getMessageIdentityKeys(snapshot).concat(getMessageIdentityKeys(liveMessage))
            );
            snapshot.identityKey = snapshot.identityKeys[0] || '';
            snapshot.anchorSource = 'claude-live-anchor';
            return snapshot;
        });
        STATE.claudeCatalogMessages = snapshotChatGptCatalogMessages(rebound);
        return rebound;
    }

    const SITE_ADAPTERS = {
        chatgpt: {
            id: 'chatgpt',
            title: 'ChatGPT 索引',
            label: 'GPT',
            selector: '[data-message-author-role="user"]',
            matches() {
                return window.location.hostname.includes('chatgpt.com');
            },
            beforeCollect() {
                const context = getChatGptMessageCacheContext();
                if (STATE.chatGptCatalogContext && STATE.chatGptCatalogContext !== context) {
                    STATE.chatGptCatalogMessages = [];
                    STATE.chatGptCatalogContext = '';
                    STATE.chatGptCatalogSource = '';
                    STATE.chatGptPathIndexByIdentity = new Map();
                }
            },
            resolveMessageContainer(line) {
                return line.closest('[data-message-author-role]') || resolveGroupedMessageContainer(line, this.selector);
            },
            getMessageLabel(line, container) {
                const text = extractChatGptUserQueryText(line);
                return text || extractImageLabel(container);
            },
            getScrollReferenceTargets(messages) {
                return getDefaultScrollReferenceTargets(messages, this.selector);
            },
            collectExtraMessages() {
                return [];
            },
            mergeMessages(liveMessages) {
                const context = getChatGptMessageCacheContext();
                annotateMessagesWithNativeToc(liveMessages);
                const nativeTocMessages = collectChatGptNativeTocMessages();
                if (nativeTocMessages.length) {
                    replaceChatGptCatalog(nativeTocMessages, context, 'native-prompt-toc');
                    STATE.lastTocSource = 'native-prompt-toc';
                    return bindLiveMessagesToChatGptCatalog(STATE.chatGptCatalogMessages, liveMessages);
                }

                if (
                    STATE.remoteMessageContext === context &&
                    STATE.remoteMessageIsAuthoritative &&
                    STATE.remoteMessages.length
                ) {
                    replaceChatGptCatalog(STATE.remoteMessages, context, `${STATE.remoteMessageSource}-current-branch`);
                    STATE.lastTocSource = STATE.chatGptCatalogSource;
                    return bindLiveMessagesToChatGptCatalog(STATE.chatGptCatalogMessages, liveMessages);
                }

                if (STATE.chatGptCatalogContext === context && STATE.chatGptCatalogMessages.length) {
                    STATE.lastTocSource = `${STATE.chatGptCatalogSource}+retained`;
                    if (STATE.chatGptCatalogSource === 'live-turn-cache') {
                        return mergeLiveMessagesIntoChatGptCatalog(liveMessages, context);
                    }
                    return bindLiveMessagesToChatGptCatalog(STATE.chatGptCatalogMessages, liveMessages);
                }

                STATE.lastTocSource = 'live-turn-cache';
                return mergeLiveMessagesIntoChatGptCatalog(liveMessages, context);
            }
        },
        gemini: {
            id: 'gemini',
            title: 'Gemini 索引',
            label: 'Gem',
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
        },
        claude: {
            id: 'claude',
            title: 'Claude 索引',
            label: 'Cl',
            selector: CLAUDE_USER_SELECTOR,
            matches() {
                return window.location.hostname.includes('claude.ai');
            },
            beforeCollect() {
                const context = getClaudeMessageContext();
                if (STATE.claudeCatalogContext && STATE.claudeCatalogContext !== context) {
                    STATE.claudeCatalogMessages = [];
                    STATE.claudeCatalogContext = '';
                    STATE.claudeCatalogSource = '';
                    STATE.claudeObservedUrls = [];
                    STATE.claudeHydrateUrl = '';
                }
                if (STATE.claudeRemoteContext && STATE.claudeRemoteContext !== context) {
                    STATE.claudeRemoteMessages = [];
                    STATE.claudeRemoteContext = '';
                    STATE.claudeRemoteSource = '';
                    STATE.claudeRemoteStatus = '';
                }
                hydrateClaudeConversationFromObservedResource();
            },
            resolveMessageContainer(line) {
                return resolveClaudeMessageContainer(line);
            },
            getMessageLabel(line, container) {
                if (isClaudeComposerElement(line) || isClaudeComposerElement(container)) return '';

                const textElement = getClaudeMessageTextElement(container || line);
                const text = normalizeMessageText(textElement);
                return text || extractImageLabel(container || line);
            },
            getScrollReferenceTargets(messages) {
                const directMessages = collectClaudeDirectDomMessages();
                return getDefaultScrollReferenceTargets(directMessages.length ? directMessages : messages, '[data-testid="user-message"]');
            },
            collectExtraMessages() {
                return [];
            },
            mergeMessages(liveMessages) {
                const context = getClaudeMessageContext();
                const directMessages = collectClaudeDirectDomMessages();
                if (
                    STATE.messageListContext === context &&
                    STATE.messages.length > STATE.claudeCatalogMessages.length
                ) {
                    replaceClaudeCatalog(STATE.messages, context, 'claude-rendered-catalog-retained');
                }
                mergeClaudeDirectDomCatalog(directMessages, context);

                if (
                    STATE.claudeRemoteContext === context &&
                    STATE.claudeRemoteMessages.length > STATE.claudeCatalogMessages.length
                ) {
                    replaceClaudeCatalog(STATE.claudeRemoteMessages, context, `${STATE.claudeRemoteSource}-conversation`);
                }
                if (STATE.claudeCatalogContext === context && STATE.claudeCatalogMessages.length) {
                    STATE.lastTocSource = STATE.claudeCatalogSource;
                    return bindLiveMessagesToClaudeCatalog(
                        STATE.claudeCatalogMessages,
                        directMessages.length ? directMessages : liveMessages
                    );
                }
                STATE.lastTocSource = 'claude-live-dom-fallback';
                return directMessages.length ? directMessages : liveMessages;
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
                width: ${CONFIG.panelWidth}px;
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
                transition:
                    opacity 0.3s,
                    left 0.22s ease,
                    top 0.22s ease,
                    width 0.22s ease,
                    height 0.22s ease,
                    max-height 0.22s ease,
                    border-radius 0.22s ease,
                    transform 0.26s ease;
                contain: content;
            }
            #ai-toc-v2_2.toc-visible { opacity: 1; }
            #ai-toc-v2_2.notranslate { translate: no; }
            #ai-toc-v2_2.toc-dragging {
                transition: none !important;
                cursor: grabbing;
            }
            #ai-toc-v2_2.toc-slide-opening {
                transition: transform 0.26s ease, opacity 0.18s ease;
                transform: translateX(var(--toc-slide-x, 0));
            }
            #ai-toc-v2_2.toc-slide-opening.toc-slide-open {
                transform: translateX(0);
            }
            #ai-toc-v2_2.toc-collapsed {
                width: 48px;
                height: 48px;
                max-height: 48px;
                border-radius: 999px;
                cursor: grab;
            }
            #ai-toc-v2_2.toc-collapsed .toc-header {
                padding: 0;
                height: 100%;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            #ai-toc-v2_2.toc-collapsed .toc-title,
            #ai-toc-v2_2.toc-collapsed .toc-actions .toc-btn:not(.toc-collapse-btn),
            #ai-toc-v2_2.toc-collapsed .toc-search,
            #ai-toc-v2_2.toc-collapsed #toc-list {
                display: none;
            }
            #ai-toc-v2_2.toc-collapsed .toc-row {
                align-items: center;
                justify-content: center;
                margin-bottom: 0;
                width: 100%;
                height: 100%;
            }
            .toc-header { padding: 16px 16px 8px 16px; background: #1e1f20; flex-shrink: 0; }
            .toc-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
            .toc-title { font-weight: 500; font-size: 14px; color: #e3e3e3; padding-left: 4px; }
            .toc-actions { display: flex; gap: 4px; }
            #ai-toc-v2_2.toc-collapsed .toc-actions {
                width: 100%;
                height: 100%;
                align-items: center;
                justify-content: center;
                gap: 0;
            }
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
            .toc-btn svg { display: block; }
            .toc-bubble-label {
                display: block;
                font-size: 12px;
                font-weight: 600;
                line-height: 1;
                letter-spacing: 0;
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
            .toc-clear-btn {
                position: absolute;
                right: 6px;
                top: 50%;
                transform: translateY(-50%);
                display: none;
            }
            .toc-search.has-value .toc-clear-btn {
                display: flex;
            }
            .toc-search.has-value input {
                padding-right: 40px;
            }
            #toc-list {
                list-style: none;
                padding: 0;
                margin: 0;
                flex-grow: 1;
                overflow-y: scroll;
                max-height: ${maxH}px;
                padding-bottom: 8px;
                scrollbar-gutter: stable;
                scrollbar-width: thin;
                scrollbar-color: #444746 transparent;
            }
            #toc-list::-webkit-scrollbar {
                width: 8px;
                display: block;
            }
            #toc-list::-webkit-scrollbar-track {
                background: transparent;
            }
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

    function scrollTargetToInstant(target, top) {
        const nextTop = Math.max(0, Math.min(typeof top === 'number' ? top : 0, getScrollMaxTop(target)));
        if (isWindowScrollTarget(target)) {
            window.scrollTo(0, nextTop);
            const pageScroller = getPageScroller();
            if (pageScroller) pageScroller.scrollTop = nextTop;
            return;
        }

        target.scrollTop = nextTop;
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

    function clampNumber(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    function readStorageValue(key) {
        try {
            return window.localStorage.getItem(key);
        } catch (error) {
            return null;
        }
    }

    function writeStorageValue(key, value) {
        try {
            window.localStorage.setItem(key, value);
        } catch (error) {
            // Storage can be blocked in privacy modes; the panel should still work.
        }
    }

    function readStoredPosition(key) {
        const raw = readStorageValue(key);
        if (!raw) return null;

        try {
            const parsed = JSON.parse(raw);
            if (typeof parsed.left !== 'number' || typeof parsed.top !== 'number') return null;
            return parsed;
        } catch (error) {
            return null;
        }
    }

    function readStoredExpandedPosition() {
        return readStoredPosition(STORAGE_KEYS.expandedPosition) || readStoredPosition(STORAGE_KEYS.panelPosition);
    }

    function readStoredBubblePosition() {
        const raw = readStorageValue(STORAGE_KEYS.bubblePosition);
        if (!raw) return null;

        try {
            const parsed = JSON.parse(raw);
            if (parsed.side !== 'left' && parsed.side !== 'right') return null;
            if (typeof parsed.top !== 'number') return null;
            return parsed;
        } catch (error) {
            return null;
        }
    }

    function getConstrainedPanelPosition(panel, left, top, size) {
        const rect = panel.getBoundingClientRect();
        const margin = CONFIG.panelMargin;
        const width = size && typeof size.width === 'number' ? size.width : (rect.width || panel.offsetWidth || CONFIG.bubbleSize);
        const height = size && typeof size.height === 'number' ? size.height : (rect.height || panel.offsetHeight || CONFIG.bubbleSize);
        const maxLeft = Math.max(margin, window.innerWidth - width - margin);
        const maxTop = Math.max(margin, window.innerHeight - height - margin);

        return {
            left: clampNumber(left, margin, maxLeft),
            top: clampNumber(top, margin, maxTop)
        };
    }

    function getPositionSide(position) {
        if (!position) return null;
        return position.left + CONFIG.panelWidth / 2 < window.innerWidth / 2 ? 'left' : 'right';
    }

    function getExpandedPositionFromBubble(panel, side) {
        const rect = panel.getBoundingClientRect();
        const left = side === 'left'
            ? CONFIG.panelMargin
            : window.innerWidth - CONFIG.panelWidth - CONFIG.panelMargin;
        return getConstrainedPanelPosition(panel, left, rect.top, { width: CONFIG.panelWidth, height: rect.height || CONFIG.bubbleSize });
    }

    function resolveExpandedPositionForBubble(panel, side, storedPosition) {
        if (storedPosition && getPositionSide(storedPosition) === side) {
            return storedPosition;
        }
        return getExpandedPositionFromBubble(panel, side);
    }

    function applyPanelPosition(panel, position) {
        const next = getConstrainedPanelPosition(panel, position.left, position.top);
        panel.style.left = `${next.left}px`;
        panel.style.top = `${next.top}px`;
        panel.style.right = 'auto';
        return next;
    }

    function getNearestBubbleSide(panel) {
        const rect = panel.getBoundingClientRect();
        return rect.left + rect.width / 2 < window.innerWidth / 2 ? 'left' : 'right';
    }

    function getConstrainedBubblePosition(panel, position) {
        const margin = CONFIG.panelMargin;
        const height = CONFIG.bubbleSize;
        return {
            side: position.side === 'left' ? 'left' : 'right',
            top: clampNumber(position.top, margin, Math.max(margin, window.innerHeight - height - margin))
        };
    }

    function applyBubblePosition(panel, position) {
        const next = getConstrainedBubblePosition(panel, position);
        const width = CONFIG.bubbleSize;
        panel.dataset.side = next.side;
        panel.style.left = next.side === 'left'
            ? `${CONFIG.panelMargin}px`
            : `${Math.max(CONFIG.panelMargin, window.innerWidth - width - CONFIG.panelMargin)}px`;
        panel.style.top = `${next.top}px`;
        panel.style.right = 'auto';
        return next;
    }

    function getBubblePositionFromCurrentPanel(panel) {
        const rect = panel.getBoundingClientRect();
        return {
            side: getNearestBubbleSide(panel),
            top: rect.top
        };
    }

    function saveExpandedPanelPosition(panel) {
        if (!panel) return;
        const rect = panel.getBoundingClientRect();
        const position = applyPanelPosition(panel, { left: rect.left, top: rect.top });
        writeStorageValue(STORAGE_KEYS.expandedPosition, JSON.stringify(position));
    }

    function saveBubblePosition(panel) {
        if (!panel) return;
        const position = applyBubblePosition(panel, {
            side: panel.dataset.side || getNearestBubbleSide(panel),
            top: panel.getBoundingClientRect().top
        });
        writeStorageValue(STORAGE_KEYS.bubblePosition, JSON.stringify(position));
    }

    function saveCurrentPanelPosition(panel) {
        if (!panel) return;
        if (panel.classList.contains('toc-collapsed')) {
            saveBubblePosition(panel);
        } else {
            saveExpandedPanelPosition(panel);
        }
    }

    function constrainPanelToViewport(panel, persist) {
        if (!panel) return;
        if (panel.classList.contains('toc-collapsed')) {
            applyBubblePosition(panel, {
                side: panel.dataset.side || getNearestBubbleSide(panel),
                top: panel.getBoundingClientRect().top
            });
            if (persist) saveBubblePosition(panel);
            return;
        }

        const rect = panel.getBoundingClientRect();
        applyPanelPosition(panel, { left: rect.left, top: rect.top });
        if (persist) saveExpandedPanelPosition(panel);
    }

    function beginSlideExpand(panel, side) {
        panel.style.setProperty('--toc-slide-x', side === 'left' ? 'calc(-100% - 16px)' : 'calc(100% + 16px)');
        panel.classList.add('toc-slide-opening');
        panel.classList.remove('toc-slide-open');
    }

    function finishSlideExpand(panel) {
        window.requestAnimationFrame(() => {
            panel.classList.add('toc-slide-open');
        });

        window.setTimeout(() => {
            panel.classList.remove('toc-slide-opening', 'toc-slide-open');
            panel.style.removeProperty('--toc-slide-x');
        }, 300);
    }

    function setPanelCollapsed(panel, collapsed, persist) {
        if (!panel) return;
        const wasCollapsed = panel.classList.contains('toc-collapsed');
        const bubblePosition = persist === false
            ? (readStoredBubblePosition() || getBubblePositionFromCurrentPanel(panel))
            : getBubblePositionFromCurrentPanel(panel);
        const openingFromBubble = wasCollapsed && !collapsed;
        const openingSide = openingFromBubble ? (panel.dataset.side || getNearestBubbleSide(panel)) : null;
        const storedExpandedPosition = collapsed ? null : readStoredExpandedPosition();
        const expandedPosition = openingFromBubble
            ? resolveExpandedPositionForBubble(panel, openingSide, storedExpandedPosition)
            : storedExpandedPosition;

        if (collapsed && !wasCollapsed) {
            saveExpandedPanelPosition(panel);
        }

        if (openingFromBubble) {
            beginSlideExpand(panel, openingSide);
        }

        panel.classList.toggle('toc-collapsed', collapsed);

        const button = panel.querySelector('.toc-collapse-btn');
        if (button) {
            button.title = collapsed ? '\u5c55\u5f00\u9762\u677f' : '\u6298\u53e0\u9762\u677f';
            button.setAttribute('aria-label', button.title);
            button.setAttribute('aria-expanded', String(!collapsed));
            if (collapsed) {
                setButtonText(button, getBubbleLabel(), 'toc-bubble-label');
            } else {
                setButtonIcon(button, 'collapse');
            }
        }

        if (persist !== false) {
            writeStorageValue(STORAGE_KEYS.collapsed, collapsed ? '1' : '0');
        }

        if (collapsed) {
            const snapBubble = () => {
                const next = applyBubblePosition(panel, bubblePosition);
                if (persist !== false) writeStorageValue(STORAGE_KEYS.bubblePosition, JSON.stringify(next));
                clearAutoCollapseTimer();
            };
            window.requestAnimationFrame(snapBubble);
            window.setTimeout(snapBubble, 240);
            return;
        }

        if (expandedPosition) {
            applyPanelPosition(panel, expandedPosition);
        } else {
            constrainPanelToViewport(panel, false);
        }
        if (openingFromBubble) {
            finishSlideExpand(panel);
        }
        scheduleAutoCollapse();
    }

    function togglePanelCollapsed() {
        const panel = getPanelElement();
        if (!panel) return;
        setPanelCollapsed(panel, !panel.classList.contains('toc-collapsed'));
    }

    function restorePanelState(panel) {
        const collapsed = readStorageValue(STORAGE_KEYS.collapsed) === '1';
        setPanelCollapsed(panel, collapsed, false);
        if (!collapsed) scheduleAutoCollapse();
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

    function isRelevantChatGptNativeTocMutation(node) {
        if (ADAPTER.id !== 'chatgpt') return false;
        const element = getMutationElement(node);
        if (!element || isPanelMutation(element)) return false;
        if (element.matches && element.matches('button[aria-label^="Prompt "]')) return true;
        return !!(element.querySelector && element.querySelector('button[aria-label^="Prompt "]'));
    }

    function mutationAffectsMessages(mutation) {
        if (isRelevantMessageMutation(mutation.target) || isRelevantChatGptNativeTocMutation(mutation.target)) return true;

        for (const node of mutation.addedNodes) {
            if (isRelevantMessageMutation(node) || isRelevantChatGptNativeTocMutation(node)) return true;
        }

        for (const node of mutation.removedNodes) {
            if (isRelevantMessageMutation(node) || isRelevantChatGptNativeTocMutation(node)) return true;
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

    function getExactUserElementScrollTop(target, container) {
        if (!target || !target.isConnected) return;
        const viewport = getViewportRect(container);
        const rect = target.getBoundingClientRect();
        const offset = Math.min(120, Math.max(72, viewport.height * 0.12));
        return Math.max(0, Math.min(getScrollTop(container) + rect.top - viewport.top - offset, getScrollMaxTop(container)));
    }

    function getExactUserViewportTop(container) {
        const viewport = getViewportRect(container);
        return viewport.top + Math.min(120, Math.max(72, viewport.height * 0.12));
    }

    function isExactUserTarget(target) {
        return !!(target && target.matches && target.matches(ADAPTER.selector));
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

    function clearVirtualSeekTimer() {
        if (STATE.virtualSeekTimer) {
            window.clearTimeout(STATE.virtualSeekTimer);
            STATE.virtualSeekTimer = 0;
        }
    }

    function scheduleJumpCorrection(target, remainingAttempts, index) {
        clearJumpSyncTimer();
        if (!target || !target.isConnected || remainingAttempts <= 0) return;

        STATE.jumpSyncTimer = window.setTimeout(() => {
            STATE.jumpSyncTimer = 0;
            const currentContainer = findScrollContainerForElement(target);
            if (STATE.scrollContainer !== currentContainer) bindScrollSync();

            const exactTop = isExactUserTarget(target)
                ? getExactUserElementScrollTop(target, currentContainer)
                : resolveTargetScrollTop(target, currentContainer, index);
            if (typeof exactTop !== 'number') return;

            const currentTop = getScrollTop(currentContainer);
            if (Math.abs(currentTop - exactTop) > 4) {
                scrollTargetTo(currentContainer, exactTop, 'auto');
            }

            if (STATE.lastNavigationDebug && typeof STATE.lastNavigationDebug === 'object') {
                const rect = target.getBoundingClientRect();
                STATE.lastNavigationDebug.targetViewportTop = Math.round(getExactUserViewportTop(currentContainer));
                STATE.lastNavigationDebug.finalRect = {
                    top: Math.round(rect.top),
                    bottom: Math.round(rect.bottom),
                    height: Math.round(rect.height)
                };
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

        scrollTargetTo(container, initialTop, 'auto');
        scheduleJumpCorrection(target, 4, index);
    }

    function findLiveUserElementByIdentityKeys(identityKeys) {
        if (!identityKeys || !identityKeys.length) return null;

        for (let i = 0; i < identityKeys.length; i++) {
            const messageId = getMessageIdFromIdentityKey(identityKeys[i]);
            if (!messageId) continue;

            const escapedId = escapeCssValue(messageId);
            const direct = document.querySelector([
                `[data-message-author-role="user"][data-message-id="${escapedId}"]`,
                `[data-testid^="user-message"][data-message-id="${escapedId}"]`,
                `[data-testid^="user-message"][data-message-uuid="${escapedId}"]`,
                `[data-message-id="${escapedId}"] [data-testid^="user-message"]`,
                `[data-message-uuid="${escapedId}"] [data-testid^="user-message"]`
            ].join(', '));
            if (direct && direct.isConnected) return direct;
        }

        const users = Array.from(document.querySelectorAll(ADAPTER.selector));
        for (let i = 0; i < users.length; i++) {
            const key = getMessageIdentityKeyFromElement(users[i]);
            if (identityKeys.includes(key)) return users[i];
        }

        return null;
    }

    function isExactTextAnchorForMessage(element, message) {
        if (!element || !message) return false;
        if (!element.matches || !element.matches('[data-message-author-role="user"]')) return false;
        return isComparableTextMatch(
            getComparableMessageText(message.text),
            getComparableMessageText(extractChatGptUserQueryText(element))
        );
    }

    function findLiveUserElementForMessage(message, index) {
        const identityMatch = findLiveUserElementByIdentityKeys(getMessageIdentityKeys(message));
        if (identityMatch) return { element: identityMatch, source: 'id' };

        if (ADAPTER.id === 'claude') {
            const comparable = getComparableMessageText(message.text);
            const catalogMatches = STATE.messages.filter((candidate) => (
                getComparableMessageText(candidate.text) === comparable
            ));
            const liveMatches = Array.from(document.querySelectorAll(ADAPTER.selector)).filter((element) => {
                if (isClaudeComposerElement(element)) return false;
                const container = ADAPTER.resolveMessageContainer(element);
                const textElement = getClaudeMessageTextElement(container || element);
                return getComparableMessageText(normalizeMessageText(textElement)) === comparable;
            });
            if (catalogMatches.length === 1 && liveMatches.length === 1) {
                return { element: liveMatches[0], source: 'unique-text' };
            }
            return null;
        }

        const slotMatch = findLiveUserElementInSlot(message, index);
        if (slotMatch) return slotMatch;

        return null;
    }

    function findClaudeDirectUserElement(message, index) {
        const root = getClaudeReferenceScrollContainer() || document;
        const elements = Array.from(root.querySelectorAll('[data-testid="user-message"]'))
            .filter((element) => !isClaudeComposerElement(element) && !element.closest('#ai-toc-v2_2'));
        const targetText = getComparableMessageText(message && message.text);
        const direct = elements[index];
        if (direct && getComparableMessageText(normalizeMessageText(direct)) === targetText) {
            return { element: direct, source: 'reference-index-text' };
        }

        const identityMatch = findLiveUserElementByIdentityKeys(getMessageIdentityKeys(message));
        if (identityMatch && identityMatch.matches('[data-testid="user-message"]')) {
            return { element: identityMatch, source: 'reference-id' };
        }

        const catalogOccurrence = STATE.messages.slice(0, index + 1).filter((candidate) => (
            getComparableMessageText(candidate.text) === targetText
        )).length - 1;
        const textMatches = elements.filter((element) => (
            getComparableMessageText(normalizeMessageText(element)) === targetText
        ));
        if (catalogOccurrence >= 0 && textMatches[catalogOccurrence]) {
            return { element: textMatches[catalogOccurrence], source: 'reference-text-occurrence' };
        }
        return null;
    }

    function scrollExactUserElementIntoView(element, index, behavior) {
        if (!element || !element.isConnected) return false;

        const container = findScrollContainerForElement(element);
        if (STATE.scrollContainer !== container) bindScrollSync();

        const exactTop = getExactUserElementScrollTop(element, container);
        if (typeof exactTop !== 'number') return false;

        if (behavior === 'smooth') {
            scrollTargetTo(container, exactTop, 'smooth');
        } else {
            scrollTargetToInstant(container, exactTop);
        }
        scheduleJumpCorrection(element, 4, index);
        const rect = element.getBoundingClientRect();
        if (STATE.lastNavigationDebug && typeof STATE.lastNavigationDebug === 'object') {
            STATE.lastNavigationDebug.targetViewportTop = Math.round(getExactUserViewportTop(container));
            STATE.lastNavigationDebug.finalRect = {
                top: Math.round(rect.top),
                bottom: Math.round(rect.bottom),
                height: Math.round(rect.height)
            };
        }

        scheduleActiveSync();
        return true;
    }

    function pokeChatGptLazyMount(container, slot) {
        if (slot && slot.isConnected) {
            slot.getBoundingClientRect();
        }
        if (container && !isWindowScrollTarget(container)) {
            container.dispatchEvent(new Event('scroll', { bubbles: true }));
        }
        window.dispatchEvent(new Event('scroll'));
        window.dispatchEvent(new Event('resize'));
        if (slot && slot.isConnected) {
            window.requestAnimationFrame(() => {
                slot.getBoundingClientRect();
                if (container && !isWindowScrollTarget(container)) {
                    container.dispatchEvent(new Event('scroll', { bubbles: true }));
                }
            });
        }
    }

    function getMessageAbsoluteTop(message, container) {
        const target = getMessageTarget(message);
        if (!target || !target.isConnected) return;

        const viewport = getViewportRect(container);
        const rect = target.getBoundingClientRect();
        return getScrollTop(container) + rect.top - viewport.top;
    }

    function getElementAbsoluteTop(element, container) {
        if (!element || !element.isConnected) return;

        const viewport = getViewportRect(container);
        const rect = element.getBoundingClientRect();
        return getScrollTop(container) + rect.top - viewport.top;
    }

    function getMessageRemoteIndex(message, index) {
        if (message && typeof message.nativeTocIndex === 'number') return message.nativeTocIndex;
        return message && typeof message.remoteIndex === 'number' ? message.remoteIndex : index;
    }

    function getChatGptMessageSlotRoot() {
        const roots = Array.from(document.querySelectorAll('[class*="convSearchResultHighlightRoot"]'));
        return roots.sort((a, b) => b.children.length - a.children.length)[0] || null;
    }

    function hasCompleteChatGptIndexedSlotLayout(root) {
        if (!root) return false;
        const expectedUserCount = STATE.remoteMessages.length || STATE.messages.length || 0;
        if (!expectedUserCount) return false;
        return root.children.length >= 1 + expectedUserCount * 2;
    }

    function getChatGptTurnShellSortIndex(element, fallback) {
        const testId = element.getAttribute('data-testid') || '';
        const match = /^conversation-turn-(\d+)/.exec(testId);
        if (match && match[1]) {
            const parsed = Number.parseInt(match[1], 10);
            if (!Number.isNaN(parsed)) return parsed;
        }
        return fallback;
    }

    function getChatGptTurnShells() {
        const root = document.querySelector('#thread, main#main') || document;
        const selector = [
            'section[data-turn]',
            '[data-testid^="conversation-turn"]',
            '[data-turn-id-container]',
            '[data-turn-id]'
        ].join(', ');
        const shells = Array.from(root.querySelectorAll(selector))
            .filter((element) => {
                if (!(element instanceof HTMLElement)) return false;
                if (element.closest('#ai-toc-v2_2, .gh-root, .gh-main-panel')) return false;
                return true;
            })
            .filter((element, index, all) => !all.some((other) => other !== element && other.contains(element)));

        return shells
            .map((element, index) => ({ element, index: getChatGptTurnShellSortIndex(element, index) }))
            .sort((a, b) => a.index - b.index)
            .map((item) => item.element);
    }

    function getChatGptTurnShellByIdentityKeys(identityKeys) {
        if (!identityKeys || !identityKeys.length) return null;

        const root = document.querySelector('#thread, main#main') || document;
        for (let i = 0; i < identityKeys.length; i++) {
            const id = getMessageIdFromIdentityKey(identityKeys[i]);
            if (!id) continue;

            const escapedId = escapeCssValue(id);
            const shell = root.querySelector(
                `[data-turn-id-container="${escapedId}"], [data-turn-id="${escapedId}"]`
            );
            if (shell instanceof HTMLElement && shell.isConnected) return shell;
        }

        return null;
    }

    function getChatGptTurnShellRole(shell) {
        if (!shell) return '';
        const directTurn = shell.getAttribute('data-turn') || '';
        if (directTurn) return directTurn;

        const roleElement = getChatGptSlotRoleElement(shell);
        return roleElement ? roleElement.getAttribute('data-message-author-role') || '' : '';
    }

    function getChatGptUserTurnShellElement(remoteIndex) {
        if (typeof remoteIndex !== 'number' || remoteIndex < 0) return null;

        const shells = getChatGptTurnShells();
        if (!shells.length) return null;
        const expectedUserCount = STATE.remoteMessages.length || STATE.messages.length || 0;
        if (!expectedUserCount) return null;

        const explicitUserShells = shells.filter((shell) => getChatGptTurnShellRole(shell) === 'user');
        if (explicitUserShells.length >= expectedUserCount && explicitUserShells[remoteIndex]) {
            return explicitUserShells[remoteIndex];
        }

        const alternatingUserIndex = remoteIndex * 2;
        if (shells.length >= expectedUserCount * 2 - 1 && shells[alternatingUserIndex]) {
            return shells[alternatingUserIndex];
        }

        if (expectedUserCount > 0 && shells.length >= expectedUserCount) return shells[remoteIndex] || null;
        return null;
    }

    function getChatGptUserSlotElement(remoteIndex) {
        const root = getChatGptMessageSlotRoot();
        if (hasCompleteChatGptIndexedSlotLayout(root) && typeof remoteIndex === 'number' && remoteIndex >= 0) {
            const slot = root.children[1 + remoteIndex * 2] || null;
            if (slot) return slot;
        }
        return getChatGptUserTurnShellElement(remoteIndex);
    }

    function getChatGptSlotSource(slot, remoteIndex) {
        if (!slot) return '';

        if (slot.matches && slot.matches('[data-turn-id-container], [data-turn-id]')) {
            return 'turn-id';
        }

        const root = getChatGptMessageSlotRoot();
        if (
            hasCompleteChatGptIndexedSlotLayout(root) &&
            typeof remoteIndex === 'number' &&
            root.children[1 + remoteIndex * 2] === slot
        ) {
            return 'conv-root';
        }
        return getChatGptTurnShells().includes(slot) ? 'turn-shell' : 'unknown';
    }

    function getChatGptSlotRoleElement(slot, role) {
        if (!slot || !slot.isConnected) return null;

        const selector = role
            ? `[data-message-author-role="${escapeCssValue(role)}"]`
            : '[data-message-author-role]';
        if (slot.matches && slot.matches(selector)) return slot;
        return slot.querySelector ? slot.querySelector(selector) : null;
    }

    function getChatGptSlotDebug(slot) {
        const roleElement = getChatGptSlotRoleElement(slot);
        const rect = slot && slot.getBoundingClientRect ? slot.getBoundingClientRect() : null;
        return {
            role: roleElement ? roleElement.getAttribute('data-message-author-role') : '',
            messageId: roleElement ? roleElement.getAttribute('data-message-id') : '',
            turnId: slot && slot.getAttribute ? (slot.getAttribute('data-turn-id-container') || slot.getAttribute('data-turn-id') || '') : '',
            text: roleElement ? normalizeMessageText(roleElement).slice(0, 80) : '',
            top: rect ? Math.round(rect.top) : null,
            height: rect ? Math.round(rect.height) : null,
            hasLastKnownHeight: !!(slot && String(slot.className || '').includes('last-known-height'))
        };
    }

    function findLiveUserElementInSlot(message, index) {
        if (!message) return null;

        const remoteIndex = getMessageRemoteIndex(message, index);
        const slot = getChatGptUserSlotElement(remoteIndex);
        if (!slot || !slot.isConnected) return null;

        const userElement = getChatGptSlotRoleElement(slot, 'user');
        if (!userElement || !userElement.isConnected) return null;

        const identityKeys = getMessageIdentityKeys(message);
        const domIdentityKey = getMessageIdentityKeyFromElement(userElement);
        if (domIdentityKey && identityKeys.includes(domIdentityKey)) {
            return {
                element: userElement,
                source: 'slot-id',
                liveIndex: null,
                domIdentityKey,
                slotText: extractChatGptUserQueryText(userElement).slice(0, 80)
            };
        }

        const remoteText = getComparableMessageText(message.text);
        const liveText = getComparableMessageText(extractChatGptUserQueryText(userElement));
        const textMatches = isComparableTextMatch(remoteText, liveText);
        if (!textMatches) return null;

        if (domIdentityKey) {
            message.identityKeys = createMessageIdentityKeys.apply(
                null,
                identityKeys.concat([domIdentityKey])
            );
        }

        return {
            element: userElement,
            source: 'slot-text-id',
            liveIndex: null,
            domIdentityKey: domIdentityKey || '',
            slotText: extractChatGptUserQueryText(userElement).slice(0, 80)
        };
    }

    function getChatGptMessageSlotSummary() {
        const root = getChatGptMessageSlotRoot();
        if (!root) {
            return getChatGptTurnShells().map((element, childIndex) => {
                const roleElement = getChatGptSlotRoleElement(element);
                const rect = element.getBoundingClientRect();
                return {
                    childIndex,
                    userIndex: getChatGptTurnShellRole(element) === 'user' ? childIndex : null,
                    source: 'turn-shell',
                    role: roleElement ? roleElement.getAttribute('data-message-author-role') : getChatGptTurnShellRole(element),
                    messageId: roleElement ? roleElement.getAttribute('data-message-id') : '',
                    text: roleElement ? normalizeMessageText(roleElement).slice(0, 80) : '',
                    hasLastKnownHeight: String(element.className || '').includes('last-known-height'),
                    top: Math.round(rect.top),
                    height: Math.round(rect.height)
                };
            });
        }

        return Array.from(root.children).map((element, childIndex) => {
            const roleElement = getChatGptSlotRoleElement(element);
            const rect = element.getBoundingClientRect();
            return {
                childIndex,
                userIndex: childIndex > 0 && (childIndex - 1) % 2 === 0 ? (childIndex - 1) / 2 : null,
                source: 'conv-root',
                role: roleElement ? roleElement.getAttribute('data-message-author-role') : '',
                messageId: roleElement ? roleElement.getAttribute('data-message-id') : '',
                text: roleElement ? normalizeMessageText(roleElement).slice(0, 80) : '',
                hasLastKnownHeight: String(element.className || '').includes('last-known-height'),
                top: Math.round(rect.top),
                height: Math.round(rect.height)
            };
        });
    }

    function scrollChatGptUserSlotIntoView(remoteIndex, index, behavior) {
        const slot = getChatGptUserSlotElement(remoteIndex);
        if (!slot || !slot.isConnected) return false;

        const container = findScrollContainerForElement(slot);
        if (STATE.scrollContainer !== container) bindScrollSync();

        const viewport = getViewportRect(container);
        const offset = Math.max(80, viewport.height * 0.35);
        const slotTop = getElementAbsoluteTop(slot, container);
        if (typeof slotTop !== 'number') return false;

        const nextTop = Math.max(0, Math.min(slotTop - offset, getScrollMaxTop(container)));
        scrollTargetTo(container, nextTop, behavior || 'auto');
        pokeChatGptLazyMount(container, slot);

        STATE.lastNavigationDebug = {
            mode: 'slot-seek',
            index,
            remoteIndex,
            childIndex: 1 + remoteIndex * 2,
            currentTop: Math.round(getScrollTop(container)),
            nextTop: Math.round(nextTop),
            viewportOffset: Math.round(offset),
            slotTop: Math.round(slotTop),
            slotHeight: Math.round(slot.getBoundingClientRect().height),
            slotHasLastKnownHeight: String(slot.className || '').includes('last-known-height'),
            lazyMountPoked: true
        };
        return true;
    }

    function estimateVirtualMessageScrollTop(index, container) {
        const messages = STATE.messages;
        const maxTop = getScrollMaxTop(container);
        const viewport = getViewportRect(container);
        const currentTop = getScrollTop(container);
        const connected = [];

        getCurrentTextAlignmentMatches().forEach((match) => {
            const top = getElementAbsoluteTop(match.element, container);
            if (typeof top === 'number') {
                connected.push({
                    index: match.remoteIndex,
                    top,
                    source: match.source
                });
            }
        });

        messages.forEach((message, messageIndex) => {
            const top = getMessageAbsoluteTop(message, container);
            if (typeof top === 'number') connected.push({ index: messageIndex, top, source: 'message-anchor' });
        });

        connected.sort((a, b) => {
            if (a.index !== b.index) return a.index - b.index;
            return a.top - b.top;
        });

        const deduped = [];
        connected.forEach((item) => {
            const last = deduped[deduped.length - 1];
            if (last && last.index === item.index) return;
            deduped.push(item);
        });

        if (!deduped.length) {
            const ratio = messages.length > 1 ? index / (messages.length - 1) : 0;
            return Math.max(0, Math.min(maxTop, maxTop * ratio));
        }

        const first = deduped[0];
        const last = deduped[deduped.length - 1];
        const step = Math.max(240, viewport.height * 0.85);

        if (index < first.index) return Math.max(0, currentTop - step);
        if (index > last.index) return Math.min(maxTop, currentTop + step);

        for (let i = 0; i < deduped.length - 1; i++) {
            const before = deduped[i];
            const after = deduped[i + 1];
            if (index < before.index || index > after.index) continue;

            const span = Math.max(1, after.index - before.index);
            const ratio = (index - before.index) / span;
            return Math.max(0, Math.min(maxTop, before.top + (after.top - before.top) * ratio));
        }

        const ratio = messages.length > 1 ? index / (messages.length - 1) : 0;
        return Math.max(0, Math.min(maxTop, maxTop * ratio));
    }

    function getDirectionalSeekScroll(index, container) {
        const matches = getCurrentTextAlignmentMatches();
        const maxTop = getScrollMaxTop(container);
        const currentTop = getScrollTop(container);
        const viewport = getViewportRect(container);
        const step = Math.max(320, viewport.height * 0.62);
        const visibleIndexes = matches.map((match) => match.remoteIndex);

        let direction = 1;
        let reason = 'no-visible-index';

        const lower = matches
            .filter((match) => match.remoteIndex < index)
            .sort((a, b) => b.remoteIndex - a.remoteIndex)[0] || null;
        const higher = matches
            .filter((match) => match.remoteIndex > index)
            .sort((a, b) => a.remoteIndex - b.remoteIndex)[0] || null;

        if (lower && !higher) {
            direction = 1;
            reason = 'target-after-visible';
        } else if (!lower && higher) {
            direction = -1;
            reason = 'target-before-visible';
        } else if (lower && higher) {
            const lowerDistance = index - lower.remoteIndex;
            const higherDistance = higher.remoteIndex - index;
            direction = higherDistance <= lowerDistance ? -1 : 1;
            reason = direction < 0 ? 'between-closer-to-higher' : 'between-closer-to-lower';
        }

        return {
            top: Math.max(0, Math.min(maxTop, currentTop + direction * step)),
            currentTop,
            direction,
            reason,
            visibleIndexes
        };
    }

    function findMessageIndexByIdentityKeys(identityKeys) {
        if (!identityKeys || !identityKeys.length) return -1;
        for (let i = 0; i < STATE.messages.length; i++) {
            const keys = getMessageIdentityKeys(STATE.messages[i]);
            for (let j = 0; j < keys.length; j++) {
                if (identityKeys.includes(keys[j])) return i;
            }
        }
        return -1;
    }

    function waitForMilliseconds(delay) {
        return new Promise((resolve) => window.setTimeout(resolve, delay));
    }

    function isVisibleElement(element) {
        if (!(element instanceof HTMLElement)) return false;
        if (!element.isConnected) return false;

        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;

        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    function isElementInViewport(element, container) {
        if (!element || !element.getBoundingClientRect) return false;

        const rect = element.getBoundingClientRect();
        const viewport = getViewportRect(container);
        return rect.bottom > viewport.top && rect.top < viewport.bottom;
    }

    function getClosestElementToViewportCenter(elements, container) {
        const viewport = getViewportRect(container);
        const center = viewport.top + viewport.height / 2;

        return elements
            .map((element) => {
                const rect = element.getBoundingClientRect();
                return {
                    element,
                    distance: Math.abs(rect.top + rect.height / 2 - center)
                };
            })
            .sort((a, b) => a.distance - b.distance)[0]?.element || null;
    }

    function findChatGptNativeTocUserQueryCandidate(text, preferActive) {
        const container = getActiveScrollContainer();
        const users = Array.from(document.querySelectorAll('[data-message-author-role="user"]'))
            .filter((element) => isVisibleElement(element) && isElementInViewport(element, container));
        const matches = users.filter((element) => isCompatibleNativeTocText(extractChatGptUserQueryText(element), text));
        if (!matches.length) return null;
        if (preferActive || matches.length > 1) return getClosestElementToViewportCenter(matches, container);
        return matches[0];
    }

    function resolveChatGptNativeTocEntryForMessage(message, index) {
        if (!message || !window.location.hostname.includes('chatgpt.com')) return null;

        const nativeIndex = typeof message.nativeTocIndex === 'number'
            ? message.nativeTocIndex
            : getMessageRemoteIndex(message, index);
        let entry = getChatGptNativeTocEntryForIndex(nativeIndex);
        if (entry) return entry;

        const compatibleEntries = getChatGptNativeTocEntries().filter((candidate) => (
            isCompatibleNativeTocText(message.text, candidate.text)
        ));
        return compatibleEntries.length === 1 ? compatibleEntries[0] : null;
    }

    async function waitForChatGptNativeTocUserQuery(entry, message, timeout) {
        const endAt = Date.now() + timeout;
        while (Date.now() < endAt) {
            await waitForMilliseconds(80);
            const slot = getChatGptUserSlotElement(entry.index);
            const slotUser = getChatGptSlotRoleElement(slot, 'user');
            if (slotUser && isCompatibleNativeTocText(extractChatGptUserQueryText(slotUser), message.text || entry.text)) {
                return slotUser;
            }
            const activeIndex = getChatGptActiveNativeTocIndex();
            const candidate = findChatGptNativeTocUserQueryCandidate(
                message.text || entry.text,
                activeIndex === entry.index
            );
            if (candidate) return candidate;
        }
        return null;
    }

    function attachResolvedUserElementToMessage(message, element, anchorSource) {
        const domIdentityKey = getMessageIdentityKeyFromElement(element);
        if (domIdentityKey) {
            message.identityKeys = createMessageIdentityKeys.apply(
                null,
                getMessageIdentityKeys(message).concat([domIdentityKey])
            );
            message.identityKey = message.identityKeys[0] || message.identityKey;
        }
        message.anchor = element;
        message.container = ADAPTER.resolveMessageContainer(element);
        message.anchorSource = anchorSource;
        return domIdentityKey;
    }

    async function navigateWithChatGptNativeToc(message, index) {
        const entry = resolveChatGptNativeTocEntryForMessage(message, index);
        if (!entry || !entry.button) return false;

        const identityKeys = getMessageIdentityKeys(message);
        if (entry.element && entry.element.isConnected) {
            const domIdentityKey = attachResolvedUserElementToMessage(message, entry.element, 'native-toc-mounted');
            STATE.lastNavigationDebug = {
                mode: 'native-toc-mounted',
                index,
                remoteIndex: getMessageRemoteIndex(message, index),
                nativeTocIndex: entry.index,
                identityKeys,
                domIdentityKey,
                nativeText: entry.text,
                targetText: normalizeMessageText(entry.element).slice(0, 80)
            };
            scrollExactUserElementIntoView(entry.element, index, 'auto');
            return true;
        }

        STATE.lastNavigationDebug = {
            mode: 'native-toc-start',
            index,
            remoteIndex: getMessageRemoteIndex(message, index),
            nativeTocIndex: entry.index,
            identityKeys,
            nativeText: entry.text,
            text: message.text.slice(0, 80)
        };

        try {
            entry.button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        } catch (error) {
            // The button click still works when the horizontal prompt strip cannot scroll.
        }
        entry.button.click();

        const target = await waitForChatGptNativeTocUserQuery(entry, message, 1800);
        if (!target) {
            const activeNativeTocIndex = getChatGptActiveNativeTocIndex();
            STATE.lastNavigationDebug = {
                mode: activeNativeTocIndex === entry.index ? 'native-toc-active-only' : 'native-toc-timeout',
                index,
                remoteIndex: getMessageRemoteIndex(message, index),
                nativeTocIndex: entry.index,
                identityKeys,
                activeNativeTocIndex,
                nativeText: entry.text,
                text: message.text.slice(0, 80)
            };
            return false;
        }

        const domIdentityKey = attachResolvedUserElementToMessage(message, target, 'native-toc');
        STATE.lastNavigationDebug = {
            mode: 'native-toc-hit',
            index,
            remoteIndex: getMessageRemoteIndex(message, index),
            nativeTocIndex: entry.index,
            identityKeys,
            activeNativeTocIndex: getChatGptActiveNativeTocIndex(),
            domIdentityKey,
            nativeText: entry.text,
            targetText: normalizeMessageText(target).slice(0, 80)
        };
        scrollExactUserElementIntoView(target, index, 'auto');
        scheduleActiveSync();
        return true;
    }

    function scrollChatGptSlotForRevive(slot) {
        if (!slot || !slot.isConnected) return false;

        const container = findScrollContainerForElement(slot);
        if (STATE.scrollContainer !== container) bindScrollSync();

        const viewport = getViewportRect(container);
        const slotTop = getElementAbsoluteTop(slot, container);
        if (typeof slotTop === 'number') {
            scrollTargetToInstant(container, slotTop - viewport.height * 0.45);
        } else {
            try {
                slot.scrollIntoView({ block: 'center', behavior: 'instant' });
            } catch (error) {
                try {
                    slot.scrollIntoView({ block: 'center' });
                } catch (innerError) {
                    return false;
                }
            }
        }

        pokeChatGptLazyMount(container, slot);
        if (container && !isWindowScrollTarget(container)) {
            container.dispatchEvent(new Event('scroll', { bubbles: true }));
        }
        window.dispatchEvent(new Event('resize'));
        return true;
    }

    function resolveMountedChatGptRemoteTarget(message, index) {
        const identityKeys = getMessageIdentityKeys(message);
        const identityMatch = findLiveUserElementByIdentityKeys(identityKeys);
        if (identityMatch) return { element: identityMatch, source: 'remote-id' };

        const turnShell = getChatGptTurnShellByIdentityKeys(identityKeys);
        const turnUser = getChatGptSlotRoleElement(turnShell, 'user');
        if (turnUser) return { element: turnUser, source: 'remote-turn-id' };

        const slotMatch = findLiveUserElementInSlot(message, index);
        if (slotMatch) return slotMatch;

        const remoteIndex = getMessageRemoteIndex(message, index);
        const alignedMatch = getCurrentTextAlignmentMatches().find((match) => match.remoteIndex === remoteIndex);
        if (alignedMatch && alignedMatch.source === 'message-id') {
            return { element: alignedMatch.element, source: 'remote-aligned-id' };
        }

        if (alignedMatch) {
            const comparable = getComparableMessageText(message.text);
            const duplicateCount = STATE.remoteMessages.filter((candidate) => (
                getComparableMessageText(candidate.text) === comparable
            )).length;
            if (duplicateCount === 1) {
                return { element: alignedMatch.element, source: 'remote-unique-text' };
            }
        }

        return null;
    }

    async function seekMountedChatGptRemoteTarget(message, index) {
        const remoteIndex = getMessageRemoteIndex(message, index);
        const total = STATE.remoteMessages.length || STATE.messages.length;
        if (remoteIndex < 0 || !total) return null;

        let matches = getCurrentTextAlignmentMatches();
        const sampleElement = matches.length ? matches[0].element : null;
        const container = sampleElement
            ? findScrollContainerForElement(sampleElement)
            : getActiveScrollContainer();
        if (STATE.scrollContainer !== container) bindScrollSync();

        const viewport = getViewportRect(container);
        let lower = { index: -1, top: 0 };
        let upper = { index: total, top: getScrollMaxTop(container) + viewport.height };
        let previousTop = -1;

        for (let attempt = 0; attempt < 24; attempt++) {
            const mounted = resolveMountedChatGptRemoteTarget(message, index);
            if (mounted) return mounted;

            matches = getCurrentTextAlignmentMatches();
            const turnMatches = getCurrentChatGptTurnAlignmentMatches();
            const positionalMatches = matches.concat(turnMatches);
            let targetTurnTop = null;
            positionalMatches.forEach((match) => {
                const top = getElementAbsoluteTop(match.element, container);
                if (typeof top !== 'number') return;
                if (match.remoteIndex === remoteIndex) {
                    targetTurnTop = typeof targetTurnTop === 'number' ? Math.min(targetTurnTop, top) : top;
                }
                if (match.remoteIndex < remoteIndex && match.remoteIndex > lower.index) {
                    lower = { index: match.remoteIndex, top };
                }
                if (match.remoteIndex > remoteIndex && match.remoteIndex < upper.index) {
                    upper = { index: match.remoteIndex, top };
                }
            });

            const indexSpan = Math.max(1, upper.index - lower.index);
            const ratio = clampNumber((remoteIndex - lower.index) / indexSpan, 0, 1);
            const targetAbsoluteTop = lower.top + (upper.top - lower.top) * ratio;
            const offset = Math.min(120, Math.max(72, viewport.height * 0.12));
            const maxTop = getScrollMaxTop(container);
            let nextTop = clampNumber(
                typeof targetTurnTop === 'number'
                    ? targetTurnTop - viewport.height * 0.7
                    : targetAbsoluteTop - offset,
                0,
                maxTop
            );
            const currentTop = getScrollTop(container);

            if (Math.abs(nextTop - currentTop) < 24) {
                const direction = positionalMatches.length &&
                    positionalMatches.every((match) => match.remoteIndex > remoteIndex) ? -1 : 1;
                nextTop = clampNumber(
                    currentTop + direction * Math.max(240, viewport.height * 0.55),
                    0,
                    maxTop
                );
            }
            if (nextTop === previousTop && nextTop !== 0 && nextTop !== maxTop) {
                nextTop = clampNumber(nextTop + (remoteIndex > lower.index ? 96 : -96), 0, maxTop);
            }

            STATE.lastNavigationDebug = {
                mode: 'remote-id-index-seek',
                index,
                remoteIndex,
                attempt: attempt + 1,
                identityKeys: getMessageIdentityKeys(message),
                currentTop: Math.round(currentTop),
                nextTop: Math.round(nextTop),
                lowerIndex: lower.index,
                lowerTop: Math.round(lower.top),
                upperIndex: upper.index,
                upperTop: Math.round(upper.top),
                visibleRemoteIndexes: Array.from(new Set(positionalMatches.map((match) => match.remoteIndex))),
                targetTurnTop: typeof targetTurnTop === 'number' ? Math.round(targetTurnTop) : null,
                targetText: message.text.slice(0, 80)
            };

            previousTop = nextTop;
            scrollTargetToInstant(container, nextTop);
            pokeChatGptLazyMount(container, null);
            await waitForMilliseconds(140);
        }

        return null;
    }

    async function waitForMountedChatGptRemoteTarget(message, index, timeout) {
        const endAt = Date.now() + timeout;
        while (Date.now() < endAt) {
            await waitForMilliseconds(60);
            scanContent();
            const nextIndex = findMessageIndexByIdentityKeys(getMessageIdentityKeys(message));
            const nextMessage = nextIndex >= 0 ? STATE.messages[nextIndex] : message;
            const target = resolveMountedChatGptRemoteTarget(nextMessage, nextIndex >= 0 ? nextIndex : index);
            if (target) {
                return {
                    match: target,
                    message: nextMessage,
                    index: nextIndex >= 0 ? nextIndex : index
                };
            }
        }
        return null;
    }

    async function navigateWithChatGptRemoteToc(message, index) {
        const identityKeys = getMessageIdentityKeys(message);
        const remoteIndex = getMessageRemoteIndex(message, index);
        let liveMatch = resolveMountedChatGptRemoteTarget(message, index);
        if (liveMatch) {
            const domIdentityKey = attachResolvedUserElementToMessage(message, liveMatch.element, liveMatch.source || 'remote-mounted');
            STATE.lastNavigationDebug = {
                mode: `remote-${liveMatch.source || 'mounted'}-hit`,
                index,
                remoteIndex,
                identityKeys,
                domIdentityKey,
                targetText: normalizeMessageText(liveMatch.element).slice(0, 80),
                slotText: liveMatch.slotText || ''
            };
            scrollExactUserElementIntoView(liveMatch.element, index, 'auto');
            return true;
        }

        const slot = getChatGptTurnShellByIdentityKeys(identityKeys) || getChatGptUserSlotElement(remoteIndex);
        if (!slot || !slot.isConnected) {
            STATE.lastNavigationDebug = {
                mode: 'remote-slot-missing-seek-start',
                index,
                remoteIndex,
                identityKeys,
                hasConvRoot: !!getChatGptMessageSlotRoot(),
                turnShells: getChatGptTurnShells().length,
                text: message.text.slice(0, 80)
            };
            const soughtTarget = await seekMountedChatGptRemoteTarget(message, index);
            if (!soughtTarget) {
                STATE.lastNavigationDebug = Object.assign({}, STATE.lastNavigationDebug, {
                    mode: 'remote-id-index-seek-timeout'
                });
                return false;
            }
            const domIdentityKey = attachResolvedUserElementToMessage(
                message,
                soughtTarget.element,
                soughtTarget.source || 'remote-id-index-seek'
            );
            STATE.lastNavigationDebug = {
                mode: `remote-${soughtTarget.source || 'id-index-seek'}-hit`,
                index,
                remoteIndex,
                identityKeys,
                domIdentityKey,
                targetText: normalizeMessageText(soughtTarget.element).slice(0, 80)
            };
            scrollExactUserElementIntoView(soughtTarget.element, index, 'auto');
            scheduleActiveSync();
            return true;
        }

        const slotDebug = getChatGptSlotDebug(slot);
        const slotSource = getChatGptSlotSource(slot, remoteIndex);
        STATE.lastNavigationDebug = {
            mode: 'remote-slot-revive-start',
            index,
            remoteIndex,
            childIndex: 1 + remoteIndex * 2,
            slotSource,
            identityKeys,
            slotRole: slotDebug.role,
            slotMessageId: slotDebug.messageId,
            slotTurnId: slotDebug.turnId,
            slotText: slotDebug.text,
            slotHasLastKnownHeight: slotDebug.hasLastKnownHeight,
            slotHeight: slotDebug.height,
            text: message.text.slice(0, 80)
        };
        if (!scrollChatGptSlotForRevive(slot)) return false;

        let resolved = await waitForMountedChatGptRemoteTarget(message, index, 2600);
        if (!resolved) {
            const latestSlot = getChatGptTurnShellByIdentityKeys(identityKeys) || getChatGptUserSlotElement(remoteIndex);
            const latestSlotDebug = getChatGptSlotDebug(latestSlot);
            STATE.lastNavigationDebug = {
                mode: 'remote-slot-timeout',
                index,
                remoteIndex,
                childIndex: 1 + remoteIndex * 2,
                slotSource: getChatGptSlotSource(latestSlot, remoteIndex),
                identityKeys,
                slotRole: latestSlotDebug.role,
                slotMessageId: latestSlotDebug.messageId,
                slotTurnId: latestSlotDebug.turnId,
                slotText: latestSlotDebug.text,
                slotHasLastKnownHeight: latestSlotDebug.hasLastKnownHeight,
                slotHeight: latestSlotDebug.height,
                text: message.text.slice(0, 80)
            };
            const soughtTarget = await seekMountedChatGptRemoteTarget(message, index);
            if (!soughtTarget) return false;
            resolved = {
                match: soughtTarget,
                message,
                index
            };
        }

        liveMatch = resolved.match;
        const resolvedMessage = resolved.message;
        const resolvedIndex = resolved.index;
        const domIdentityKey = attachResolvedUserElementToMessage(
            resolvedMessage,
            liveMatch.element,
            liveMatch.source || 'remote-revived'
        );
        STATE.clickLockIndex = resolvedIndex;
        setActiveIndex(resolvedIndex);
        STATE.lastNavigationDebug = {
            mode: `remote-${liveMatch.source || 'revived'}-hit`,
            index: resolvedIndex,
            requestedIndex: index,
            remoteIndex: getMessageRemoteIndex(resolvedMessage, resolvedIndex),
            identityKeys,
            domIdentityKey,
            targetText: normalizeMessageText(liveMatch.element).slice(0, 80),
            slotText: liveMatch.slotText || ''
        };
        scrollExactUserElementIntoView(liveMatch.element, resolvedIndex, 'auto');
        scheduleActiveSync();
        return true;
    }

    function seekVirtualMessageIntoView(identityKeys, attemptsLeft) {
        clearVirtualSeekTimer();
        if (!identityKeys || !identityKeys.length || attemptsLeft <= 0) return;

        STATE.virtualSeekTimer = window.setTimeout(() => {
            STATE.virtualSeekTimer = 0;
            scanContent();

            const index = findMessageIndexByIdentityKeys(identityKeys);
            const message = index >= 0 ? STATE.messages[index] : null;
            if (!message) return;

            const liveMatch = findLiveUserElementForMessage(message, index);
            if (liveMatch) {
                STATE.clickLockIndex = index;
                setActiveIndex(index);
                message.anchor = liveMatch.element;
                message.container = ADAPTER.resolveMessageContainer(liveMatch.element);
                STATE.lastNavigationDebug = {
                    mode: liveMatch.source === 'id' ? 'virtual-id-hit' : `virtual-${liveMatch.source}-hit`,
                    index,
                    attemptsLeft,
                    identityKeys,
                    anchorSource: liveMatch.source,
                    liveIndex: typeof liveMatch.liveIndex === 'number' ? liveMatch.liveIndex : null,
                    domIdentityKey: liveMatch.domIdentityKey || '',
                    targetText: normalizeMessageText(liveMatch.element).slice(0, 80),
                    slotText: liveMatch.slotText || ''
                };
                scrollExactUserElementIntoView(liveMatch.element, index, 'auto');
                scheduleActiveSync();
                return;
            }

            const remoteIndex = getMessageRemoteIndex(message, index);
            const slot = getChatGptUserSlotElement(remoteIndex);
            if (slot && slot.isConnected) {
                const shouldNudgeSlot = String(slot.className || '').includes('last-known-height') &&
                    attemptsLeft > 0 &&
                    attemptsLeft % 5 === 0;
                if (shouldNudgeSlot) {
                    scrollChatGptUserSlotIntoView(remoteIndex, index, 'auto');
                } else {
                    pokeChatGptLazyMount(findScrollContainerForElement(slot), slot);
                }
                const slotDebug = getChatGptSlotDebug(slot);
                STATE.lastNavigationDebug = {
                    mode: shouldNudgeSlot ? 'slot-nudge' : 'slot-wait',
                    index,
                    remoteIndex,
                    childIndex: 1 + remoteIndex * 2,
                    attemptsLeft,
                    identityKeys,
                    slotRole: slotDebug.role,
                    slotMessageId: slotDebug.messageId,
                    slotText: slotDebug.text,
                    slotHasLastKnownHeight: slotDebug.hasLastKnownHeight,
                    slotHeight: slotDebug.height,
                    lazyMountPoked: true
                };
            } else {
                const container = getActiveScrollContainer();
                const seek = getDirectionalSeekScroll(index, container);
                STATE.lastNavigationDebug = {
                    mode: 'virtual-seek-step-fallback',
                    index,
                    attemptsLeft,
                    identityKeys,
                    nextTop: Math.round(seek.top),
                    currentTop: Math.round(seek.currentTop),
                    direction: seek.direction,
                    reason: seek.reason,
                    visibleRemoteIndexes: seek.visibleIndexes
                };
                scrollTargetTo(container, seek.top, 'auto');
            }
            scheduleActiveSync();
            seekVirtualMessageIntoView(identityKeys, attemptsLeft - 1);
        }, TIMINGS.virtualSeekInterval);
    }

    function scrollVirtualMessageIntoView(message, index) {
        const identityKeys = getMessageIdentityKeys(message);
        if (!identityKeys.length) return;

        clearVirtualSeekTimer();

        const liveMatch = findLiveUserElementForMessage(message, index);
        if (liveMatch) {
            STATE.lastNavigationDebug = {
                mode: liveMatch.source === 'id' ? 'already-mounted-id-hit' : `already-mounted-${liveMatch.source}-hit`,
                index,
                identityKeys,
                anchorSource: liveMatch.source,
                liveIndex: typeof liveMatch.liveIndex === 'number' ? liveMatch.liveIndex : null,
                domIdentityKey: liveMatch.domIdentityKey || '',
                targetText: normalizeMessageText(liveMatch.element).slice(0, 80),
                slotText: liveMatch.slotText || ''
            };
            scrollExactUserElementIntoView(liveMatch.element, index, 'auto');
            return;
        }

        const remoteIndex = getMessageRemoteIndex(message, index);
        if (!scrollChatGptUserSlotIntoView(remoteIndex, index, 'auto')) {
            const container = getActiveScrollContainer();
            const seek = getDirectionalSeekScroll(index, container);
            STATE.lastNavigationDebug = {
                mode: 'virtual-seek-start-fallback',
                index,
                identityKeys,
                nextTop: Math.round(seek.top),
                currentTop: Math.round(seek.currentTop),
                direction: seek.direction,
                reason: seek.reason,
                visibleRemoteIndexes: seek.visibleIndexes,
                text: message.text.slice(0, 80)
            };
            scrollTargetTo(container, seek.top, 'auto');
        } else {
            STATE.lastNavigationDebug.identityKeys = identityKeys;
            STATE.lastNavigationDebug.text = message.text.slice(0, 80);
        }
        seekVirtualMessageIntoView(identityKeys, TIMINGS.virtualSeekMaxAttempts);
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
        clearVirtualSeekTimer();
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
        scheduleAutoCollapse();
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

    function findMessageIndexByRemoteIndex(messages, remoteIndex) {
        if (typeof remoteIndex !== 'number') return -1;

        return messages.findIndex((message, index) => (
            getMessageRemoteIndex(message, index) === remoteIndex ||
            message.remoteIndex === remoteIndex ||
            message.nativeTocIndex === remoteIndex ||
            message.stableOrder === remoteIndex
        ));
    }

    function findMessageIndexForLiveChatGptElement(messages, element, fallbackRemoteIndex) {
        const identityKey = getMessageIdentityKeyFromElement(element);
        if (identityKey) {
            const identityIndex = messages.findIndex((message) => getMessageIdentityKeys(message).includes(identityKey));
            if (identityIndex >= 0) return identityIndex;
        }

        const remoteIndex = findMessageIndexByRemoteIndex(messages, fallbackRemoteIndex);
        if (remoteIndex >= 0) return remoteIndex;

        const liveText = extractChatGptUserQueryText(element);
        const comparable = getComparableMessageText(liveText);
        if (!comparable) return -1;

        const compatibleIndexes = messages.reduce((indexes, message, index) => {
            if (isComparableTextMatch(getComparableMessageText(message.text), comparable)) {
                indexes.push(index);
            }
            return indexes;
        }, []);
        return compatibleIndexes.length === 1 ? compatibleIndexes[0] : -1;
    }

    function getChatGptActiveCandidates(messages, container) {
        const candidates = [];
        const seen = new Set();

        messages.forEach((message, index) => {
            const remoteIndex = getMessageRemoteIndex(message, index);
            const slot = getChatGptUserSlotElement(remoteIndex);
            if (!slot || !slot.isConnected) return;

            const top = getElementAbsoluteTop(slot, container);
            if (typeof top !== 'number') return;

            candidates.push({
                index,
                top,
                source: getChatGptSlotSource(slot, remoteIndex) || 'message-slot'
            });
        });

        getCurrentTextAlignmentMatches().forEach((match) => {
            const element = match.element;
            if (!element || !element.isConnected || !isVisibleElement(element)) return;

            const index = findMessageIndexForLiveChatGptElement(messages, element, match.remoteIndex);
            if (index < 0) return;

            const top = getElementAbsoluteTop(element, container);
            if (typeof top !== 'number') return;

            candidates.push({
                index,
                top,
                source: match.source || 'live-text'
            });
        });

        getCurrentChatGptTurnAlignmentMatches().forEach((match) => {
            const element = match.element;
            if (!element || !element.isConnected || !isVisibleElement(element)) return;

            const top = getElementAbsoluteTop(element, container);
            if (typeof top !== 'number') return;

            candidates.push({
                index: match.remoteIndex,
                top,
                source: `${match.source}-${match.role || 'message'}`
            });
        });

        messages.forEach((message, index) => {
            const target = getMessageTarget(message);
            if (!target || !target.isConnected || !isVisibleElement(target)) return;

            const top = getMessageAbsoluteTop(message, container);
            if (typeof top !== 'number') return;

            candidates.push({
                index,
                top,
                source: message.anchorSource || 'message-anchor'
            });
        });

        return candidates
            .sort((a, b) => {
                if (a.top !== b.top) return a.top - b.top;
                return a.index - b.index;
            })
            .filter((candidate) => {
                if (seen.has(candidate.index)) return false;
                seen.add(candidate.index);
                return true;
            });
    }

    function findChatGptActiveMessageIndex(messages) {
        const container = getActiveScrollContainer();
        const candidates = getChatGptActiveCandidates(messages, container);
        if (!candidates.length) {
            const previousIndex = STATE.activeIndex >= 0 ? clampMessageIndex(STATE.activeIndex) : -1;
            STATE.lastActiveDebug = {
                mode: previousIndex >= 0 ? 'hold-previous-no-visible-candidates' : 'no-candidates',
                index: previousIndex
            };
            return previousIndex;
        }

        const threshold = getActiveThreshold(container);
        let active = null;
        for (let i = 0; i < candidates.length; i++) {
            if (candidates[i].top <= threshold + 12) {
                active = candidates[i];
            } else {
                break;
            }
        }

        if (!active) {
            const previousIndex = STATE.activeIndex >= 0 ? clampMessageIndex(STATE.activeIndex) : -1;
            active = previousIndex >= 0 && previousIndex < candidates[0].index
                ? { index: previousIndex, top: threshold, source: 'hold-previous-before-next-turn' }
                : candidates[0];
        }

        STATE.lastActiveDebug = {
            mode: 'chatgpt-visible-candidates',
            index: active.index,
            threshold: Math.round(threshold),
            candidates: candidates.slice(0, 8).map((candidate) => ({
                index: candidate.index,
                top: Math.round(candidate.top),
                source: candidate.source
            }))
        };
        return active.index;
    }

    function findClaudeActiveMessageIndex(messages) {
        const container = getActiveScrollContainer();
        const candidates = messages.reduce((result, message, index) => {
            const target = getMessageTarget(message);
            if (!target || !target.isConnected || !isVisibleElement(target)) return result;
            const top = getMessageAbsoluteTop(message, container);
            if (typeof top === 'number') result.push({ index, top });
            return result;
        }, []).sort((a, b) => a.top - b.top);

        if (!candidates.length) {
            return STATE.activeIndex >= 0 ? clampMessageIndex(STATE.activeIndex) : -1;
        }

        const threshold = getActiveThreshold(container);
        let active = candidates[0];
        for (let i = 0; i < candidates.length; i++) {
            if (candidates[i].top <= threshold + 12) active = candidates[i];
            else break;
        }
        return active.index;
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

    function getBubbleLabel() {
        return ADAPTER.label || ADAPTER.id;
    }

    function setButtonText(btn, text, className) {
        while (btn.firstChild) btn.removeChild(btn.firstChild);
        const label = document.createElement('span');
        label.className = className || '';
        label.textContent = text;
        btn.appendChild(label);
    }

    function markTocUserScroll(duration) {
        STATE.tocUserScrollUntil = Date.now() + (typeof duration === 'number' ? duration : TIMINGS.tocFollowPause);
    }

    function pauseTocFollowForNavigation() {
        markTocUserScroll(5000);
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

        if (ADAPTER.id === 'chatgpt') {
            const chatGptActiveIndex = findChatGptActiveMessageIndex(messages);
            if (chatGptActiveIndex >= 0) return chatGptActiveIndex;
            return STATE.activeIndex >= 0 ? clampMessageIndex(STATE.activeIndex) : 0;
        }

        if (ADAPTER.id === 'claude') {
            const claudeActiveIndex = findClaudeActiveMessageIndex(messages);
            if (claudeActiveIndex >= 0) return claudeActiveIndex;
            return STATE.activeIndex >= 0 ? clampMessageIndex(STATE.activeIndex) : 0;
        }

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

    function clearAutoCollapseTimer() {
        if (!STATE.autoCollapseTimer) return;
        window.clearTimeout(STATE.autoCollapseTimer);
        STATE.autoCollapseTimer = 0;
    }

    function hasSearchInputValue(panel) {
        const input = panel ? panel.querySelector('.toc-search input') : null;
        return !!(input && input.value.trim());
    }

    function shouldKeepPanelExpanded(panel) {
        if (!panel || panel.classList.contains('toc-collapsed')) return true;
        if (hasSearchInputValue(panel)) return true;
        if (panel.contains(document.activeElement)) return true;
        if (panel.matches(':hover')) return true;
        if (panel.querySelector('.toc-btn:disabled')) return true;
        return false;
    }

    function scheduleAutoCollapse() {
        clearAutoCollapseTimer();
        if (!CONFIG.autoCollapse) return;

        const panel = getPanelElement();
        if (shouldKeepPanelExpanded(panel)) return;

        STATE.autoCollapseTimer = window.setTimeout(() => {
            STATE.autoCollapseTimer = 0;
            const currentPanel = getPanelElement();
            if (!currentPanel || shouldKeepPanelExpanded(currentPanel)) {
                scheduleAutoCollapse();
                return;
            }
            setPanelCollapsed(currentPanel, true);
        }, CONFIG.autoCollapseDelay);
    }

    function notePanelActivity() {
        const panel = getPanelElement();
        if (!panel || panel.classList.contains('toc-collapsed')) return;
        clearAutoCollapseTimer();
        window.setTimeout(scheduleAutoCollapse, 0);
    }

    function bindPanelActivity(panel) {
        panel.addEventListener('pointerenter', clearAutoCollapseTimer);
        panel.addEventListener('pointerleave', scheduleAutoCollapse);
        panel.addEventListener('focusin', clearAutoCollapseTimer);
        panel.addEventListener('focusout', () => window.setTimeout(scheduleAutoCollapse, 0));
        panel.addEventListener('click', notePanelActivity);
        panel.addEventListener('input', notePanelActivity);
        panel.addEventListener('keydown', notePanelActivity);
        panel.addEventListener('wheel', notePanelActivity, { passive: true });
        panel.addEventListener('touchmove', notePanelActivity, { passive: true });
        panel.addEventListener('scroll', notePanelActivity, { passive: true });
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
        const list = getTocList();
        const items = Array.from(document.querySelectorAll('.toc-item'));
        const keyword = value.trim().toLowerCase();
        let visibleCount = 0;

        items.forEach((item) => {
            const text = item.getAttribute('data-text') || '';
            const hidden = !!keyword && !text.includes(keyword);
            item.classList.toggle('toc-hidden', hidden);
            if (!hidden) visibleCount++;
        });

        setNoResultsState(list, !!keyword && items.length > 0 && visibleCount === 0);
    }

    function setNoResultsState(list, visible) {
        if (!list) return;

        let item = list.querySelector('.toc-no-results');
        if (!visible) {
            if (item) item.remove();
            return;
        }

        if (!item) {
            item = document.createElement('li');
            item.className = 'toc-status toc-no-results';
            item.textContent = '\u65e0\u5339\u914d\u7ed3\u679c';
            list.appendChild(item);
        }
    }

    function updateSearchState(input) {
        const search = input.closest('.toc-search');
        if (search) {
            search.classList.toggle('has-value', !!input.value);
        }
        filterList(input.value);
    }

    function handleSearchInput(event) {
        updateSearchState(event.target);
        notePanelActivity();
    }

    function clearSearchInput() {
        const input = document.querySelector('.toc-search input');
        if (!input) return;

        input.value = '';
        updateSearchState(input);
        input.focus();
        notePanelActivity();
    }

    function handleTocUserWheel() {
        markTocUserScroll(TIMINGS.tocUserScroll);
        notePanelActivity();
    }

    function handleTocListScroll() {
        if (!STATE.tocSyncing) {
            markTocUserScroll(TIMINGS.tocUserScroll);
            notePanelActivity();
        }
    }

    function triggerBottomBoundaryNavigation() {
        const panel = getPanelElement();
        const bottomButton = panel ? panel.querySelector('.toc-actions .toc-btn:last-child') : null;
        if (bottomButton) {
            handleBot.call(bottomButton);
        }
    }

    async function handleTocItemClick(event, list) {
        const item = event.target.closest('.toc-item');
        if (!item || !list.contains(item)) return;

        const index = Number(item.dataset.index);
        const msg = STATE.messages[index];
        if (!msg) return;

        const clickedText = (item.querySelector('.toc-text') ? item.querySelector('.toc-text').textContent : item.textContent || '').trim();
        STATE.lastTocClick = {
            index,
            clickedText,
            messageText: msg.text,
            remoteIndex: getMessageRemoteIndex(msg, index),
            nativeTocIndex: typeof msg.nativeTocIndex === 'number' ? msg.nativeTocIndex : null,
            nativeTocText: msg.nativeTocText || '',
            identityKeys: getMessageIdentityKeys(msg)
        };

        notePanelActivity();
        pauseTocFollowForNavigation();
        STATE.clickLockIndex = index;
        setActiveIndex(index);

        if (ADAPTER.id === 'chatgpt') {
            clearManualActiveIndex();
            const nativeHandled = await navigateWithChatGptNativeToc(msg, index);
            if (nativeHandled) return;

            const remoteHandled = await navigateWithChatGptRemoteToc(msg, index);
            if (remoteHandled) return;

            if (!nativeHandled && !(STATE.lastNavigationDebug && /^remote-/.test(STATE.lastNavigationDebug.mode || ''))) {
                STATE.lastNavigationDebug = {
                    mode: 'chatgpt-navigation-unavailable',
                    index,
                    remoteIndex: getMessageRemoteIndex(msg, index),
                    nativeTocIndex: typeof msg.nativeTocIndex === 'number' ? msg.nativeTocIndex : null,
                    nativeTocMessages: getChatGptNativeTocEntries().length,
                    remoteMessages: STATE.remoteMessages.length,
                    text: msg.text.slice(0, 80)
                };
            }
            return;
        }

        if (ADAPTER.id === 'claude') {
            holdManualActiveIndex(index);
            const directMatch = findClaudeDirectUserElement(msg, index);
            if (!directMatch) {
                STATE.lastNavigationDebug = {
                    mode: 'claude-reference-target-unavailable',
                    index,
                    identityKeys: getMessageIdentityKeys(msg),
                    directDomMessages: STATE.claudeDirectDomMessages,
                    text: msg.text.slice(0, 80)
                };
                return;
            }
            STATE.lastNavigationDebug = {
                mode: `claude-${directMatch.source}`,
                index,
                identityKeys: getMessageIdentityKeys(msg),
                directDomMessages: STATE.claudeDirectDomMessages,
                targetText: normalizeMessageText(directMatch.element).slice(0, 80)
            };
            scrollExactUserElementIntoView(directMatch.element, index, 'auto');
            return;
        }

        holdManualActiveIndex(index, TIMINGS.virtualSeekInterval * TIMINGS.virtualSeekMaxAttempts);

        if (isMessageConnected(msg)) {
            holdManualActiveIndex(index);
            const liveMatch = findLiveUserElementForMessage(msg, index);
            if (liveMatch) {
                STATE.lastNavigationDebug = {
                    mode: liveMatch.source === 'id' ? 'connected-id-hit' : `connected-${liveMatch.source}-hit`,
                    index,
                    identityKeys: getMessageIdentityKeys(msg),
                    anchorSource: liveMatch.source,
                    liveIndex: typeof liveMatch.liveIndex === 'number' ? liveMatch.liveIndex : null,
                    domIdentityKey: liveMatch.domIdentityKey || '',
                    targetText: normalizeMessageText(liveMatch.element).slice(0, 80)
                };
                scrollExactUserElementIntoView(liveMatch.element, index, 'auto');
            } else {
                STATE.lastNavigationDebug = {
                    mode: 'connected-fallback',
                    index,
                    identityKeys: getMessageIdentityKeys(msg),
                    text: msg.text.slice(0, 80)
                };
                scrollMessageIntoView(msg, index);
            }
            return;
        }

        scrollVirtualMessageIntoView(msg, index);
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
        panel.classList.add('toc-dragging');

        function onMove(moveEvent) {
            const next = getConstrainedPanelPosition(
                panel,
                startLeft + (moveEvent.clientX - startX),
                startTop + (moveEvent.clientY - startY)
            );
            panel.style.left = `${next.left}px`;
            panel.style.top = `${next.top}px`;
            panel.style.right = 'auto';
        }

        function onUp() {
            panel.classList.remove('toc-dragging');
            if (panel.classList.contains('toc-collapsed')) {
                applyBubblePosition(panel, getBubblePositionFromCurrentPanel(panel));
            }
            saveCurrentPanelPosition(panel);
            scheduleAutoCollapse();
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
            constrainPanelToViewport(getPanelElement(), true);
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

    function createActionButton(title, iconKey, handler, className) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = className ? `toc-btn ${className}` : 'toc-btn';
        button.title = title;
        button.setAttribute('aria-label', title);
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
        btnGroup.className = 'toc-actions';
        btnGroup.append(
            createActionButton('\u6298\u53e0\u9762\u677f', 'collapse', togglePanelCollapsed, 'toc-collapse-btn'),
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

        const clearButton = createActionButton('\u6e05\u7a7a\u641c\u7d22', 'clear', clearSearchInput, 'toc-clear-btn');

        searchDiv.append(searchIcon, input, clearButton);
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

    function preserveTocActiveState(list, previousActiveIndex, total) {
        const preservedIndex = previousActiveIndex >= 0 && previousActiveIndex < total
            ? previousActiveIndex
            : -1;
        Array.from(list.querySelectorAll('.toc-active')).forEach((item) => {
            item.classList.remove('toc-active');
        });
        STATE.activeIndex = preservedIndex;
        if (preservedIndex >= 0 && list.children[preservedIndex]) {
            list.children[preservedIndex].classList.add('toc-active');
        }
        if (STATE.clickLockIndex >= total) {
            STATE.clickLockIndex = -1;
        }
        if (STATE.manualActiveIndex >= total) {
            clearManualActiveIndex();
        }
    }

    function syncTocSearchFilter() {
        const input = document.querySelector('.toc-search input');
        if (input && input.value) {
            updateSearchState(input);
        }
    }

    function finalizeRenderedToc(list, previousActiveIndex, total) {
        preserveTocActiveState(list, previousActiveIndex, total);
        syncTocSearchFilter();
        bindScrollSync();
        refreshPositionCache();
        scheduleActiveSync();
    }

    function collectCurrentMessages() {
        let messages = collectMessagesFromAdapter(ADAPTER);
        if (ADAPTER.id === 'chatgpt') {
            const context = getChatGptMessageCacheContext();
            if (STATE.messageListContext !== context) {
                STATE.messageListContext = context;
                STATE.messages = [];
            }
            if (
                STATE.remoteMessageContext !== context ||
                !STATE.remoteMessageIsAuthoritative ||
                !STATE.remoteMessages.length
            ) {
                hydrateChatGptConversationMessages();
            }
        }
        if (ADAPTER.id === 'claude') {
            STATE.messageListContext = getClaudeMessageContext();
        }
        annotateMessagesWithNativeToc(messages);
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
        restorePanelState(panel);

        bindGlobalInteractionEvents();
        bindPanelDrag(panel, header);
        bindPanelActivity(panel);

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
        installChatGptConversationInterceptors();
        installClaudeConversationInterceptors();
        installClaudeResourceObserver();
        exposeDebugInfo();
        ensureAppRunning();
        if (getPanelElement()) {
            scheduleScan(0);
        }
        window.setInterval(ensureAppRunning, 2000);
    }

    bootstrap();
})();
