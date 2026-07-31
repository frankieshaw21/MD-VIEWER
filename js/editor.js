(function(global) {
  'use strict';
  const namespace = global.MDViewer || (global.MDViewer = {});

  function create(options) {
    options = options || {};
    const context = options.context;
    if (!context || typeof context.getPort !== 'function') throw new TypeError('Editor requires context');

    let started = false;
    let parser, tables, history;
    let editorEl, sourceEditor, wordCountEl, lineCountEl, outlineList, editorWrapper;
    let flushTimer = null;
    let idleHandle = null;
    let observerPaused = false;
    let observerTimer = null;
    let outlineTimer = null;
    let composing = false;
    let lastActivityAt = 0;
    let mermaidLoaded = false;
    let mermaidFailed = false;
    let savedColorRange = null;
    let lastSelectionRange = null;
    const textColors = Object.freeze({
      red: '#d83931', orange: '#de7802', yellow: '#dc9b04', green: '#2d9f46',
      blue: '#3370ff', purple: '#7b67ee', gray: '#646a73'
    });

    function emit(name, payload) { context.emit(name, payload); }
    function setState(key, value) {
      const previous = context.state.get(key);
      context.state.set(key, value);
      if (previous !== value) emit('state:changed', { key: key, value: value, previous: previous });
      return value;
    }
    function files() {
      const port = context.getPort('files');
      if (!port) throw new Error('Files port is not available');
      return port;
    }
    function currentFile() { return files().getActiveFile(); }
    function currentIndex() { return files().getActiveIndex(); }
    function isSourceMode() { return Boolean(context.state.get('isSourceMode')); }
    function isPreviewDirty() { return Boolean(context.state.get('previewDirty')); }
    function setPreviewDirty(value) { return setState('previewDirty', Boolean(value)); }
    function updateCounts() {
      const sourceMode = isSourceMode();
      const text = sourceMode ? sourceEditor.value : (editorEl.innerText || '');
      wordCountEl.textContent = '字数: ' + text.replace(/\s/g, '').length;
      lineCountEl.textContent = sourceMode
        ? '段落: ' + (text ? text.split(/\n/).length : 0)
        : '段落: ' + editorEl.children.length;
      emit('document:counts', { characters: text.replace(/\s/g, '').length });
    }

    function cancelFlush() {
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      if (idleHandle !== null) {
        if (global.cancelIdleCallback) global.cancelIdleCallback(idleHandle);
        else clearTimeout(idleHandle);
        idleHandle = null;
      }
    }

    function getContent(optionsValue) {
      const opts = optionsValue || {};
      if (isSourceMode()) return sourceEditor.value;
      if (opts.flush !== false) flushPreviewChanges();
      const active = currentFile();
      return active ? String(active.content || '') : parser.domToMd(editorEl).trim();
    }

    function flushPreviewChanges() {
      cancelFlush();
      if (!isPreviewDirty()) return getContent({ flush: false });
      const content = parser.domToMd(editorEl).trim();
      setPreviewDirty(false);
      files().updateActiveContent(content, { source: 'preview', flushed: true });
      updateCounts();
      emit('document:changed', { content: content, mode: 'preview', flushed: true, activeIndex: currentIndex() });
      return content;
    }

    function idleFlush() {
      flushTimer = null;
      const run = function() { idleHandle = null; flushPreviewChanges(); };
      if (global.requestIdleCallback) idleHandle = global.requestIdleCallback(run, { timeout: 1000 });
      else idleHandle = setTimeout(run, 0);
    }

    function schedulePreviewSync() {
      setPreviewDirty(true);
      lastActivityAt = Date.now();
      cancelFlush();
      const active = currentFile();
      const size = active ? String(active.content || '').length : 0;
      flushTimer = setTimeout(idleFlush, size > 1000000 ? 850 : size > 250000 ? 550 : 350);
      files().setModified(true);
      if (history) history.scheduleHistorySnapshot();
      updateCounts();
      scheduleOutline();
      emit('document:changed', { content: null, mode: 'preview', pending: true });
    }

    function loadMermaidLib() {
      if (typeof global.mermaid !== 'undefined') {
        mermaidLoaded = true;
        return Promise.resolve(global.mermaid);
      }
      if (global._mermaidScriptLoaded && typeof global.mermaid === 'undefined') {
        mermaidFailed = true;
        return Promise.reject(new Error('mermaid.min.js 执行出错 (JS error in file)'));
      }
      return new Promise(function(resolve, reject) {
        const script = document.createElement('script');
        script.src = 'mermaid.min.js?t=' + Date.now();
        script.onload = function() {
          if (typeof global.mermaid === 'undefined') {
            mermaidFailed = true;
            reject(new Error('mermaid.min.js 加载成功但执行失败'));
            return;
          }
          mermaidLoaded = true;
          mermaidFailed = false;
          try {
            global.mermaid.initialize({ startOnLoad: false,
              theme: context.state.get('theme') === 'dark' ? 'dark' : 'default', securityLevel: 'loose' });
          } catch (error) {}
          resolve(global.mermaid);
        };
        script.onerror = function() {
          mermaidFailed = true;
          reject(new Error('mermaid.min.js 加载失败，请确认文件存在'));
        };
        document.head.appendChild(script);
      });
    }

    function renderCodepen() {
      editorEl.querySelectorAll('.codepen-container').forEach(function(container) {
        const iframe = container.querySelector('iframe');
        const source = container.getAttribute('data-codepen-source') || '';
        if (!iframe || !source) return;
        try {
          const doc = iframe.contentDocument || iframe.contentWindow.document;
          doc.open(); doc.write(decodeURIComponent(source)); doc.close();
          setTimeout(function() {
            try {
              const height = iframe.contentDocument.documentElement.scrollHeight;
              if (height > 100) iframe.style.height = Math.min(height + 20, 800) + 'px';
            } catch (error) {}
          }, 500);
        } catch (error) { console.warn('CodePen render failed.', error); }
      });
    }

    async function renderMermaid() {
      const containers = editorEl.querySelectorAll('.mermaid-container');
      if (!containers.length) return;
      try { await loadMermaidLib(); }
      catch (loadError) {
        containers.forEach(function(container) {
          const target = container.querySelector('.mermaid');
          if (!target || target.querySelector('svg') || target.querySelector('pre')) return;
          const raw = container.getAttribute('data-mermaid-source');
          const code = raw ? decodeURIComponent(raw) : target.textContent;
          target.innerHTML = '<pre style="text-align:left;font-size:12px;opacity:.8;margin:0">' +
            parser.escHtml(code) + '</pre><div style="font-size:11px;color:#999;margin-top:6px">（' +
            parser.escHtml(loadError.message || 'mermaid.min.js 加载失败') + '）</div>';
        });
        return;
      }
      for (const container of containers) {
        const target = container.querySelector('.mermaid');
        if (!target || target.querySelector('svg')) continue;
        const raw = container.getAttribute('data-mermaid-source');
        const code = raw ? decodeURIComponent(raw) : target.textContent.trim();
        try {
          const result = await global.mermaid.render('mermaid-' + Date.now() + '-' + Math.random().toString(36).slice(2), code);
          target.innerHTML = result.svg;
        } catch (error) {
          target.innerHTML = '<pre style="color:red;font-size:12px">Mermaid error: ' + parser.escHtml(error.message || String(error)) + '</pre>';
        }
      }
    }

    function enhanceRenderedContent(root) {
      root = root || editorEl;
      const scoped = function(selector) {
        const items = [];
        if (root.nodeType === 1 && root.matches(selector)) items.push(root);
        if (root.querySelectorAll) items.push.apply(items, root.querySelectorAll(selector));
        return items;
      };
      scoped('pre').forEach(function(pre) {
        if (!pre.querySelector(':scope > .code-copy-btn')) {
          const button = document.createElement('button');
          button.type = 'button'; button.className = 'code-copy-btn'; button.textContent = '复制';
          button.contentEditable = 'false'; pre.insertBefore(button, pre.firstChild);
        }
      });
      scoped('a[href]').forEach(function(link) { link.target = '_blank'; link.rel = 'noopener noreferrer'; });
      scoped('input[type="checkbox"]').forEach(function(input) { input.disabled = false; });
      if (tables && tables.normalizeImportedCellBackgrounds) tables.normalizeImportedCellBackgrounds(root);
      scoped('table').forEach(function(table) {
        if (!table.parentElement || table.parentElement.classList.contains('table-wrapper')) return;
        const wrapper = document.createElement('div'); wrapper.className = 'table-wrapper';
        table.parentNode.insertBefore(wrapper, table); wrapper.appendChild(table);
      });
      scoped('ul').forEach(function(list) {
        let taskList = false;
        list.querySelectorAll(':scope > li').forEach(function(item) {
          if (/^\s*<input[^>]*type=["']?checkbox/i.test(item.innerHTML)) taskList = true;
          else if (/^\[[ x]\]\s/i.test(item.innerHTML)) {
            taskList = true;
            const checked = /^\[x\]/i.test(item.innerHTML);
            item.innerHTML = '<input type="checkbox"' + (checked ? ' checked' : '') + '> ' +
              item.innerHTML.replace(/^\[[ x]\]\s*/i, '');
          }
        });
        if (taskList) list.classList.add('task-list');
      });
    }

    function loadMarkdown(markdown, meta) {
      cancelFlush();
      setPreviewDirty(false);
      savedColorRange = null;
      lastSelectionRange = null;
      if (tables) {
        tables.hideTableCellTools();
        tables.clearCellBackgroundHistory();
      }
      if (observerTimer) clearTimeout(observerTimer);
      observerPaused = true;
      const normalized = parser.normalizeMarkdownBeforeRender(String(markdown || ''));
      editorEl.innerHTML = parser.mdToHtml(normalized);
      enhanceRenderedContent(editorEl);
      renderCodepen();
      renderMermaid().finally(function() {
        emit('render:completed', { content: normalized, meta: meta || null });
      });
      updateCounts();
      scheduleOutline();
      observerTimer = setTimeout(function() { observerPaused = false; observerTimer = null; }, 150);
      return normalized;
    }

    function replaceDocument(content, meta) {
      const value = String(content || '');
      cancelFlush();
      setPreviewDirty(false);
      if (isSourceMode()) sourceEditor.value = value;
      else loadMarkdown(value, meta);
      updateCounts();
      scheduleOutline();
      emit('document:replaced', { content: value, mode: isSourceMode() ? 'source' : 'preview', meta: meta || null });
      return true;
    }

    function setContent(content, meta) {
      return replaceDocument(content, meta || { source: 'editor-api' });
    }

    function showEmpty() {
      cancelFlush();
      setPreviewDirty(false);
      sourceEditor.value = '';
      editorEl.innerHTML = '<div class="welcome"><div class="welcome-icon">📝</div><h2>Markdown Editor</h2><p><kbd>Ctrl+O</kbd> 打开文件&emsp;<kbd>Ctrl+S</kbd> 保存&emsp;<kbd>Ctrl+/</kbd> 源码模式</p></div>';
      updateCounts();
      emit('document:replaced', { content: '', empty: true });
    }

    function toggleSource() {
      if (tables) tables.hideTableCellTools();
      const ui = context.getPort('ui');
      if (ui) ui.hideTextColorPalette();
      const sourceMode = isSourceMode();
      let content;
      if (!sourceMode) {
        content = flushPreviewChanges();
        if (content === undefined) content = getContent({ flush: false });
      } else content = sourceEditor.value;
      const nextMode = !sourceMode;
      setState('isSourceMode', nextMode);
      document.body.classList.toggle('source-mode', nextMode);
      const button = document.getElementById('sourceBtn');
      if (button) button.classList.toggle('active', nextMode);
      if (nextMode) { sourceEditor.value = content || ''; sourceEditor.focus(); }
      else loadMarkdown(content || '', { source: 'mode-switch' });
      updateCounts();
      updateOutline();
      emit('mode:changed', { sourceMode: nextMode, content: content || '' });
      return nextMode;
    }

    function sourceInsert(before, after, placeholder) {
      const start = sourceEditor.selectionStart;
      const end = sourceEditor.selectionEnd;
      const selected = sourceEditor.value.slice(start, end) || placeholder || '';
      sourceEditor.setRangeText(before + selected + after, start, end, 'select');
      sourceEditor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
      sourceEditor.focus();
    }

    function fmt(command) {
      document.execCommand(command, false, null);
      editorEl.focus();
      schedulePreviewSync();
      history.scheduleHistorySnapshot();
    }

    function insertEditorNode(node, trailingParagraph) {
      const fragment = document.createDocumentFragment();
      fragment.appendChild(node);
      if (trailingParagraph) {
        const paragraph = document.createElement('p'); paragraph.innerHTML = '<br>'; fragment.appendChild(paragraph);
      }
      const selection = global.getSelection();
      if (selection.rangeCount) {
        const range = selection.getRangeAt(0);
        const owner = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
        if (owner && editorEl.contains(owner)) { range.deleteContents(); range.insertNode(fragment); }
        else editorEl.appendChild(fragment);
      } else editorEl.appendChild(fragment);
      enhanceRenderedContent(editorEl); schedulePreviewSync(); history.scheduleHistorySnapshot(); editorEl.focus();
    }

    function insertHeading(level) {
      const selection = global.getSelection();
      if (!selection.rangeCount) return;
      const range = selection.getRangeAt(0);
      let block = range.startContainer;
      while (block && block !== editorEl && block.nodeType !== 1) block = block.parentNode;
      if (!block || block === editorEl) document.execCommand('formatBlock', false, 'h' + level);
      else {
        const heading = document.createElement('h' + level); heading.innerHTML = block.innerHTML;
        block.parentNode.replaceChild(heading, block);
      }
      editorEl.focus(); schedulePreviewSync();
    }
    function insertCodeBlock() {
      const language = prompt('语言（如 javascript, python, mermaid）:', '');
      const code = prompt('代码:', '');
      if (language === 'mermaid') return insertMermaidWithCode(code || 'graph TD\n    A-->B');
      const pre = document.createElement('pre');
      const codeElement = document.createElement('code');
      codeElement.className = language ? 'language-' + language : '';
      codeElement.textContent = code || '// code';
      if (language) {
        const label = document.createElement('span'); label.className = 'code-lang-label'; label.textContent = language;
        pre.appendChild(label);
      }
      pre.appendChild(codeElement); insertEditorNode(pre, false);
    }
    function insertMermaid() {
      const code = prompt('Mermaid 代码:', 'graph TD\n    A-->B');
      if (code) insertMermaidWithCode(code);
    }
    async function insertMermaidWithCode(code) {
      const container = document.createElement('div');
      container.className = 'mermaid-container'; container.contentEditable = 'false';
      container.setAttribute('data-mermaid-source', encodeURIComponent(code));
      const target = document.createElement('div'); target.className = 'mermaid'; container.appendChild(target);
      try {
        await loadMermaidLib();
        const result = await global.mermaid.render('mermaid-insert-' + Date.now() + '-' + Math.random().toString(36).slice(2), code);
        target.innerHTML = result.svg;
      } catch (error) {
        target.innerHTML = '<pre style="text-align:left;font-size:12px">' + parser.escHtml(code) +
          '</pre><div style="font-size:11px;color:#999">（mermaid.min.js 加载失败）</div>';
      }
      insertEditorNode(container, false);
    }
    function insertLink() {
      const url = prompt('URL:', 'https://'); if (!url) return;
      const text = global.getSelection().toString() || prompt('文字:', url);
      document.execCommand('insertHTML', false, '<a href="' + url + '">' + text + '</a>'); schedulePreviewSync();
    }
    function insertImage() {
      const url = prompt('图片 URL（HTTP/HTTPS）:', 'https://');
      if (!url || !/^https?:\/\//i.test(url)) return;
      const image = document.createElement('img'); image.src = url; image.alt = prompt('图片说明:', '') || '';
      insertEditorNode(image, true);
    }
    function insertQuote() {
      const text = global.getSelection().toString() || prompt('引用内容:', '引用内容'); if (!text) return;
      const quote = document.createElement('blockquote'); const paragraph = document.createElement('p');
      paragraph.textContent = text; quote.appendChild(paragraph); insertEditorNode(quote, true);
    }
    function insertChecklist() {
      const text = prompt('待办内容:', '待办事项'); if (!text) return;
      const list = document.createElement('ul'); list.className = 'task-list';
      const item = document.createElement('li'); const checkbox = document.createElement('input'); checkbox.type = 'checkbox';
      item.append(checkbox, document.createTextNode(' ' + text)); list.appendChild(item); insertEditorNode(list, true);
    }
    function insertTable() {
      const columnInput = prompt('列数（1-20）:', '3'); if (columnInput === null) return;
      const rowInput = prompt('数据行数（1-50）:', '2'); if (rowInput === null) return;
      const columns = Math.max(1, Math.min(20, Number(columnInput) || 1));
      const rows = Math.max(1, Math.min(50, Number(rowInput) || 1));
      const table = document.createElement('table'); const headRow = table.createTHead().insertRow();
      for (let column = 0; column < columns; column++) {
        const header = document.createElement('th'); header.textContent = '列' + (column + 1); headRow.appendChild(header);
      }
      const body = table.createTBody();
      for (let row = 0; row < rows; row++) {
        const tableRow = body.insertRow();
        for (let column = 0; column < columns; column++) tableRow.insertCell().innerHTML = '<br>';
      }
      insertEditorNode(table, true);
      if (tables) { tables.hideTableCellTools(); tables.setActiveCell(table.querySelector('th,td')); tables.notifyChanged('insert-table'); }
    }
    function insertHR() {
      document.execCommand('insertHTML', false, '<hr><p><br></p>'); schedulePreviewSync();
    }
    function insertHtml(html) {
      editorEl.focus(); document.execCommand('insertHTML', false, html);
      enhanceRenderedContent(editorEl); schedulePreviewSync(); history.scheduleHistorySnapshot();
    }

    function getSelectionRange() {
      const selection = global.getSelection();
      if (!selection || !selection.rangeCount || selection.isCollapsed) return null;
      const range = selection.getRangeAt(0);
      const node = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
      return node && editorEl.contains(node) ? range.cloneRange() : null;
    }
    function rememberSelection() {
      const range = getSelectionRange();
      if (range) lastSelectionRange = range;
      return range;
    }
    function isUsableRange(range) {
      if (!range || range.collapsed) return false;
      const node = range.commonAncestorContainer.nodeType === 1
        ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
      return Boolean(node && node.isConnected && editorEl.contains(node));
    }
    function captureColorSelection() {
      if (isSourceMode()) return false;
      const range = rememberSelection() || lastSelectionRange;
      if (!isUsableRange(range)) return false;
      savedColorRange = range.cloneRange();
      return true;
    }
    function wrapTextNodes(range, token) {
      const segments = [];
      const walker = document.createTreeWalker(editorEl, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (!node.data || !range.intersectsNode(node)) continue;
        if (node.parentElement && node.parentElement.closest('[contenteditable="false"],.code-copy-btn,.code-lang-label')) continue;
        let start = node === range.startContainer ? range.startOffset : 0;
        let end = node === range.endContainer ? range.endOffset : node.data.length;
        start = Math.max(0, Math.min(start, node.data.length)); end = Math.max(start, Math.min(end, node.data.length));
        if (end > start) segments.push({ node: node, start: start, end: end });
      }
      segments.reverse().forEach(function(segment) {
        let selected = segment.node;
        if (segment.end < selected.data.length) selected.splitText(segment.end);
        if (segment.start > 0) selected = selected.splitText(segment.start);
        const span = document.createElement('span'); span.setAttribute('text-color', token);
        selected.parentNode.insertBefore(span, selected); span.appendChild(selected);
      });
      return segments.length > 0;
    }
    function selectionHasColor(range, token) {
      return Array.from(editorEl.querySelectorAll('span,font')).some(function(element) {
        try { return parser.getElementTextColorToken(element) === token && range.intersectsNode(element); }
        catch (error) { return false; }
      });
    }
    function applyTextColor(token) {
      if (!textColors[token] || !isUsableRange(savedColorRange)) return false;
      if (tables) tables.clearCellBackgroundHistory();
      const original = savedColorRange.cloneRange();
      editorEl.focus();
      const selection = global.getSelection(); selection.removeAllRanges(); selection.addRange(original);
      document.execCommand('styleWithCSS', false, 'true');
      const applied = document.execCommand('foreColor', false, textColors[token]);
      const result = selection.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
      if (!applied || !result || !selectionHasColor(result, token)) {
        selection.removeAllRanges(); selection.addRange(original); wrapTextNodes(original, token);
      }
      parser.normalizeTextColorMarkup(editorEl);
      savedColorRange = null; lastSelectionRange = null;
      schedulePreviewSync(); history.scheduleHistorySnapshot();
      return true;
    }
    function getSourceHeadings(markdown) {
      const headings = [];
      let offset = 0;
      let fence = null;
      String(markdown || '').split('\n').forEach(function(line) {
        const clean = line.replace(/\r$/, '');
        const marker = clean.match(/^\s*(`{3,}|~{3,})/);
        if (fence) {
          if (marker && marker[1][0] === fence.char && marker[1].length >= fence.length && /^\s*(`+|~+)\s*$/.test(clean)) fence = null;
        } else if (marker) {
          fence = { char: marker[1][0], length: marker[1].length };
        } else {
          const match = clean.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
          if (match) headings.push({ level: match[1].length, text: match[2], start: offset, end: offset + clean.length });
        }
        offset += line.length + 1;
      });
      return headings;
    }

    function getOutline() {
      if (isSourceMode()) return getSourceHeadings(sourceEditor.value);
      return Array.from(editorEl.querySelectorAll('h1,h2,h3,h4,h5,h6')).map(function(node) {
        return { level: Number(node.tagName.slice(1)), text: node.textContent.trim(), node: node };
      });
    }

    function updateOutline() {
      const headings = getOutline();
      if (!outlineList) return headings;
      outlineList.replaceChildren();
      headings.forEach(function(item, index) {
        const entry = document.createElement('li');
        entry.className = 'h' + item.level;
        entry.dataset.headingIndex = index;
        entry.textContent = item.text;
        outlineList.appendChild(entry);
      });
      return headings;
    }

    function scheduleOutline() {
      if (outlineTimer) clearTimeout(outlineTimer);
      outlineTimer = setTimeout(function() { outlineTimer = null; updateOutline(); }, 120);
    }

    function textareaTop(position) {
      const style = getComputedStyle(sourceEditor);
      const mirror = document.createElement('div');
      ['fontFamily','fontSize','fontWeight','lineHeight','letterSpacing','paddingTop','paddingLeft','paddingRight','tabSize']
        .forEach(function(name) { mirror.style[name] = style[name]; });
      mirror.style.cssText += ';position:fixed;left:-10000px;top:0;visibility:hidden;white-space:pre-wrap;overflow-wrap:break-word;width:' + sourceEditor.clientWidth + 'px';
      mirror.textContent = sourceEditor.value.slice(0, position);
      const marker = document.createElement('span'); marker.textContent = '\u200b'; mirror.appendChild(marker);
      document.body.appendChild(mirror);
      const top = marker.offsetTop;
      mirror.remove();
      return top;
    }

    function scrollToHeading(index) {
      index = Number(index);
      const headings = getOutline();
      const heading = headings[index];
      if (!heading) return false;
      if (isSourceMode()) {
        sourceEditor.focus();
        sourceEditor.setSelectionRange(heading.start, heading.end);
        sourceEditor.scrollTo({ top: Math.max(0, textareaTop(heading.start) - sourceEditor.clientHeight / 3), behavior: 'smooth' });
      } else heading.node.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (outlineList) Array.from(outlineList.children).forEach(function(item, itemIndex) {
        item.classList.toggle('active-heading', itemIndex === index);
      });
      return true;
    }

    function updateActiveHeading() {
      if (isSourceMode() || !outlineList || !editorWrapper) return;
      const headings = editorEl.querySelectorAll('h1,h2,h3,h4,h5,h6');
      let active = 0;
      const top = editorWrapper.getBoundingClientRect().top;
      headings.forEach(function(heading, index) {
        if (heading.getBoundingClientRect().top - top <= 60) active = index;
      });
      Array.from(outlineList.children).forEach(function(item, index) {
        item.classList.toggle('active-heading', index === active);
      });
      const item = outlineList.children[active];
      if (item) item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    function bind() {
      editorEl.addEventListener('input', function() {
        if (tables) tables.clearCellBackgroundHistory();
        schedulePreviewSync(); history.scheduleHistorySnapshot();
      });
      editorEl.addEventListener('change', function(event) {
        if (event.target.matches('input[type="checkbox"]')) schedulePreviewSync();
      });
      sourceEditor.addEventListener('compositionstart', function() { composing = true; });
      sourceEditor.addEventListener('compositionend', function() { composing = false; sourceChanged(); });
      sourceEditor.addEventListener('input', function() { if (!composing) sourceChanged(); });
      document.addEventListener('selectionchange', rememberSelection);
      const pendingRoots = new Set();
      let enhancementScheduled = false;
      const observer = new MutationObserver(function(records) {
        if (observerPaused) return;
        records.forEach(function(record) {
          record.addedNodes.forEach(function(node) {
            const root = node.nodeType === 1 ? node : node.parentElement;
            if (root && editorEl.contains(root)) pendingRoots.add(root);
          });
          if (record.removedNodes.length && record.target && editorEl.contains(record.target)) {
            pendingRoots.add(record.target.nodeType === 1 ? record.target : record.target.parentElement);
          }
        });
        if (enhancementScheduled) return;
        enhancementScheduled = true;
        requestAnimationFrame(function() {
          enhancementScheduled = false;
          if (observerPaused) return;
          const roots = Array.from(pendingRoots).filter(function(root) { return root && root.isConnected; });
          pendingRoots.clear(); observerPaused = true;
          try {
            if (roots.length > 40 || roots.indexOf(editorEl) >= 0) enhanceRenderedContent(editorEl);
            else roots.forEach(enhanceRenderedContent);
            observer.takeRecords();
          } finally { observerPaused = false; }
          emit('render:enhanced', { roots: roots.length });
        });
      });
      observer.observe(editorEl, { childList: true, subtree: true });
    }

    function sourceChanged() {
      const content = sourceEditor.value;
      lastActivityAt = Date.now();
      files().updateActiveContent(content, { source: 'source' });
      updateCounts();
      scheduleOutline();
      history.scheduleHistorySnapshot();
      emit('document:changed', { content: content, mode: 'source', composing: composing });
    }

    function canPersistSession() {
      return !composing && !flushTimer && idleHandle === null && Date.now() - lastActivityAt > 1200;
    }

    function start() {
      if (started) return api;
      editorEl = context.elements.editor;
      sourceEditor = context.elements.sourceEditor;
      wordCountEl = context.elements.wordCount;
      lineCountEl = context.elements.lineCount;
      outlineList = context.elements.outlineList;
      editorWrapper = context.elements.editorWrapper;
      parser = context.getPort('parser');
      tables = context.getPort('tables');
      history = context.getPort('history');
      if (!editorEl || !sourceEditor || !parser || !history) throw new Error('Editor dependencies are incomplete');
      started = true;
      setState('isSourceMode', Boolean(context.state.get('isSourceMode')));
      setPreviewDirty(Boolean(context.state.get('previewDirty')));
      bind();
      enhanceRenderedContent(editorEl);
      updateCounts();
      updateOutline();
      return api;
    }

    const commands = {
      fmt: fmt, insertHeading: insertHeading, insertCodeBlock: insertCodeBlock,
      insertLink: insertLink, insertImage: insertImage, insertQuote: insertQuote,
      insertChecklist: insertChecklist, insertTable: insertTable, insertHR: insertHR,
      insertMermaid: insertMermaid, toggleSource: toggleSource,
      loadMarkdown: loadMarkdown, render: loadMarkdown, replaceDocument: replaceDocument, setContent: setContent,
      showEmpty: showEmpty, getContent: getContent, schedulePreviewSync: schedulePreviewSync,
      flushPreviewChanges: flushPreviewChanges, enhanceRenderedContent: enhanceRenderedContent,
      captureColorSelection: captureColorSelection, applyTextColor: applyTextColor,
      rememberSelection: rememberSelection, isSourceMode: isSourceMode,
      getOutline: getOutline, updateOutline: updateOutline, scheduleOutline: scheduleOutline,
      scrollToHeading: scrollToHeading, updateActiveHeading: updateActiveHeading
    };
    function invoke(name, args) {
      const command = commands[name];
      if (typeof command !== 'function') throw new Error('Unknown editor command: ' + name);
      return command.apply(null, args || []);
    }
    const api = Object.freeze({
      start: start, invoke: invoke,
      getContent: getContent, setContent: setContent, replaceContent: replaceDocument, replaceDocument: replaceDocument,
      load: loadMarkdown, render: loadMarkdown, flush: flushPreviewChanges, schedule: schedulePreviewSync,
      showEmpty: showEmpty, schedulePreviewSync: schedulePreviewSync, flushPreviewChanges: flushPreviewChanges,
      isSourceMode: isSourceMode, canPersistSession: canPersistSession,
      getOutline: getOutline, updateOutline: updateOutline, scheduleOutline: scheduleOutline,
      scrollToHeading: scrollToHeading, updateActiveHeading: updateActiveHeading,
      captureColorSelection: captureColorSelection, applyTextColor: applyTextColor
    });
    return api;
  }

  namespace.Editor = Object.freeze({ create: create });
})(window);