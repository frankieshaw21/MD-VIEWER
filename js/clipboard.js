(function(global) {
  'use strict';

  const namespace = global.MDViewer || (global.MDViewer = {});

  function create(options) {
    options = options || {};
    const win = options.window || global;
    const document = options.document || win.document;
    const location = options.location || win.location;
    const textColors = options.textColors || {};
    const context = options.context;
    if (!context || typeof context.getPort !== 'function') throw new TypeError('Clipboard requires context');
    const editor = context.elements.editor;
    const sourceEditor = context.elements.sourceEditor;
    const parser = context.getPort('parser');
    const tables = context.getPort('tables');
    const isSourceMode = function() { return context.getPort('editor').invoke('isSourceMode'); };
    const schedulePreviewSync = function() { return context.getPort('editor').invoke('schedulePreviewSync'); };
    const removers = [];
    let bound = false;

    if (!document || !editor || !sourceEditor) throw new TypeError('Clipboard requires document and editors');
    if (!parser || typeof parser.mdToHtml !== 'function' || typeof parser.domToMd !== 'function') {
      throw new TypeError('Clipboard requires a parser');
    }
    if (!tables || typeof tables.buildTableGrid !== 'function' || typeof tables.createFeishuTableClone !== 'function') {
      throw new TypeError('Clipboard requires tables');
    }
    if (typeof isSourceMode !== 'function') throw new TypeError('Clipboard requires isSourceMode');

    function emit(eventName, type, mode) {
      if (context && typeof context.emit === 'function') context.emit(eventName, { type: type, mode: mode });
    }

    function normalizeFeishuTextColorsForExport(root) {
      root.querySelectorAll('span').forEach(function(span) {
        const token = parser.getElementTextColorToken(span);
        Array.from(span.attributes).forEach(function(attribute) { span.removeAttribute(attribute.name); });
        if (token && textColors[token]) {
          span.setAttribute('text-color', token);
          span.style.color = textColors[token];
        }
      });
    }


    function getClipboardCellText(cell) {
      const clone = cell.cloneNode(true);
      clone.querySelectorAll('br').forEach(function(br) { br.replaceWith('\n'); });
      return (clone.textContent || '').replace(/\s*\n\s*/g, ' / ').trim();
    }

    function getFeishuTableText(table) {
      const grid = tables.buildTableGrid(table).grid;
      const columnCount = Math.max.apply(Math, [1].concat(grid.map(function(row) { return row.length; })));
      return grid.map(function(row, rowIndex) {
        const values = [];
        for (let columnIndex = 0; columnIndex < columnCount; columnIndex++) {
          const entry = row[columnIndex];
          values.push(entry && entry.originRow === rowIndex && entry.originCol === columnIndex ? getClipboardCellText(entry.cell) : '');
        }
        return values.join('\t');
      }).join('\r\n');
    }

    function createFeishuHtmlShell(fragmentHtml, spreadsheetMode) {
      const namespaces = spreadsheetMode
        ? ' xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"'
        : '';
      const spreadsheetMeta = spreadsheetMode
        ? '<meta name="ProgId" content="Excel.Sheet"><meta name="Generator" content="Microsoft Excel 16">'
        : '<meta name="Generator" content="Kiro Markdown Viewer">';
      return '<html' + namespaces + '><head><meta charset="utf-8">' + spreadsheetMeta +
        '<style>body{font-family:Arial,sans-serif;}br{mso-data-placement:same-cell;}' +
        'table{border-collapse:collapse;mso-table-layout-alt:fixed;}pre{white-space:pre-wrap;}' +
        'blockquote{border-left:3px solid #d0d3d8;padding-left:10px;margin-left:0;}</style>' +
        '</head><body><!--StartFragment-->' + fragmentHtml + '<!--EndFragment--></body></html>';
    }

    function createFeishuClipboardHtml(table) {
      const clone = tables.createFeishuTableClone(table);
      normalizeFeishuTextColorsForExport(clone);
      return createFeishuHtmlShell(clone.outerHTML, true);
    }

    function setFeishuTableClipboard(event, table, mode) {
      if (!event.clipboardData || !table) return false;
      event.clipboardData.setData('text/html', createFeishuClipboardHtml(table));
      event.clipboardData.setData('text/plain', getFeishuTableText(table));
      event.preventDefault();
      emit('clipboard:copied', 'table', mode);
      return true;
    }

    function safeDecodeURIComponent(value) {
      try { return decodeURIComponent(value || ''); }
      catch (error) { return value || ''; }
    }

    function createExportCodeBlock(label, source) {
      const fragment = document.createDocumentFragment();
      const caption = document.createElement('p');
      const bold = document.createElement('b');
      bold.textContent = label;
      caption.appendChild(bold);
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = source || '';
      pre.appendChild(code);
      fragment.append(caption, pre);
      return fragment;
    }

    function replaceElementTag(element, tagName) {
      const replacement = document.createElement(tagName);
      while (element.firstChild) replacement.appendChild(element.firstChild);
      element.replaceWith(replacement);
      return replacement;
    }

    function isSafeExportUrl(value, image) {
      const raw = (value || '').trim();
      if (image && /^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(raw)) return true;
      try {
        const protocol = new win.URL(raw, location.href).protocol;
        return image ? /^(https?:)$/.test(protocol) : /^(https?:|mailto:)$/.test(protocol);
      } catch (error) { return false; }
    }

    function normalizeFeishuExport(root) {
      root.querySelectorAll('.code-copy-btn,.code-lang-label').forEach(function(element) { element.remove(); });
      root.querySelectorAll('.mermaid-container').forEach(function(container) {
        container.replaceWith(createExportCodeBlock('Mermaid', safeDecodeURIComponent(container.getAttribute('data-mermaid-source'))));
      });
      root.querySelectorAll('.codepen-container').forEach(function(container) {
        container.replaceWith(createExportCodeBlock('CodePen', safeDecodeURIComponent(container.getAttribute('data-codepen-source'))));
      });
      root.querySelectorAll('iframe').forEach(function(iframe) {
        const src = iframe.getAttribute('src') || '';
        const paragraph = document.createElement('p');
        if (isSafeExportUrl(src)) {
          const link = document.createElement('a');
          link.href = src;
          link.textContent = '嵌入内容：' + src;
          paragraph.appendChild(link);
        } else paragraph.textContent = '嵌入内容已省略';
        iframe.replaceWith(paragraph);
      });
      root.querySelectorAll('details').forEach(function(details) {
        const fragment = document.createDocumentFragment();
        const summary = details.querySelector(':scope > summary');
        if (summary) {
          const paragraph = document.createElement('p');
          const bold = document.createElement('b');
          bold.textContent = summary.textContent;
          paragraph.appendChild(bold);
          fragment.appendChild(paragraph);
        }
        Array.from(details.childNodes).forEach(function(node) { if (node !== summary) fragment.appendChild(node); });
        details.replaceWith(fragment);
      });
      root.querySelectorAll('input[type="checkbox"]').forEach(function(input) {
        input.replaceWith(document.createTextNode(input.checked ? '☑ ' : '☐ '));
      });
      root.querySelectorAll('.table-wrapper').forEach(function(wrapper) {
        const table = wrapper.querySelector(':scope > table');
        if (table) wrapper.replaceWith(table);
        else wrapper.replaceWith.apply(wrapper, wrapper.childNodes);
      });
      root.querySelectorAll('table').forEach(function(table) { table.replaceWith(tables.createFeishuTableClone(table)); });
      root.querySelectorAll('strong').forEach(function(element) { replaceElementTag(element, 'b'); });
      root.querySelectorAll('i').forEach(function(element) { replaceElementTag(element, 'em'); });
      root.querySelectorAll('s').forEach(function(element) { replaceElementTag(element, 'del'); });
      normalizeFeishuTextColorsForExport(root);
      root.querySelectorAll('script,object,embed,form,meta,link,style,button').forEach(function(element) { element.remove(); });

      const allowedTags = new Set(['H1','H2','H3','H4','H5','H6','P','BR','B','EM','U','DEL','CODE','PRE','A','IMG','UL','OL','LI','BLOCKQUOTE','HR','TABLE','COLGROUP','COL','THEAD','TBODY','TFOOT','TR','TH','TD','SPAN']);
      Array.from(root.querySelectorAll('*')).reverse().forEach(function(element) {
        if (!allowedTags.has(element.tagName)) {
          element.replaceWith.apply(element, element.childNodes);
          return;
        }
        const allowedAttributes = {
          A: ['href'], IMG: ['src','alt','width','height'], OL: ['start'],
          TABLE: ['border','cellspacing','cellpadding','style'], COL: ['width','span'],
          TH: ['colspan','rowspan','align','valign','background-color','style'],
          TD: ['colspan','rowspan','align','valign','background-color','style'], SPAN: ['text-color','style'],
          H1: ['align'], H2: ['align'], H3: ['align'], H4: ['align'], H5: ['align'], H6: ['align'], P: ['align'], LI: ['align']
        };
        const keep = new Set(allowedAttributes[element.tagName] || []);
        Array.from(element.attributes).forEach(function(attribute) {
          if (!keep.has(attribute.name.toLowerCase())) element.removeAttribute(attribute.name);
        });
        if (element.tagName === 'A' && !isSafeExportUrl(element.getAttribute('href'))) {
          element.replaceWith.apply(element, element.childNodes);
        } else if (element.tagName === 'IMG' && !isSafeExportUrl(element.getAttribute('src'), true)) {
          const fallback = document.createElement('span');
          fallback.textContent = '[图片：' + (element.getAttribute('alt') || '无法复制的本地图片') + ']';
          element.replaceWith(fallback);
        }
      });
      return root;
    }


    function getFeishuDocumentText(root) {
      const clone = root.cloneNode(true);
      clone.querySelectorAll('table').forEach(function(table) {
        const pre = document.createElement('pre');
        pre.textContent = getFeishuTableText(table);
        table.replaceWith(pre);
      });
      clone.querySelectorAll('hr').forEach(function(hr) { hr.replaceWith(document.createTextNode('\n---\n')); });
      clone.querySelectorAll('img').forEach(function(img) {
        img.replaceWith(document.createTextNode('[图片：' + (img.alt || img.src) + ']'));
      });
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px;white-space:pre-wrap;';
      host.appendChild(clone);
      document.body.appendChild(host);
      const text = host.innerText.replace(/\n{3,}/g, '\n\n').trim();
      host.remove();
      return text;
    }

    function setFeishuDocumentClipboard(event, root, mode) {
      if (!event.clipboardData || !root) return false;
      normalizeFeishuExport(root);
      event.clipboardData.setData('text/html', createFeishuHtmlShell(root.innerHTML, false));
      event.clipboardData.setData('text/plain', getFeishuDocumentText(root));
      event.preventDefault();
      emit('clipboard:copied', 'document', mode);
      return true;
    }

    function getSelectedSourceTable() {
      if (!isSourceMode() || document.activeElement !== sourceEditor) return null;
      const selected = sourceEditor.value.slice(sourceEditor.selectionStart, sourceEditor.selectionEnd).trim();
      if (!/^<(?:table|thead|tbody|tr)\b[\s\S]*<\/table>\s*$/i.test(selected)) return null;
      const template = document.createElement('template');
      template.innerHTML = parser.mdToHtml(selected);
      return template.content.querySelector('table');
    }

    function getSelectedSourceDocument() {
      if (!isSourceMode() || document.activeElement !== sourceEditor || sourceEditor.selectionStart !== 0 ||
          sourceEditor.selectionEnd !== sourceEditor.value.length || !sourceEditor.value.trim()) return null;
      const root = document.createElement('div');
      root.innerHTML = parser.mdToHtml(parser.normalizeMarkdownBeforeRender(sourceEditor.value));
      return root;
    }

    function getPreviewSelectionRoot() {
      const selection = win.getSelection();
      if (!selection || !selection.rangeCount || selection.isCollapsed) return null;
      const anchor = selection.anchorNode && (selection.anchorNode.nodeType === 1 ? selection.anchorNode : selection.anchorNode.parentElement);
      const focus = selection.focusNode && (selection.focusNode.nodeType === 1 ? selection.focusNode : selection.focusNode.parentElement);
      if (!anchor || !focus || !editor.contains(anchor) || !editor.contains(focus)) return null;
      const root = document.createElement('div');
      root.appendChild(selection.getRangeAt(0).cloneContents());
      return root;
    }

    function handleFeishuCompatibleCopy(event) {
      const sourceTable = getSelectedSourceTable();
      if (sourceTable) return setFeishuTableClipboard(event, sourceTable, 'source');
      const sourceDocument = getSelectedSourceDocument();
      if (sourceDocument) return setFeishuDocumentClipboard(event, sourceDocument, 'source');
      if (isSourceMode()) return false;

      const selection = win.getSelection();
      const activeCell = tables.getActiveCell();
      const table = activeCell && activeCell.closest('table');
      if (table && selection && selection.rangeCount) {
        const anchor = selection.anchorNode && (selection.anchorNode.nodeType === 1 ? selection.anchorNode : selection.anchorNode.parentElement);
        const focus = selection.focusNode && (selection.focusNode.nodeType === 1 ? selection.focusNode : selection.focusNode.parentElement);
        if (anchor && focus && table.contains(anchor) && table.contains(focus)) {
          return setFeishuTableClipboard(event, table, 'preview');
        }
      }
      const selectedRoot = getPreviewSelectionRoot();
      return selectedRoot ? setFeishuDocumentClipboard(event, selectedRoot, 'preview') : false;
    }

    function createFeishuPasteRoot(clipboardHtml) {
      if (!clipboardHtml || !/<(?:table|thead|tbody|tr|td|th)\b/i.test(clipboardHtml)) return null;
      const fullDocument = new win.DOMParser().parseFromString(clipboardHtml, 'text/html');
      const fragmentMatch = clipboardHtml.match(/<!--StartFragment-->([\s\S]*?)<!--EndFragment-->/i);
      const root = document.createElement('div');
      root.innerHTML = fragmentMatch ? fragmentMatch[1] : fullDocument.body.innerHTML;
      if (!root.querySelector('table')) return null;

      root.querySelectorAll('script,iframe,object,embed,form,meta,link,template').forEach(function(element) { element.remove(); });
      root.querySelectorAll('*').forEach(function(element) {
        Array.from(element.attributes).forEach(function(attribute) {
          const name = attribute.name.toLowerCase();
          if (name.startsWith('on') || name === 'srcdoc') element.removeAttribute(attribute.name);
        });
        const style = element.getAttribute('style') || '';
        if (/url\s*\(|expression\s*\(|behavior\s*:|-moz-binding/i.test(style)) {
          element.setAttribute('style', style.split(';').filter(function(rule) {
            return !/url\s*\(|expression\s*\(|behavior\s*:|-moz-binding/i.test(rule);
          }).join(';'));
        }
      });
      const deferredImages = [];
      root.querySelectorAll('img[src]').forEach(function(image) {
        deferredImages.push([image, image.getAttribute('src')]);
        image.removeAttribute('src');
      });

      tables.normalizeImportedCellBackgrounds(root);
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:-100000px;top:0;width:1200px;height:1px;overflow:hidden;pointer-events:none;';
      const shadow = host.attachShadow({ mode: 'open' });
      fullDocument.querySelectorAll('style').forEach(function(sourceStyle) {
        const style = document.createElement('style');
        style.textContent = sourceStyle.textContent.replace(/@import[^;]+;?/gi, '').replace(/url\s*\([^)]*\)/gi, 'none');
        shadow.appendChild(style);
      });
      const scopeHtml = document.createElement('html');
      scopeHtml.className = fullDocument.documentElement.className;
      const scopeBody = document.createElement('body');
      scopeBody.className = fullDocument.body.className;
      scopeBody.appendChild(root);
      scopeHtml.appendChild(scopeBody);
      shadow.appendChild(scopeHtml);
      document.body.appendChild(host);

      root.querySelectorAll('th,td').forEach(function(cell) {
        if (tables.getImportedBackgroundDescriptor(cell)) return;
        const candidates = [cell].concat(Array.from(cell.querySelectorAll('*')), [cell.closest('tr')]);
        for (const candidate of candidates) {
          if (!candidate) continue;
          const css = tables.normalizeImportedCssBackground(win.getComputedStyle(candidate).backgroundColor);
          if (!css) continue;
          const token = tables.getFeishuCellBackgroundToken(css);
          if (token) cell.setAttribute('background-color', token);
          cell.style.backgroundColor = token ? tables.backgrounds[token] : css;
          const table = cell.closest('table');
          if (table) table.dataset.mdRawTable = '1';
          break;
        }
      });
      scopeBody.removeChild(root);
      host.remove();
      deferredImages.forEach(function(pair) {
        if (pair[1] && !/^\s*javascript:/i.test(pair[1])) pair[0].setAttribute('src', pair[1]);
      });
      root.querySelectorAll('style').forEach(function(style) { style.remove(); });
      tables.normalizeImportedCellBackgrounds(root);
      return root;
    }

    function insertSourceTextAtSelection(text) {
      const start = sourceEditor.selectionStart;
      const end = sourceEditor.selectionEnd;
      const before = sourceEditor.value.slice(0, start);
      const after = sourceEditor.value.slice(end);
      const prefix = before && !/\n\s*\n$/.test(before) ? '\n\n' : '';
      const suffix = after && !/^\s*\n/.test(after) ? '\n\n' : '';
      const inserted = prefix + text + suffix;
      sourceEditor.setRangeText(inserted, start, end, 'end');
      sourceEditor.dispatchEvent(new win.InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: inserted }));
    }

    function handleFeishuCompatiblePaste(event) {
      const html = event.clipboardData && event.clipboardData.getData('text/html');
      const root = createFeishuPasteRoot(html);
      if (!root) return false;
      event.preventDefault();
      if (event.currentTarget === sourceEditor) {
        insertSourceTextAtSelection(parser.domToMd(root).trim());
        tables.notifyChanged('paste');
        emit('clipboard:pasted', 'table', 'source');
        return true;
      }
      if (event.currentTarget === editor) {
        editor.focus();
        document.execCommand('insertHTML', false, root.innerHTML);
        schedulePreviewSync();
        tables.notifyChanged('paste');
        emit('clipboard:pasted', 'table', 'preview');
        return true;
      }
      return false;
    }


    function listen(target, type, listener) {
      target.addEventListener(type, listener);
      removers.push(function() { target.removeEventListener(type, listener); });
    }

    function bind() {
      if (bound) return api;
      bound = true;
      listen(document, 'copy', handleFeishuCompatibleCopy);
      listen(editor, 'paste', handleFeishuCompatiblePaste);
      listen(sourceEditor, 'paste', handleFeishuCompatiblePaste);
      return api;
    }

    function unbind() {
      while (removers.length) removers.pop()();
      bound = false;
    }

    const api = Object.freeze({
      normalizeFeishuTextColorsForExport: normalizeFeishuTextColorsForExport,
      getFeishuTableText: getFeishuTableText,
      createFeishuHtmlShell: createFeishuHtmlShell,
      createFeishuClipboardHtml: createFeishuClipboardHtml,
      setFeishuTableClipboard: setFeishuTableClipboard,
      normalizeFeishuExport: normalizeFeishuExport,
      getFeishuDocumentText: getFeishuDocumentText,
      setFeishuDocumentClipboard: setFeishuDocumentClipboard,
      getSelectedSourceTable: getSelectedSourceTable,
      getSelectedSourceDocument: getSelectedSourceDocument,
      getPreviewSelectionRoot: getPreviewSelectionRoot,
      createFeishuPasteRoot: createFeishuPasteRoot,
      insertSourceTextAtSelection: insertSourceTextAtSelection,
      handleFeishuCompatibleCopy: handleFeishuCompatibleCopy,
      handleFeishuCompatiblePaste: handleFeishuCompatiblePaste,
      bind: bind,
      unbind: unbind
    });

    bind();
    return api;
  }

  namespace.Clipboard = Object.freeze({ create: create });
})(window);
