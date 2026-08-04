(function(global) {
  'use strict';
  const namespace = global.MDViewer || (global.MDViewer = {});

  function create(options) {
    options = options || {};
    const context = options.context;
    if (!context || typeof context.getPort !== 'function') throw new TypeError('Search requires context');

    const win = options.window || global;
    const document = options.document || win.document;
    const highlightNames = Object.freeze({ all: 'mdv-search-all', current: 'mdv-search-current' });
    let started = false;
    let opened = false;
    let replaceMode = false;
    let editor = null;
    let editorEl = null;
    let sourceEditor = null;
    let bar = null;
    let findInput = null;
    let replaceInput = null;
    let replaceRow = null;
    let caseInput = null;
    let countEl = null;
    let previousButton = null;
    let nextButton = null;
    let replaceButton = null;
    let replaceAllButton = null;
    let matches = [];
    let currentIndex = -1;
    let previewMap = null;
    let ownsFallbackSelection = false;
    const unsubscribers = [];

    function emit(name, payload) { context.emit(name, payload); }
    function makeElement(tag, className, text) {
      const element = document.createElement(tag);
      if (className) element.className = className;
      if (text !== undefined) element.textContent = text;
      return element;
    }

    function ensureStyles() {
      if (document.querySelector('style.mdv-search-style')) return;
      const style = makeElement('style', 'mdv-search-style');
      style.textContent = [
        '.mdv-search-bar{position:fixed;top:8px;right:16px;z-index:10000;display:flex;flex-direction:column;gap:6px;min-width:430px;padding:8px;background:var(--bg-secondary,#fff);color:var(--text-primary,#222);border:1px solid var(--border-color,#d8d8d8);border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,.18);font:13px/1.35 system-ui,sans-serif}',
        '.mdv-search-bar[hidden]{display:none}',
        '.mdv-search-row{display:flex;align-items:center;gap:5px}',
        '.mdv-search-input{min-width:0;flex:1;padding:5px 7px;color:inherit;background:var(--bg-primary,#fff);border:1px solid var(--border-color,#bbb);border-radius:4px;font:inherit}',
        '.mdv-search-button{padding:5px 8px;color:inherit;background:var(--bg-primary,#f5f5f5);border:1px solid var(--border-color,#bbb);border-radius:4px;cursor:pointer;font:inherit;white-space:nowrap}',
        '.mdv-search-button:disabled{opacity:.45;cursor:default}',
        '.mdv-search-case{display:inline-flex;align-items:center;gap:3px;white-space:nowrap;user-select:none}',
        '.mdv-search-count{min-width:52px;text-align:center;white-space:nowrap}',
        '.mdv-search-close{font-size:17px;line-height:1;padding:4px 7px}',
        '::highlight(mdv-search-all){background:#ffe58f;color:inherit}',
        '::highlight(mdv-search-current){background:#ff9f43;color:#111}'
      ].join('\n');
      (document.head || document.documentElement).appendChild(style);
    }

    function button(className, text, label) {
      const element = makeElement('button', 'mdv-search-button ' + className, text);
      element.type = 'button';
      element.setAttribute('aria-label', label);
      element.title = label;
      return element;
    }

    function ensureBar() {
      if (bar) return bar;
      ensureStyles();
      bar = makeElement('div', 'mdv-search-bar');
      bar.hidden = true;
      bar.setAttribute('role', 'search');
      bar.setAttribute('aria-label', '查找和替换');
      bar.setAttribute('aria-hidden', 'true');

      const findRow = makeElement('div', 'mdv-search-row mdv-search-find-row');
      findInput = makeElement('input', 'mdv-search-input mdv-search-find-input');
      findInput.type = 'text';
      findInput.autocomplete = 'off';
      findInput.spellcheck = false;
      findInput.placeholder = '查找';
      findInput.setAttribute('aria-label', '查找内容');
      previousButton = button('mdv-search-previous', '↑', '上一个匹配项');
      nextButton = button('mdv-search-next', '↓', '下一个匹配项');
      countEl = makeElement('span', 'mdv-search-count', '0/0');
      countEl.setAttribute('aria-live', 'polite');
      const caseLabel = makeElement('label', 'mdv-search-case');
      caseInput = makeElement('input', 'mdv-search-case-input');
      caseInput.type = 'checkbox';
      caseInput.setAttribute('aria-label', '区分大小写');
      caseLabel.appendChild(caseInput);
      caseLabel.appendChild(document.createTextNode('区分大小写'));
      const closeButton = button('mdv-search-close', '×', '关闭查找');
      findRow.appendChild(findInput);
      findRow.appendChild(previousButton);
      findRow.appendChild(nextButton);
      findRow.appendChild(countEl);
      findRow.appendChild(caseLabel);
      findRow.appendChild(closeButton);

      replaceRow = makeElement('div', 'mdv-search-row mdv-search-replace-row');
      replaceInput = makeElement('input', 'mdv-search-input mdv-search-replace-input');
      replaceInput.type = 'text';
      replaceInput.autocomplete = 'off';
      replaceInput.spellcheck = false;
      replaceInput.placeholder = '替换为';
      replaceInput.setAttribute('aria-label', '替换内容');
      replaceButton = button('mdv-search-replace-current', '替换', '替换当前匹配项');
      replaceAllButton = button('mdv-search-replace-all', '全部替换', '替换全部匹配项');
      replaceRow.appendChild(replaceInput);
      replaceRow.appendChild(replaceButton);
      replaceRow.appendChild(replaceAllButton);
      bar.appendChild(findRow);
      bar.appendChild(replaceRow);
      document.body.appendChild(bar);

      findInput.addEventListener('input', function() { rebuildMatches(0); });
      caseInput.addEventListener('change', function() { rebuildMatches(0); });
      findInput.addEventListener('keydown', function(event) {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        if (event.shiftKey) findPrevious();
        else findNext();
      });
      replaceInput.addEventListener('keydown', function(event) {
        if (event.key === 'Enter') { event.preventDefault(); replaceCurrent(); }
      });
      previousButton.addEventListener('click', findPrevious);
      nextButton.addEventListener('click', findNext);
      replaceButton.addEventListener('click', replaceCurrent);
      replaceAllButton.addEventListener('click', replaceAll);
      closeButton.addEventListener('click', close);
      return bar;
    }

    function isSplitMode() {
      if (context.state.get('isSplitMode') || context.state.get('splitMode')) return true;
      const wrapper = context.elements.editorWrapper;
      const splitClass = function(element) {
        return element && element.classList &&
          (element.classList.contains('split-mode') || element.classList.contains('split-view'));
      };
      if (splitClass(document.body) || splitClass(wrapper)) return true;
      return Boolean(editorEl && sourceEditor && editorEl.offsetParent && sourceEditor.offsetParent);
    }

    function usesSourceEditor() {
      return Boolean(context.state.get('isSourceMode')) || isSplitMode();
    }

    function escapeRegExp(value) {
      return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function findLiteralMatches(text, query, caseSensitive) {
      if (!query) return [];
      const result = [];
      const expression = new RegExp(escapeRegExp(query), caseSensitive ? 'g' : 'gi');
      let match;
      while ((match = expression.exec(text)) !== null) {
        result.push({ start: match.index, end: match.index + match[0].length });
        if (match[0].length === 0) expression.lastIndex++;
      }
      return result;
    }

    function skippedPreviewElement(element) {
      if (!element || element === editorEl) return false;
      if (element.getAttribute && element.getAttribute('contenteditable') === 'false') return true;
      if (/^(BUTTON|INPUT|TEXTAREA|SELECT|OPTION)$/i.test(element.tagName || '')) return true;
      if (!element.classList) return false;
      return element.classList.contains('mermaid-container') ||
        element.classList.contains('code-copy-btn') ||
        element.classList.contains('table-cell-tools') ||
        element.classList.contains('tool-button') ||
        element.classList.contains('editor-tool') ||
        element.classList.contains('toolbar');
    }

    function buildPreviewMap() {
      const entries = [];
      const chunks = [];
      let offset = 0;
      const filter = {
        acceptNode: function(node) {
          if (!node.nodeValue) return win.NodeFilter.FILTER_REJECT;
          let parent = node.parentElement;
          while (parent && parent !== editorEl) {
            if (skippedPreviewElement(parent)) return win.NodeFilter.FILTER_REJECT;
            parent = parent.parentElement;
          }
          return win.NodeFilter.FILTER_ACCEPT;
        }
      };
      const walker = document.createTreeWalker(editorEl, win.NodeFilter.SHOW_TEXT, filter);
      let node;
      while ((node = walker.nextNode())) {
        const value = node.nodeValue;
        entries.push({ node: node, start: offset, end: offset + value.length });
        chunks.push(value);
        offset += value.length;
      }
      return { text: chunks.join(''), entries: entries };
    }

    function offsetPoint(offset, endBias) {
      if (!previewMap || !previewMap.entries.length) return null;
      const entries = previewMap.entries;
      for (let index = 0; index < entries.length; index++) {
        const entry = entries[index];
        if (offset < entry.end || (endBias && offset === entry.end)) {
          return { node: entry.node, offset: Math.max(0, offset - entry.start) };
        }
      }
      const last = entries[entries.length - 1];
      return { node: last.node, offset: last.node.nodeValue.length };
    }

    function rangeForMatch(match) {
      const start = offsetPoint(match.start, false);
      const end = offsetPoint(match.end, true);
      if (!start || !end) return null;
      const range = document.createRange();
      try {
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset);
        return range;
      } catch (error) {
        return null;
      }
    }

    function selectionOwnsRange(selection) {
      if (!ownsFallbackSelection || !selection || selection.rangeCount !== 1) return false;
      const range = selection.getRangeAt(0);
      const match = matches[currentIndex];
      const expected = match && rangeForMatch(match);
      return Boolean(expected && range.startContainer === expected.startContainer &&
        range.startOffset === expected.startOffset && range.endContainer === expected.endContainer &&
        range.endOffset === expected.endOffset);
    }

    function clearFallbackSelection() {
      const selection = win.getSelection && win.getSelection();
      if (selectionOwnsRange(selection)) selection.removeAllRanges();
      ownsFallbackSelection = false;
    }

    function clearCustomHighlights() {
      if (!win.CSS || !win.CSS.highlights) return;
      try {
        win.CSS.highlights.delete(highlightNames.all);
        win.CSS.highlights.delete(highlightNames.current);
      } catch (error) {}
    }

    function clearVisuals() {
      clearCustomHighlights();
      clearFallbackSelection();
    }

    function canUseCustomHighlights() {
      return Boolean(win.CSS && win.CSS.highlights && typeof win.Highlight === 'function');
    }

    function scrollRangeIntoView(range) {
      let element = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
      if (element && typeof element.scrollIntoView === 'function') {
        try { element.scrollIntoView({ block: 'center', inline: 'nearest' }); }
        catch (error) { element.scrollIntoView(); }
      }
    }

    function showPreviewMatch() {
      clearVisuals();
      if (currentIndex < 0 || !matches.length) return;
      const ranges = matches.map(rangeForMatch).filter(function(range) { return Boolean(range); });
      const currentRange = rangeForMatch(matches[currentIndex]);
      if (!currentRange) return;
      if (canUseCustomHighlights()) {
        try {
          const allHighlight = new win.Highlight();
          ranges.forEach(function(range) { allHighlight.add(range); });
          const currentHighlight = new win.Highlight();
          currentHighlight.add(currentRange);
          win.CSS.highlights.set(highlightNames.all, allHighlight);
          win.CSS.highlights.set(highlightNames.current, currentHighlight);
        } catch (error) {
          clearCustomHighlights();
          showFallbackSelection(currentRange);
        }
      } else {
        showFallbackSelection(currentRange);
      }
      scrollRangeIntoView(currentRange);
    }

    function showFallbackSelection(range) {
      const selection = win.getSelection && win.getSelection();
      if (!selection) return;
      selection.removeAllRanges();
      selection.addRange(range.cloneRange());
      ownsFallbackSelection = true;
    }

    function showSourceMatch() {
      clearVisuals();
      if (currentIndex < 0 || !matches.length) return;
      const match = matches[currentIndex];
      sourceEditor.focus();
      sourceEditor.setSelectionRange(match.start, match.end, 'forward');
      const computed = win.getComputedStyle ? win.getComputedStyle(sourceEditor) : null;
      const parsedLineHeight = computed ? parseFloat(computed.lineHeight) : NaN;
      const lineHeight = Number.isFinite(parsedLineHeight) ? parsedLineHeight : 20;
      const line = sourceEditor.value.slice(0, match.start).split('\n').length - 1;
      sourceEditor.scrollTop = Math.max(0, line * lineHeight - sourceEditor.clientHeight / 2);
    }

    function updateControls() {
      const total = matches.length;
      countEl.textContent = total ? (currentIndex + 1) + '/' + total : '0/0';
      previousButton.disabled = total === 0;
      nextButton.disabled = total === 0;
      replaceButton.disabled = total === 0;
      replaceAllButton.disabled = total === 0;
    }

    function selectCurrent() {
      updateControls();
      if (usesSourceEditor()) showSourceMatch();
      else showPreviewMatch();
    }

    function indexAtOrAfter(anchor) {
      for (let index = 0; index < matches.length; index++) {
        if (matches[index].start >= anchor) return index;
      }
      return matches.length ? 0 : -1;
    }

    function rebuildMatches(anchor) {
      if (!bar) return false;
      clearVisuals();
      const query = findInput.value;
      const sourceMode = usesSourceEditor();
      previewMap = sourceMode ? null : buildPreviewMap();
      const text = sourceMode ? sourceEditor.value : previewMap.text;
      matches = findLiteralMatches(text, query, caseInput.checked);
      if (!matches.length) currentIndex = -1;
      else if (typeof anchor === 'number') currentIndex = indexAtOrAfter(anchor);
      else if (currentIndex < 0 || currentIndex >= matches.length) currentIndex = 0;
      selectCurrent();
      emit('search:updated', {
        count: matches.length,
        current: currentIndex,
        sourceMode: sourceMode,
        caseSensitive: caseInput.checked
      });
      return matches.length > 0;
    }

    function move(step) {
      if (!opened) open(false);
      if (!findInput.value) { findInput.focus(); return false; }
      if (!matches.length) rebuildMatches();
      if (!matches.length) return false;
      currentIndex = (currentIndex + step + matches.length) % matches.length;
      selectCurrent();
      return true;
    }

    function findNext() { return move(1); }
    function findPrevious() { return move(-1); }

    function dispatchSourceInput() {
      let event;
      if (typeof win.Event === 'function') event = new win.Event('input', { bubbles: true });
      else {
        event = document.createEvent('Event');
        event.initEvent('input', true, false);
      }
      sourceEditor.dispatchEvent(event);
    }

    function notifyReplacement(count, all) {
      emit('search:replaced', { count: count, all: Boolean(all), mode: usesSourceEditor() ? 'source' : 'preview' });
    }

    function replaceCurrent() {
      if (!replaceMode || currentIndex < 0 || !matches.length) return false;
      const match = matches[currentIndex];
      const replacement = replaceInput.value;
      if (usesSourceEditor()) {
        const value = sourceEditor.value;
        sourceEditor.value = value.slice(0, match.start) + replacement + value.slice(match.end);
        dispatchSourceInput();
      } else {
        const range = rangeForMatch(match);
        if (!range) return false;
        clearVisuals();
        range.deleteContents();
        range.insertNode(document.createTextNode(replacement));
        editor.schedulePreviewSync();
      }
      rebuildMatches(match.start + replacement.length);
      notifyReplacement(1, false);
      return true;
    }

    function replaceAll() {
      if (!replaceMode || !matches.length) return 0;
      const replacement = replaceInput.value;
      const count = matches.length;
      if (usesSourceEditor()) {
        let value = sourceEditor.value;
        for (let index = matches.length - 1; index >= 0; index--) {
          const match = matches[index];
          value = value.slice(0, match.start) + replacement + value.slice(match.end);
        }
        sourceEditor.value = value;
        dispatchSourceInput();
      } else {
        const ranges = matches.map(rangeForMatch);
        clearVisuals();
        for (let index = ranges.length - 1; index >= 0; index--) {
          const range = ranges[index];
          if (!range) continue;
          range.deleteContents();
          range.insertNode(document.createTextNode(replacement));
        }
        editor.schedulePreviewSync();
      }
      rebuildMatches(0);
      notifyReplacement(count, true);
      return count;
    }

    function clearSearch() {
      if (!bar) return;
      findInput.value = '';
      replaceInput.value = '';
      matches = [];
      currentIndex = -1;
      previewMap = null;
      clearVisuals();
      updateControls();
    }

    function open(nextReplaceMode) {
      if (!started) start();
      ensureBar();
      replaceMode = Boolean(nextReplaceMode);
      replaceRow.hidden = !replaceMode;
      bar.classList.toggle('mdv-search-replace-mode', replaceMode);
      bar.hidden = false;
      bar.setAttribute('aria-hidden', 'false');
      opened = true;
      if (findInput.value) rebuildMatches();
      else updateControls();
      findInput.focus();
      findInput.select();
      emit('search:opened', { replaceMode: replaceMode });
      return api;
    }

    function close() {
      if (!opened) return false;
      opened = false;
      clearVisuals();
      bar.hidden = true;
      bar.setAttribute('aria-hidden', 'true');
      emit('search:closed', null);
      return true;
    }

    function isOpen() { return opened; }

    function subscribe() {
      unsubscribers.push(context.on('document:replaced', function() {
        if (opened && findInput.value) rebuildMatches();
        else clearVisuals();
      }));
      unsubscribers.push(context.on('file:activated', function() { clearSearch(); }));
      unsubscribers.push(context.on('mode:changed', function() {
        if (opened && findInput.value) rebuildMatches(0);
        else clearVisuals();
      }));
    }

    function start() {
      if (started) return api;
      editor = context.getPort('editor');
      editorEl = context.elements.editor || document.getElementById('editor');
      sourceEditor = context.elements.sourceEditor || document.getElementById('sourceEditor');
      if (!editor || !editorEl || !sourceEditor) throw new Error('Search dependencies are incomplete');
      started = true;
      subscribe();
      return api;
    }

    const api = Object.freeze({
      open: open,
      close: close,
      isOpen: isOpen,
      findNext: findNext,
      findPrevious: findPrevious,
      start: start
    });
    return api;
  }

  namespace.Search = Object.freeze({ create: create });
})(window);