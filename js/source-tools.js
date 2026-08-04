(function(global) {
  'use strict';

  const namespace = global.MDViewer || (global.MDViewer = {});

  function create(options) {
    options = options || {};
    const context = options.context;
    if (!context || !context.elements) throw new TypeError('SourceTools requires context');

    const win = options.window || global;
    const document = options.document || win.document;
    const indentText = typeof options.indentText === 'string' ? options.indentText : '\t';
    let started = false;
    let sourceEditor = null;
    let shell = null;
    let highlightLayer = null;
    let highlightContent = null;
    let gutter = null;
    let lineNumbers = null;
    let currentLine = null;
    let goToLineOverlay = null;
    let goToLineForm = null;
    let goToLineInput = null;
    let goToLineClose = null;
    let fence = null;
    let currentLineMeasurement = null;

    function escapeHtml(value) {
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function element(tagName, className) {
      const node = document.createElement(tagName);
      node.className = className;
      return node;
    }

    function token(className, value) {
      return '<span class="' + className + '">' + escapeHtml(value) + '</span>';
    }

    function earliestInlineToken(value) {
      const candidates = [
        { type: 'code', match: /`+[^`\n]*`+/.exec(value), priority: 0 },
        { type: 'link', match: /!?\[[^\]\n]*\]\([^\)\n]+\)/.exec(value), priority: 1 },
        { type: 'bold', match: /\*\*[^*\n]+\*\*|__[^_\n]+__/.exec(value), priority: 2 }
      ].filter(function(candidate) { return candidate.match; });
      candidates.sort(function(left, right) {
        return left.match.index - right.match.index || left.priority - right.priority;
      });
      return candidates[0] || null;
    }
    function renderInline(value) {
      let remaining = value;
      let html = '';
      while (remaining) {
        const candidate = earliestInlineToken(remaining);
        if (!candidate) return html + escapeHtml(remaining);
        const match = candidate.match;
        html += escapeHtml(remaining.slice(0, match.index));
        if (candidate.type === 'code') {
          html += token('source-token source-token-inline-code', match[0]);
        } else if (candidate.type === 'bold') {
          const marker = match[0].slice(0, 2);
          html += token('source-token source-token-bold-marker', marker) +
            token('source-token source-token-bold', match[0].slice(2, -2)) +
            token('source-token source-token-bold-marker', marker);
        } else {
          const openBracket = match[0].indexOf('[');
          const closeBracket = match[0].indexOf('](', openBracket);
          html += token('source-token source-token-link-marker', match[0].slice(0, openBracket + 1)) +
            token('source-token source-token-link-text', match[0].slice(openBracket + 1, closeBracket)) +
            token('source-token source-token-link-marker', '](') +
            token('source-token source-token-link-url', match[0].slice(closeBracket + 2, -1)) +
            token('source-token source-token-link-marker', ')');
        }
        remaining = remaining.slice(match.index + match[0].length);
      }
      return html;
    }

    function renderTable(value) {
      let html = '';
      let start = 0;
      for (let index = 0; index < value.length; index += 1) {
        if (value[index] !== '|') continue;
        html += renderInline(value.slice(start, index));
        html += token('source-token source-token-table-pipe', '|');
        start = index + 1;
      }
      return html + renderInline(value.slice(start));
    }

    function isTableLine(line) {
      const pipes = (line.match(/\|/g) || []).length;
      return pipes >= 2 || /^\s*\|.*\|\s*$/.test(line) ||
        /^\s*:?-{3,}:?(?:\s*\|\s*:?-{3,}:?)+\s*\|?\s*$/.test(line);
    }

    function renderLine(line) {
      const fenceMatch = /^(\s*)(`{3,}|~{3,})(.*)$/.exec(line);
      if (fence) {
        const isClosing = fenceMatch && fenceMatch[2][0] === fence.character &&
          fenceMatch[2].length >= fence.length;
        if (isClosing) fence = null;
        return {
          className: isClosing ? 'source-line source-line-fence' : 'source-line source-line-code-block',
          html: token(isClosing
            ? 'source-token source-token-fence'
            : 'source-token source-token-code-block', line)
        };
      }
      if (fenceMatch) {
        fence = { character: fenceMatch[2][0], length: fenceMatch[2].length };
        return {
          className: 'source-line source-line-fence',
          html: escapeHtml(fenceMatch[1]) + token('source-token source-token-fence', fenceMatch[2]) +
            token('source-token source-token-fence-info', fenceMatch[3])
        };
      }

      const heading = /^(\s{0,3})(#{1,6})(\s+)(.*)$/.exec(line);
      if (heading) return {
        className: 'source-line source-line-heading source-line-heading-' + heading[2].length,
        html: escapeHtml(heading[1]) + token('source-token source-token-heading-marker', heading[2]) +
          escapeHtml(heading[3]) + '<span class="source-token source-token-heading-text">' +
          renderInline(heading[4]) + '</span>'
      };

      const quote = /^(\s{0,3})(>+)(\s?)(.*)$/.exec(line);
      if (quote) return {
        className: 'source-line source-line-quote',
        html: escapeHtml(quote[1]) + token('source-token source-token-quote-marker', quote[2]) +
          escapeHtml(quote[3]) + '<span class="source-token source-token-quote-text">' +
          renderInline(quote[4]) + '</span>'
      };

      const list = /^(\s*)([-+*]|\d+[.)])(\s+)(.*)$/.exec(line);
      if (list) return {
        className: 'source-line source-line-list',
        html: escapeHtml(list[1]) + token('source-token source-token-list-marker', list[2]) +
          escapeHtml(list[3]) + renderInline(list[4])
      };

      if (isTableLine(line)) return {
        className: 'source-line source-line-table',
        html: renderTable(line)
      };
      return { className: 'source-line', html: renderInline(line) };
    }

    function renderMarkdown(value) {
      fence = null;
      return String(value).split('\n').map(function(line) {
        const rendered = renderLine(line);
        return '<span class="' + rendered.className + '">' + rendered.html + '</span>';
      }).join('\n');
    }
    function createEditorLayers() {
      const existingShell = sourceEditor.closest('.source-editor-shell');
      if (existingShell) {
        shell = existingShell;
        highlightLayer = shell.querySelector('.source-editor-highlight');
        highlightContent = shell.querySelector('.source-editor-highlight-content');
        gutter = shell.querySelector('.source-editor-gutter');
        lineNumbers = shell.querySelector('.source-editor-line-numbers');
        currentLine = shell.querySelector('.source-editor-current-line');
        goToLineOverlay = shell.querySelector('.source-editor-go-to-line');
        goToLineForm = shell.querySelector('.source-editor-go-to-line-form');
        goToLineInput = shell.querySelector('.source-editor-go-to-line-input');
        goToLineClose = shell.querySelector('.source-editor-go-to-line-close');
        return;
      }

      shell = element('div', 'source-editor-shell');
      gutter = element('div', 'source-editor-gutter');
      lineNumbers = element('pre', 'source-editor-line-numbers');
      highlightLayer = element('pre', 'source-editor-highlight');
      highlightContent = element('code', 'source-editor-highlight-content');
      currentLine = element('div', 'source-editor-current-line');
      goToLineOverlay = element('div', 'source-editor-go-to-line');
      goToLineForm = element('form', 'source-editor-go-to-line-form');
      const label = element('label', 'source-editor-go-to-line-label');
      const title = element('span', 'source-editor-go-to-line-title');
      goToLineInput = element('input', 'source-editor-go-to-line-input');
      const submit = element('button', 'source-editor-go-to-line-submit');
      goToLineClose = element('button', 'source-editor-go-to-line-close');

      shell.setAttribute('data-source-editor-enhanced', 'true');
      gutter.setAttribute('aria-hidden', 'true');
      highlightLayer.setAttribute('aria-hidden', 'true');
      currentLine.setAttribute('aria-hidden', 'true');
      goToLineOverlay.hidden = true;
      goToLineOverlay.setAttribute('role', 'dialog');
      goToLineOverlay.setAttribute('aria-modal', 'false');
      goToLineOverlay.setAttribute('aria-label', '跳转到行');
      title.textContent = '跳转到行';
      goToLineInput.type = 'number';
      goToLineInput.min = '1';
      goToLineInput.step = '1';
      goToLineInput.inputMode = 'numeric';
      goToLineInput.setAttribute('aria-label', '行号');
      submit.type = 'submit';
      submit.textContent = '跳转';
      goToLineClose.type = 'button';
      goToLineClose.textContent = '关闭';
      goToLineClose.setAttribute('aria-label', '关闭跳行');

      const parent = sourceEditor.parentNode;
      parent.insertBefore(shell, sourceEditor);
      gutter.appendChild(lineNumbers);
      highlightLayer.appendChild(highlightContent);
      label.append(title, goToLineInput);
      goToLineForm.append(label, submit, goToLineClose);
      goToLineOverlay.appendChild(goToLineForm);
      shell.append(gutter, currentLine, highlightLayer, sourceEditor, goToLineOverlay);
      sourceEditor.classList.add('source-editor-input');
    }

    function lineCount() {
      return sourceEditor.value.split('\n').length;
    }

    function currentLineNumber() {
      return sourceEditor.value.slice(0, sourceEditor.selectionStart).split('\n').length;
    }

    function numericStyle(name, fallback) {
      const value = parseFloat(win.getComputedStyle(sourceEditor)[name]);
      return Number.isFinite(value) ? value : fallback;
    }

    function measureCurrentLine(lineHeight) {
      const computed = win.getComputedStyle(sourceEditor);
      const position = sourceEditor.selectionStart;
      const value = sourceEditor.value;
      const lineStart = value.lastIndexOf('\n', position - 1) + 1;
      let lineEnd = value.indexOf('\n', position);
      if (lineEnd < 0) lineEnd = value.length;
      const mirror = document.createElement('div');
      const marker = document.createElement('span');
      [
        'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing',
        'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'tabSize', 'wordBreak'
      ].forEach(function(name) { mirror.style[name] = computed[name]; });
      mirror.style.position = 'fixed';
      mirror.style.left = '-10000px';
      mirror.style.top = '0';
      mirror.style.visibility = 'hidden';
      mirror.style.pointerEvents = 'none';
      mirror.style.boxSizing = 'border-box';
      mirror.style.width = sourceEditor.clientWidth + 'px';
      mirror.style.height = 'auto';
      mirror.style.minHeight = '0';
      mirror.style.maxHeight = 'none';
      mirror.style.overflow = 'hidden';
      mirror.style.whiteSpace = sourceEditor.wrap === 'off' ? 'pre' : 'pre-wrap';
      mirror.style.overflowWrap = 'break-word';
      mirror.appendChild(document.createTextNode(value.slice(0, lineStart)));
      marker.textContent = value.slice(lineStart, lineEnd) || '\u200b';
      mirror.appendChild(marker);
      document.body.appendChild(mirror);
      const mirrorRect = mirror.getBoundingClientRect();
      const markerRect = marker.getBoundingClientRect();
      const measurement = {
        top: markerRect.top - mirrorRect.top,
        height: Math.max(lineHeight, markerRect.height || lineHeight)
      };
      mirror.remove();
      return measurement;
    }

    function syncScroll() {
      const scrollTop = sourceEditor.scrollTop;
      const scrollLeft = sourceEditor.scrollLeft;
      shell.style.setProperty('--source-scroll-top', String(-scrollTop) + 'px');
      shell.style.setProperty('--source-scroll-left', String(-scrollLeft) + 'px');
      highlightContent.style.transform = 'translate(' + (-scrollLeft) + 'px, ' + (-scrollTop) + 'px)';
      lineNumbers.style.transform = 'translateY(' + (-scrollTop) + 'px)';
      syncCurrentLine();
    }

    function syncCurrentLine(forceMeasure) {
      const number = currentLineNumber();
      const fontSize = numericStyle('fontSize', 16);
      const lineHeight = numericStyle('lineHeight', fontSize * 1.5);
      const signature = sourceEditor.selectionStart + ':' + sourceEditor.clientWidth + ':' + sourceEditor.value.length;
      if (forceMeasure || !currentLineMeasurement || currentLineMeasurement.signature !== signature) {
        currentLineMeasurement = Object.assign({ signature: signature }, measureCurrentLine(lineHeight));
      }
      const measurement = currentLineMeasurement;
      const top = measurement.top - sourceEditor.scrollTop;
      currentLine.dataset.line = String(number);
      currentLine.style.height = measurement.height + 'px';
      currentLine.style.transform = 'translateY(' + top + 'px)';
      shell.style.setProperty('--source-current-line', String(number));
      shell.style.setProperty('--source-current-line-top', top + 'px');
      shell.style.setProperty('--source-line-height', lineHeight + 'px');
    }

    function refresh() {
      if (!started) return start();
      currentLineMeasurement = null;
      const count = lineCount();
      highlightContent.innerHTML = renderMarkdown(sourceEditor.value);
      lineNumbers.textContent = Array.from({ length: count }, function(_, index) {
        return String(index + 1);
      }).join('\n');
      shell.style.setProperty('--source-line-count', String(count));
      goToLineInput.max = String(count);
      syncScroll();
      return api;
    }
    function dispatchInput(inputType) {
      let event;
      try {
        event = new win.InputEvent('input', { bubbles: true, inputType: inputType });
      } catch (error) {
        event = new win.Event('input', { bubbles: true });
      }
      sourceEditor.dispatchEvent(event);
    }

    function selectedLineRange(start, end) {
      const value = sourceEditor.value;
      const blockStart = value.lastIndexOf('\n', start - 1) + 1;
      let effectiveEnd = end;
      if (end > start && value.charAt(end - 1) === '\n') effectiveEnd -= 1;
      let blockEnd = value.indexOf('\n', effectiveEnd);
      if (blockEnd < 0) blockEnd = value.length;
      return { start: blockStart, end: blockEnd, value: value.slice(blockStart, blockEnd) };
    }

    function indentSelection(outdent) {
      const selectionStart = sourceEditor.selectionStart;
      const selectionEnd = sourceEditor.selectionEnd;
      if (!outdent && selectionStart === selectionEnd) {
        sourceEditor.setRangeText(indentText, selectionStart, selectionEnd, 'end');
        dispatchInput('insertText');
        return;
      }

      const range = selectedLineRange(selectionStart, selectionEnd);
      const lines = range.value.split('\n');
      if (!outdent) {
        const replacement = lines.map(function(line) { return indentText + line; }).join('\n');
        sourceEditor.setRangeText(replacement, range.start, range.end, 'preserve');
        sourceEditor.setSelectionRange(
          selectionStart + indentText.length,
          selectionEnd + indentText.length * lines.length
        );
        dispatchInput('insertText');
        return;
      }

      let offset = 0;
      const removals = [];
      const replacement = lines.map(function(line) {
        let length = 0;
        if (line.indexOf('\t') === 0) length = 1;
        else {
          const spaces = /^ {1,4}/.exec(line);
          if (spaces) length = spaces[0].length;
        }
        if (length) removals.push({ position: range.start + offset, length: length });
        offset += line.length + 1;
        return line.slice(length);
      }).join('\n');
      if (!removals.length) return;

      function mapPosition(position) {
        let removed = 0;
        removals.forEach(function(item) {
          if (position >= item.position + item.length) removed += item.length;
          else if (position > item.position) removed += position - item.position;
        });
        return position - removed;
      }

      sourceEditor.setRangeText(replacement, range.start, range.end, 'preserve');
      sourceEditor.setSelectionRange(mapPosition(selectionStart), mapPosition(selectionEnd));
      dispatchInput('deleteContentBackward');
    }

    function positionForLine(lineNumber) {
      let position = 0;
      for (let line = 1; line < lineNumber; line += 1) {
        const next = sourceEditor.value.indexOf('\n', position);
        if (next < 0) return sourceEditor.value.length;
        position = next + 1;
      }
      return position;
    }

    function closeGoToLine() {
      if (!started || goToLineOverlay.hidden) return false;
      goToLineOverlay.hidden = true;
      goToLineOverlay.classList.remove('is-open');
      sourceEditor.focus();
      return true;
    }

    function goToLine(value) {
      const requested = parseInt(value, 10);
      if (!Number.isFinite(requested)) return false;
      const target = Math.max(1, Math.min(lineCount(), requested));
      const position = positionForLine(target);
      const fontSize = numericStyle('fontSize', 16);
      const lineHeight = numericStyle('lineHeight', fontSize * 1.5);
      goToLineOverlay.hidden = true;
      goToLineOverlay.classList.remove('is-open');
      sourceEditor.focus();
      sourceEditor.setSelectionRange(position, position);
      currentLineMeasurement = null;
      sourceEditor.scrollTop = Math.max(0, (target - 1) * lineHeight - sourceEditor.clientHeight / 2);
      syncScroll();
      return true;
    }

    function openGoToLine() {
      if (!started) start();
      goToLineInput.value = String(currentLineNumber());
      goToLineOverlay.hidden = false;
      goToLineOverlay.classList.add('is-open');
      goToLineInput.focus();
      goToLineInput.select();
      return api;
    }

    function isGoToLineOpen() {
      return Boolean(started && goToLineOverlay && !goToLineOverlay.hidden);
    }

    function bind() {
      sourceEditor.addEventListener('scroll', syncScroll);
      sourceEditor.addEventListener('input', refresh);
      ['click', 'keyup', 'select'].forEach(function(eventName) {
        sourceEditor.addEventListener(eventName, function() { syncCurrentLine(true); });
      });
      sourceEditor.addEventListener('keydown', function(event) {
        if (event.key !== 'Tab') return;
        event.preventDefault();
        indentSelection(event.shiftKey);
      });
      goToLineForm.addEventListener('submit', function(event) {
        event.preventDefault();
        if (!goToLine(goToLineInput.value)) {
          goToLineInput.focus();
          goToLineInput.select();
        }
      });
      goToLineClose.addEventListener('click', closeGoToLine);
      goToLineInput.addEventListener('keydown', function(event) {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        closeGoToLine();
      });
      win.addEventListener('resize', function() { syncCurrentLine(true); });
      if (typeof context.on === 'function') {
        context.on('mode:changed', refresh);
        context.on('document:replaced', refresh);
      }
    }

    function start() {
      if (started) return api;
      sourceEditor = context.elements.sourceEditor || document.getElementById('sourceEditor');
      if (!sourceEditor || sourceEditor.tagName !== 'TEXTAREA') {
        throw new Error('SourceTools requires #sourceEditor textarea');
      }
      createEditorLayers();
      if (!highlightLayer || !highlightContent || !gutter || !lineNumbers || !currentLine ||
          !goToLineOverlay || !goToLineForm || !goToLineInput || !goToLineClose) {
        throw new Error('SourceTools could not create editor layers');
      }
      sourceEditor.classList.add('source-editor-input');
      started = true;
      bind();
      refresh();
      return api;
    }

    const api = Object.freeze({
      openGoToLine: openGoToLine,
      closeGoToLine: closeGoToLine,
      isGoToLineOpen: isGoToLineOpen,
      refresh: refresh,
      start: start
    });
    return api;
  }

  namespace.SourceTools = Object.freeze({ create: create });
})(window);
