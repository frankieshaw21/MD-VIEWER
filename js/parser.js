(function(global) {
  'use strict';

  const namespace = global.MDViewer || (global.MDViewer = {});

  function create(options) {
    options = options || {};
    const document = options.document;
    const FEISHU_TEXT_COLORS = options.textColors;
    const nextMermaidId = options.nextMermaidId;
    if (!document || typeof document.createElement !== 'function') {
      throw new TypeError('Parser requires a document');
    }
    if (!FEISHU_TEXT_COLORS || typeof FEISHU_TEXT_COLORS !== 'object') {
      throw new TypeError('Parser requires textColors');
    }
    if (typeof nextMermaidId !== 'function') {
      throw new TypeError('Parser requires nextMermaidId');
    }

// ============================================================
// Built-in Markdown parser (no external dependencies, offline)
// ============================================================
function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Inline formatting: bold, italic, code, links, images, strikethrough
function parseInline(text) {
  let s = text;
  // Protect inline code before escaping so its contents are escaped exactly once.
  const codeStore = [];
  s = s.replace(/`([^`]+)`/g, (m, c) => {
    codeStore.push(c);
    return '\u0000CODE' + (codeStore.length - 1) + '\u0000';
  });
  // Escape HTML first (but we'll re-insert our own safe tags).
  s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // Allow only attribute-free HTML line breaks/underline tags and Feishu's fixed text palette.
  // Inline-code content is already protected, so literal examples remain text.
  s = s.replace(/&lt;br[ \t]*\/?&gt;/gi, '<br>');
  s = s.replace(/&lt;(\/?)u&gt;/gi, '<$1u>');
  s = s.replace(/&lt;span\s+text-color\s*=\s*(["'])(red|orange|yellow|green|blue|purple|gray)\1\s*&gt;/gi,
    (match, quote, token) => '<span text-color="' + token.toLowerCase() + '">');
  s = s.replace(/&lt;\/span\s*&gt;/gi, '</span>');
  // Images ![alt](url)
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (m, alt, url) =>
    '<img src="' + url + '" alt="' + alt + '">');
  // Links [text](url)
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (m, txt, url) =>
    '<a href="' + url + '" target="_blank" rel="noopener">' + txt + '</a>');
  // Bold **text** or __text__
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  // Italic *text* or _text_
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>');
  // Strikethrough ~~text~~
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  // Restore inline code
  s = s.replace(/\u0000CODE(\d+)\u0000/g, (m, i) =>
    '<code>' + escHtml(codeStore[+i]) + '</code>');
  return s;
}

function mdToHtml(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  let html = '';
  let i = 0;

  function parseTableRow(line) {
    // strip leading/trailing pipe
    let cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|');
    return cells.map(c => c.trim());
  }

  while (i < lines.length) {
    let line = lines[i];

    // Fenced code block. Accept common info strings such as c++, vue.js,
    // "mermaid title=..." and attribute syntax like {.mermaid}.
    const fence = line.match(/^(\s*)(`{3,}|~{3,})[ \t]*(.*)$/);
    if (fence) {
      const marker = fence[2][0];
      const info = (fence[3] || '').trim();
      const attributeLang = info.match(/^\{\s*\.([\w-]+)/);
      const tokenLang = info.match(/^([^\s{]+)/);
      const lang = attributeLang ? attributeLang[1] : (tokenLang ? tokenLang[1] : '');
      const normalizedLang = lang.toLowerCase();
      const safeLangClass = lang.replace(/[^\w-]/g, '-');
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].match(new RegExp('^\\s*' + marker + '{3,}\\s*$'))) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // skip closing fence when present
      const code = codeLines.join('\n');
      if (normalizedLang === 'mermaid') {
        const currentMermaidId = nextMermaidId();
        html += '<div class="mermaid-container" contenteditable="false" data-mermaid-source="' +
          encodeURIComponent(code) + '"><div class="mermaid" id="mermaid-' + currentMermaidId + '">' +
          escHtml(code) + '</div></div>';
      } else if (normalizedLang === 'codepen') {
        html += '<div class="codepen-container" contenteditable="false" data-codepen-source="' +
          encodeURIComponent(code) + '"><iframe sandbox="allow-scripts allow-same-origin" style="width:100%;max-width:100%;min-height:500px;border:none;border-radius:4px;"></iframe></div>';
      } else {
        const langLabel = lang ? '<span class="code-lang-label">' + escHtml(lang) + '</span>' : '';
        const copyBtn = '<button type="button" class="code-copy-btn" contenteditable="false">复制</button>';
        html += '<pre>' + langLabel + copyBtn + '<code class="language-' + safeLangClass + '">' +
          escHtml(code) + '</code></pre>';
      }
      continue;
    }

    // Raw HTML table. Support complete/multiline <table> blocks and fragments
    // that start with <thead>, <tbody> or <tr> but end with </table>.
    const rawTableStart = line.match(/^\s*<(table|thead|tbody|tr)\b/i);
    if (rawTableStart) {
      const tableLines = [];
      let openCellDepth = 0;
      while (i < lines.length) {
        const tableLine = lines[i];
        const trimmedTableLine = tableLine.trim();
        if (tableLines.length > 0) {
          if (trimmedTableLine === '') break;
          const previousLine = tableLines[tableLines.length - 1].trim();
          const completedTableUnit = /<\/(?:thead|tbody|tfoot|tr)>\s*$/i.test(previousLine);
          const tableContinuation = /^<\/?(?:table|caption|colgroup|col|thead|tbody|tfoot|tr|th|td)\b/i.test(trimmedTableLine);
          const markdownBlockStart = /^(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+|`{3,}|~{3,}|\|)/.test(trimmedTableLine);
          if (openCellDepth === 0 && (markdownBlockStart || (completedTableUnit && !tableContinuation))) break;
        }
        tableLines.push(tableLine);
        i++;
        const openingCells = (tableLine.match(/<(?:td|th)\b/gi) || []).length;
        const closingCells = (tableLine.match(/<\/(?:td|th)>/gi) || []).length;
        openCellDepth = Math.max(0, openCellDepth + openingCells - closingCells);
        if (/<\/table>\s*$/i.test(tableLine)) break;
      }
      let rawTable = tableLines.join('\n');
      if (rawTableStart[1].toLowerCase() !== 'table') {
        rawTable = rawTable.replace(/<\/table>\s*$/i, '');
        rawTable = '<table data-md-raw-table="1">' + rawTable + '</table>';
      } else if (!/^\s*<table\b[^>]*\bdata-md-raw-table=/i.test(rawTable)) {
        rawTable = rawTable.replace(/<table\b/i, '<table data-md-raw-table="1"');
      }
      html += rawTable;
      continue;
    }

    // Other raw HTML blocks - pass through
    if (line.match(/^\s*<(iframe|div|img|details|summary|hr|br)/i)) {
      html += line + '\n';
      i++;
      continue;
    }

    // Heading
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      html += '<h' + level + '>' + parseInline(h[2].trim()) + '</h' + level + '>';
      i++;
      continue;
    }

    // Horizontal rule
    if (line.match(/^\s*([-*_])\s*(\1\s*){2,}$/)) {
      html += '<hr>';
      i++;
      continue;
    }

    // Blockquote
    if (line.match(/^\s*>/)) {
      const quoteLines = [];
      while (i < lines.length && lines[i].match(/^\s*>/)) {
        quoteLines.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      html += '<blockquote>' + mdToHtml(quoteLines.join('\n')) + '</blockquote>';
      continue;
    }

    // Table (must have header + separator line)
    if (line.indexOf('|') >= 0 && i + 1 < lines.length &&
        lines[i + 1].match(/^\s*\|?[\s:]*-+[\s:|-]*$/)) {
      const header = parseTableRow(line);
      const align = parseTableRow(lines[i + 1]).map(c => {
        if (/^:.*:$/.test(c)) return 'center';
        if (/:$/.test(c)) return 'right';
        if (/^:/.test(c)) return 'left';
        return '';
      });
      i += 2;
      let tbl = '<table><thead><tr>';
      header.forEach((c, idx) => {
        const a = align[idx] ? ' style="text-align:' + align[idx] + '"' : '';
        tbl += '<th' + a + '>' + parseInline(c) + '</th>';
      });
      tbl += '</tr></thead><tbody>';
      while (i < lines.length && lines[i].indexOf('|') >= 0 && lines[i].trim() !== '') {
        const row = parseTableRow(lines[i]);
        tbl += '<tr>';
        row.forEach((c, idx) => {
          const a = align[idx] ? ' style="text-align:' + align[idx] + '"' : '';
          tbl += '<td' + a + '>' + parseInline(c) + '</td>';
        });
        tbl += '</tr>';
        i++;
      }
      tbl += '</tbody></table>';
      html += tbl;
      continue;
    }

    // Lists (unordered / ordered / task)
    if (line.match(/^\s*([-*+]|\d+\.)\s+/)) {
      const result = parseList(lines, i, getIndent(line));
      html += result.html;
      i = result.next;
      continue;
    }

    // Blank line
    if (line.trim() === '') { i++; continue; }

    // Paragraph (collect consecutive non-blank, non-special lines)
    const paraLines = [];
    while (i < lines.length && lines[i].trim() !== '' &&
           !lines[i].match(/^(#{1,6})\s/) &&
           !lines[i].match(/^\s*([-*_])\s*(\1\s*){2,}$/) &&
           !lines[i].match(/^\s*>/) &&
           !lines[i].match(/^(\s*)(`{3,}|~{3,})/) &&
           !lines[i].match(/^\s*([-*+]|\d+\.)\s+/) &&
           !(lines[i].indexOf('|') >= 0 && i + 1 < lines.length && lines[i+1].match(/^\s*\|?[\s:]*-+[\s:|-]*$/)) &&
           !lines[i].match(/^\s*<(iframe|div|table|img|details|summary|hr)/i)) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      html += '<p>' + parseInline(paraLines.join('\n').trim()).replace(/\n/g, '<br>') + '</p>';
    } else {
      // Defensive progress guarantee: no malformed or newly supported syntax may
      // leave the parser retrying the same line forever.
      html += '<p>' + parseInline(line.trim()) + '</p>';
      i++;
    }
  }
  return html;
}

function getIndent(line) {
  const m = line.match(/^(\s*)/);
  return m ? m[1].length : 0;
}

// Parse a list starting at index `start`. Returns {html, next}
function isOrderedMarker(line) { return /^\s*\d+\.\s/.test(line); }

function parseList(lines, start, baseIndent) {
  const ordered = isOrderedMarker(lines[start]);
  const tag = ordered ? 'ol' : 'ul';
  let isTask = false;
  let items = [];
  let i = start;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      // Blank line: continue only if next non-blank is a SAME-TYPE list item at this indent
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === '') j++;
      if (j < lines.length &&
          lines[j].match(/^\s*([-*+]|\d+\.)\s+/) &&
          getIndent(lines[j]) === baseIndent &&
          isOrderedMarker(lines[j]) === ordered) {
        i = j;
        continue;
      }
      break;
    }
    const indent = getIndent(line);
    const m = line.match(/^\s*([-*+]|\d+\.)\s+(.*)$/);
    if (!m || indent < baseIndent) break;

    if (indent > baseIndent) {
      // Nested list - attach to previous item
      const sub = parseList(lines, i, indent);
      if (items.length > 0) items[items.length - 1].content += sub.html;
      i = sub.next;
      continue;
    }

    // Same indent but different list type (ordered vs unordered) -> new list, stop here
    if (isOrderedMarker(line) !== ordered) break;

    let content = m[2];
    // Task list detection
    const task = content.match(/^\[([ xX])\]\s+(.*)$/);
    if (task) {
      isTask = true;
      const checked = task[1].toLowerCase() === 'x';
      content = '<input type="checkbox"' + (checked ? ' checked' : '') + '> ' + parseInline(task[2]);
    } else {
      content = parseInline(content);
    }
    items.push({ content: content });
    i++;
  }

  let html = '<' + tag + (isTask ? ' class="task-list"' : '') + '>';
  items.forEach(it => { html += '<li>' + it.content + '</li>'; });
  html += '</' + tag + '>';
  return { html: html, next: i };
}

// Lightweight HTML -> Markdown (only needed for WYSIWYG save; basic support)
function htmlToMarkdown(html) {
  // For our use case, content is stored as source markdown, so this is rarely needed.
  // Provide a basic conversion as fallback.
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return domToMd(tmp).trim();
}

function getFeishuTextColorTokenFromValue(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/\s+/g, '');
  if (!normalized) return '';
  for (const [token, hex] of Object.entries(FEISHU_TEXT_COLORS)) {
    const red = parseInt(hex.slice(1, 3), 16);
    const green = parseInt(hex.slice(3, 5), 16);
    const blue = parseInt(hex.slice(5, 7), 16);
    if (normalized === hex || normalized === `rgb(${red},${green},${blue})` || normalized === `rgba(${red},${green},${blue},1)`) return token;
  }
  return '';
}

function getElementTextColorToken(element) {
  const attributeToken = (element.getAttribute('text-color') || '').toLowerCase();
  if (FEISHU_TEXT_COLORS[attributeToken]) return attributeToken;
  return getFeishuTextColorTokenFromValue(element.getAttribute('color') || element.style.color);
}

function normalizeTextColorMarkup(root) {
  root.querySelectorAll('font[color],span[text-color],span[style*="color"]').forEach(element => {
    const token = getElementTextColorToken(element);
    if (!token) return;
    if (element.tagName === 'FONT') {
      const span = document.createElement('span');
      span.setAttribute('text-color', token);
      while (element.firstChild) span.appendChild(element.firstChild);
      element.replaceWith(span);
      return;
    }
    element.setAttribute('text-color', token);
    element.removeAttribute('color');
    element.style.removeProperty('color');
    if (!element.getAttribute('style')) element.removeAttribute('style');
  });
}

function domToMd(node) {
  let md = '';
  node.childNodes.forEach(child => {
    if (child.nodeType === 3) { md += child.textContent; return; }
    if (child.nodeType !== 1) return;
    const tag = child.tagName.toLowerCase();
    if (tag === 'h1') md += '\n# ' + domToMd(child) + '\n\n';
    else if (tag === 'h2') md += '\n## ' + domToMd(child) + '\n\n';
    else if (tag === 'h3') md += '\n### ' + domToMd(child) + '\n\n';
    else if (tag === 'h4') md += '\n#### ' + domToMd(child) + '\n\n';
    else if (tag === 'h5') md += '\n##### ' + domToMd(child) + '\n\n';
    else if (tag === 'h6') md += '\n###### ' + domToMd(child) + '\n\n';
    else if (tag === 'p') md += '\n' + domToMd(child) + '\n\n';
    else if (tag === 'strong' || tag === 'b') md += '**' + domToMd(child) + '**';
    else if (tag === 'em' || tag === 'i') md += '*' + domToMd(child) + '*';
    else if (tag === 'u') md += '<u>' + domToMd(child) + '</u>';
    else if (tag === 'del') md += '~~' + domToMd(child) + '~~';
    else if (tag === 'span' || tag === 'font') {
      const token = getElementTextColorToken(child);
      md += token ? '<span text-color="' + token + '">' + domToMd(child) + '</span>' : domToMd(child);
    }
    else if (tag === 'code' && child.parentElement.tagName !== 'PRE') md += '`' + child.textContent + '`';
    else if (tag === 'a') md += '[' + child.textContent + '](' + (child.getAttribute('href') || '') + ')';
    else if (tag === 'img') md += '![' + (child.getAttribute('alt') || '') + '](' + (child.getAttribute('src') || '') + ')';
    else if (tag === 'br') md += '\n';
    else if (tag === 'hr') md += '\n---\n\n';
    else if (tag === 'blockquote') md += '\n> ' + domToMd(child).trim().replace(/\n/g, '\n> ') + '\n\n';
    else if (tag === 'ul' || tag === 'ol') {
      child.querySelectorAll(':scope > li').forEach((li, idx) => {
        const checkbox = li.querySelector(':scope > input[type="checkbox"]');
        let prefix = tag === 'ol' ? (idx + 1) + '. ' : '- ';
        const content = li.cloneNode(true);
        const clonedCheckbox = content.querySelector(':scope > input[type="checkbox"]');
        if (checkbox) {
          prefix = '- [' + (checkbox.checked ? 'x' : ' ') + '] ';
          if (clonedCheckbox) clonedCheckbox.remove();
        }
        md += prefix + domToMd(content).trim() + '\n';
      });
      md += '\n';
    }
    else if (tag === 'pre') {
      const codeEl = child.querySelector('code');
      const cls = codeEl ? (codeEl.className || '') : '';
      const lm = cls.match(/language-([\w-]+)/);
      const lang = lm ? lm[1] : '';
      md += '\n```' + lang + '\n' + (codeEl ? codeEl.textContent : child.textContent) + '\n```\n\n';
    }
    else if (child.classList && child.classList.contains('mermaid-container')) {
      const src = decodeURIComponent(child.getAttribute('data-mermaid-source') || '');
      md += '\n```mermaid\n' + src + '\n```\n\n';
    }
    else if (child.classList && child.classList.contains('codepen-container')) {
      const src = decodeURIComponent(child.getAttribute('data-codepen-source') || '');
      md += '\n```codepen\n' + src + '\n```\n\n';
    }
    else if (tag === 'iframe') md += '\n' + child.outerHTML + '\n\n';
    else if (tag === 'table') md += domTableToMd(child);
    else md += domToMd(child);
  });
  return md;
}

function cloneTableForExport(table) {
  const clone = table.cloneNode(true);
  clone.removeAttribute('data-md-raw-table');
  clone.querySelectorAll('script,iframe,object,embed,form,meta,link,style').forEach(element => element.remove());
  clone.querySelectorAll('*').forEach(element => {
    element.classList.remove('table-cell-selected', 'table-cell-multi-selected', 'table-cell-selection-anchor');
    if (!element.className) element.removeAttribute('class');
    element.removeAttribute('contenteditable');
    element.removeAttribute('data-md-raw-table');
    Array.from(element.attributes).forEach(attribute => {
      if (attribute.name.toLowerCase().startsWith('on')) element.removeAttribute(attribute.name);
    });
    ['href', 'src'].forEach(name => {
      const value = element.getAttribute(name) || '';
      if (/^\s*javascript:/i.test(value)) element.removeAttribute(name);
    });
  });
  return clone;
}

function domTableToMd(table) {
  const preserveAsHtml = table.dataset.mdRawTable === '1' ||
    Array.from(table.querySelectorAll('th,td')).some(cell => cell.colSpan > 1 || cell.rowSpan > 1);
  if (preserveAsHtml) {
    return '\n' + cloneTableForExport(table).outerHTML + '\n\n';
  }

  let md = '\n';
  const rows = table.querySelectorAll('tr');
  rows.forEach((tr, ri) => {
    const cells = tr.querySelectorAll('th,td');
    const values = Array.from(cells).map(cell =>
      domToMd(cell).trim().replace(/\n/g, '<br>')
    );
    md += '| ' + values.join(' | ') + ' |\n';
    if (ri === 0) {
      md += '| ' + Array.from(cells).map(() => '---').join(' | ') + ' |\n';
    }
  });
  return md + '\n';
}

function normalizeMarkdownBeforeRender(md) {
  return md.replace(
    /^(https:\/\/codepen\.io\/([\w-]+)\/pen\/([\w-]+))\s*$/gm,
    '<iframe src="https://codepen.io/$2/embed/$3?default-tab=result&theme-id=dark" style="width:100%;min-height:400px;" frameborder="0" allowfullscreen></iframe>'
  );
}

    return Object.freeze({
      escHtml: escHtml,
      parseInline: parseInline,
      mdToHtml: mdToHtml,
      getIndent: getIndent,
      isOrderedMarker: isOrderedMarker,
      parseList: parseList,
      htmlToMarkdown: htmlToMarkdown,
      getFeishuTextColorTokenFromValue: getFeishuTextColorTokenFromValue,
      getElementTextColorToken: getElementTextColorToken,
      normalizeTextColorMarkup: normalizeTextColorMarkup,
      domToMd: domToMd,
      cloneTableForExport: cloneTableForExport,
      domTableToMd: domTableToMd,
      normalizeMarkdownBeforeRender: normalizeMarkdownBeforeRender
    });
  }

  namespace.Parser = Object.freeze({ create: create });
})(window);
