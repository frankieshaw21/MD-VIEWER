(function(global) {
  'use strict';

  const namespace = global.MDViewer || (global.MDViewer = {});

  function create(options) {
    options = options || {};
    const win = options.window || global;
    const document = options.document || win.document;
    const context = options.context;
    if (!context || typeof context.getPort !== 'function') throw new TypeError('Tables requires context');
    const editor = context.elements.editor;
    const parser = context.getPort('parser');
    const tools = options.tools || {};
    const menu = tools.menu;
    const editorWrapper = tools.editorWrapper;
    const isSourceMode = function() { return context.getPort('editor').invoke('isSourceMode'); };
    const schedulePreviewSync = function() { return context.getPort('editor').invoke('schedulePreviewSync'); };
    const hideTextColorPalette = function() { return context.getPort('ui').hideTextColorPalette(); };
    const textColors = options.textColors || {};
    const confirmAction = options.confirm || win.confirm.bind(win);

    if (!document || typeof document.createElement !== 'function') throw new TypeError('Tables requires a document');
    if (!editor || !menu) throw new TypeError('Tables requires editor and tools.menu');
    if (!parser || typeof parser.cloneTableForExport !== 'function') throw new TypeError('Tables requires a parser');
    if (typeof isSourceMode !== 'function') throw new TypeError('Tables requires isSourceMode');
    if (typeof schedulePreviewSync !== 'function') {
      throw new TypeError('Tables requires an editor synchronization callback');
    }

    const FEISHU_CELL_BACKGROUNDS = Object.freeze({
      red: '#d83931', orange: '#de7802', yellow: '#dc9b04', green: '#2d9f46',
      blue: '#3370ff', purple: '#7b67ee', gray: '#646a73',
      'light-red': '#fde2e2', 'light-orange': '#fee7cd', 'light-yellow': '#fff1cc',
      'light-green': '#d9f5d6', 'light-blue': '#dbeafe', 'light-purple': '#e9e4ff', 'light-gray': '#e5e6eb'
    });
    const importedCssColorProbe = document.createElement('span');
    let feishuCellBackgroundCssTokens = null;
    let activeTableCell = null;
    const cellBackgroundUndoStack = [];
    const cellBackgroundRedoStack = [];
    const removers = [];
    let bound = false;


    function notifyChanged(type) {
      if (context && typeof context.emit === 'function') context.emit('table:changed', { type: type });
    }

    function emitChanged(type) {
      schedulePreviewSync();
      notifyChanged(type);
    }

    function normalizeImportedCssBackground(value) {
      const raw = String(value || '').trim().replace(/\s*!important\s*$/i, '');
      if (!raw) return '';
      importedCssColorProbe.style.cssText = '';
      importedCssColorProbe.style.background = raw;
      let color = importedCssColorProbe.style.backgroundColor;
      if (!color) {
        importedCssColorProbe.style.backgroundColor = raw;
        color = importedCssColorProbe.style.backgroundColor;
      }
      return color && color !== 'transparent' && !/^rgba\([^)]*,\s*0(?:\.0+)?\s*\)$/i.test(color) ? color : '';
    }

    function getFeishuCellBackgroundToken(value) {
      let normalized = String(value || '').trim().toLowerCase().replace(/^['"]|['"]$/g, '');
      normalized = normalized.replace(/_/g, '-').replace(/\s+/g, '-');
      normalized = normalized.replace(/^light(red|orange|yellow|green|blue|purple|gray)$/, 'light-$1');
      if (FEISHU_CELL_BACKGROUNDS[normalized]) return normalized;
      const cssColor = normalizeImportedCssBackground(value);
      if (!cssColor) return '';
      if (!feishuCellBackgroundCssTokens) {
        feishuCellBackgroundCssTokens = new Map(Object.entries(FEISHU_CELL_BACKGROUNDS).map(function(entry) {
          return [normalizeImportedCssBackground(entry[1]), entry[0]];
        }));
      }
      return feishuCellBackgroundCssTokens.get(cssColor) || '';
    }

    function getImportedBackgroundDescriptor(element) {
      if (!element) return null;
      const values = [
        element.getAttribute('background-color'), element.getAttribute('data-background-color'),
        element.getAttribute('data-cell-background-color'), element.getAttribute('data-bg-color'),
        element.getAttribute('bgcolor'), element.getAttribute('background'),
        element.style.backgroundColor, element.style.background
      ];
      const styleMatch = (element.getAttribute('style') || '').match(/(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+)/i);
      if (styleMatch) values.push(styleMatch[1]);
      for (const value of values) {
        if (!value) continue;
        const token = getFeishuCellBackgroundToken(value);
        if (token) return { token: token, css: FEISHU_CELL_BACKGROUNDS[token] };
        const css = normalizeImportedCssBackground(value);
        if (css) return { token: '', css: css };
      }
      return null;
    }

    function collectScopedElements(root, selector) {
      const elements = [];
      if (!root) return elements;
      if (root.nodeType === 1 && root.matches(selector)) elements.push(root);
      if (root.querySelectorAll) elements.push.apply(elements, root.querySelectorAll(selector));
      return elements;
    }

    function normalizeImportedCellBackgrounds(root) {
      const rowDescriptors = new WeakMap();
      collectScopedElements(root, 'th,td').forEach(function(cell) {
        const canonicalToken = (cell.getAttribute('background-color') || '').toLowerCase();
        const hasLegacyAttributes = ['data-background-color','data-cell-background-color','data-bg-color','bgcolor','background']
          .some(function(name) { return cell.hasAttribute(name); });
        if (FEISHU_CELL_BACKGROUNDS[canonicalToken] && cell.style.backgroundColor && !hasLegacyAttributes) {
          const table = cell.closest('table');
          if (table) table.dataset.mdRawTable = '1';
          return;
        }
        const nested = cell.querySelector('[background-color],[data-background-color],[data-cell-background-color],[data-bg-color],[bgcolor],[style*="background"]');
        const row = cell.closest('tr');
        if (row && !rowDescriptors.has(row)) rowDescriptors.set(row, getImportedBackgroundDescriptor(row));
        const descriptor = getImportedBackgroundDescriptor(cell) || getImportedBackgroundDescriptor(nested) ||
          (row ? rowDescriptors.get(row) : null);
        if (!descriptor) return;
        if (descriptor.token) cell.setAttribute('background-color', descriptor.token);
        else cell.removeAttribute('background-color');
        ['data-background-color','data-cell-background-color','data-bg-color','bgcolor','background'].forEach(function(name) {
          cell.removeAttribute(name);
        });
        cell.style.backgroundColor = descriptor.css;
        const table = cell.closest('table');
        if (table) table.dataset.mdRawTable = '1';
      });
    }

    function buildTableGrid(table) {
      const rows = Array.from(table.rows);
      const grid = [];
      const origins = new Map();
      rows.forEach(function(row, rowIndex) {
        if (!grid[rowIndex]) grid[rowIndex] = [];
        let columnIndex = 0;
        Array.from(row.cells).forEach(function(cell) {
          while (grid[rowIndex][columnIndex]) columnIndex++;
          const rowSpan = cell.rowSpan === 0 ? rows.length - rowIndex : Math.max(1, cell.rowSpan);
          const colSpan = Math.max(1, cell.colSpan);
          origins.set(cell, { row: rowIndex, col: columnIndex, rowSpan: rowSpan, colSpan: colSpan });
          for (let rowNumber = rowIndex; rowNumber < Math.min(rows.length, rowIndex + rowSpan); rowNumber++) {
            if (!grid[rowNumber]) grid[rowNumber] = [];
            for (let column = columnIndex; column < columnIndex + colSpan; column++) {
              grid[rowNumber][column] = { cell: cell, originRow: rowIndex, originCol: columnIndex };
            }
          }
          columnIndex += colSpan;
        });
      });
      return { table: table, rows: rows, grid: grid, origins: origins };
    }

    function getTableCellContext(cell) {
      const table = cell && cell.closest('table');
      if (!table || !editor.contains(table)) return null;
      const tableContext = buildTableGrid(table);
      const origin = tableContext.origins.get(cell);
      return origin ? Object.assign({}, tableContext, { cell: cell, origin: origin }) : null;
    }

    function getMergeRightTarget(cell) {
      const tableContext = getTableCellContext(cell);
      if (!tableContext) return null;
      const origin = tableContext.origin;
      const entry = tableContext.grid[origin.row] && tableContext.grid[origin.row][origin.col + origin.colSpan];
      if (!entry || entry.cell === cell || entry.originRow !== origin.row || entry.originCol !== origin.col + origin.colSpan) return null;
      const targetOrigin = tableContext.origins.get(entry.cell);
      if (!targetOrigin || targetOrigin.rowSpan !== origin.rowSpan || entry.cell.tagName !== cell.tagName ||
          entry.cell.parentElement.parentElement !== cell.parentElement.parentElement) return null;
      return entry.cell;
    }

    function getMergeDownTarget(cell) {
      const tableContext = getTableCellContext(cell);
      if (!tableContext) return null;
      const origin = tableContext.origin;
      const entry = tableContext.grid[origin.row + origin.rowSpan] && tableContext.grid[origin.row + origin.rowSpan][origin.col];
      if (!entry || entry.cell === cell || entry.originRow !== origin.row + origin.rowSpan || entry.originCol !== origin.col) return null;
      const targetOrigin = tableContext.origins.get(entry.cell);
      if (!targetOrigin || targetOrigin.colSpan !== origin.colSpan || entry.cell.tagName !== cell.tagName ||
          entry.cell.parentElement.parentElement !== cell.parentElement.parentElement) return null;
      return entry.cell;
    }

    function hasMeaningfulCellContent(cell) {
      return Array.from(cell.childNodes).some(function(node) {
        return node.nodeType === 3 ? node.textContent.trim() : node.nodeType === 1 && node.tagName !== 'BR';
      });
    }

    function appendMergedCellContent(cell, source) {
      if (!hasMeaningfulCellContent(source)) return;
      if (hasMeaningfulCellContent(cell)) cell.appendChild(document.createElement('br'));
      else cell.innerHTML = '';
      while (source.firstChild) cell.appendChild(source.firstChild);
    }

    function finishTableStructureEdit(cell, type) {
      cell.closest('table').dataset.mdRawTable = '1';
      emitChanged(type);
      showTableCellTools(cell);
    }

    function mergeTableCellRight() {
      const cell = activeTableCell;
      const target = getMergeRightTarget(cell);
      if (!cell || !target) return false;
      appendMergedCellContent(cell, target);
      cell.colSpan += target.colSpan;
      target.remove();
      finishTableStructureEdit(cell, 'merge-right');
      return true;
    }

    function mergeTableCellDown() {
      const cell = activeTableCell;
      const target = getMergeDownTarget(cell);
      if (!cell || !target) return false;
      appendMergedCellContent(cell, target);
      cell.rowSpan += target.rowSpan;
      target.remove();
      finishTableStructureEdit(cell, 'merge-down');
      return true;
    }

    function splitTableCell() {
      const cell = activeTableCell;
      const tableContext = getTableCellContext(cell);
      if (!tableContext || (tableContext.origin.rowSpan === 1 && tableContext.origin.colSpan === 1)) return false;
      const origin = tableContext.origin;
      cell.rowSpan = 1;
      cell.colSpan = 1;
      cell.removeAttribute('rowspan');
      cell.removeAttribute('colspan');
      for (let rowIndex = origin.row; rowIndex < origin.row + origin.rowSpan; rowIndex++) {
        const row = tableContext.rows[rowIndex];
        if (!row) continue;
        const firstColumn = rowIndex === origin.row ? origin.col + 1 : origin.col;
        const lastColumn = origin.col + origin.colSpan;
        const existing = Array.from(row.cells).map(function(existingCell) {
          const existingOrigin = tableContext.origins.get(existingCell);
          return { cell: existingCell, col: existingOrigin ? existingOrigin.col : Number.MAX_SAFE_INTEGER };
        });
        for (let column = firstColumn; column < lastColumn; column++) {
          const newCell = document.createElement(cell.tagName.toLowerCase());
          newCell.innerHTML = '<br>';
          const next = existing.find(function(item) { return item.col > column; });
          row.insertBefore(newCell, next ? next.cell : null);
        }
      }
      finishTableStructureEdit(cell, 'split');
      return true;
    }

    function getTableColumnCount(tableContext) {
      return Math.max.apply(Math, [1].concat(tableContext.grid.map(function(row) { return row.length; })));
    }

    function insertTableRow(position) {
      const tableContext = getTableCellContext(activeTableCell);
      if (!tableContext) return false;
      const cell = tableContext.cell;
      const section = cell.parentElement.parentElement;
      const sectionRows = Array.from(section.rows);
      const sectionStart = tableContext.rows.indexOf(sectionRows[0]);
      const requestedBoundary = position === 'above' ? tableContext.origin.row : tableContext.origin.row + tableContext.origin.rowSpan;
      const boundary = Math.max(sectionStart, Math.min(sectionStart + sectionRows.length, requestedBoundary));
      const coveredColumns = new Set();
      tableContext.origins.forEach(function(cellOrigin, spanningCell) {
        if (spanningCell.parentElement.parentElement === section && cellOrigin.row < boundary && cellOrigin.row + cellOrigin.rowSpan > boundary) {
          spanningCell.rowSpan = cellOrigin.rowSpan + 1;
          for (let column = cellOrigin.col; column < cellOrigin.col + cellOrigin.colSpan; column++) coveredColumns.add(column);
        }
      });
      const newRow = section.insertRow(boundary - sectionStart);
      const tagName = section.tagName === 'THEAD' ? 'th' : 'td';
      for (let column = 0; column < getTableColumnCount(tableContext); column++) {
        if (coveredColumns.has(column)) continue;
        const newCell = document.createElement(tagName);
        newCell.innerHTML = '<br>';
        newRow.appendChild(newCell);
      }
      finishTableStructureEdit(cell, 'insert-row-' + position);
      return true;
    }

    function insertTableColumn(position) {
      const tableContext = getTableCellContext(activeTableCell);
      if (!tableContext) return false;
      const boundary = Math.max(0, Math.min(getTableColumnCount(tableContext),
        position === 'left' ? tableContext.origin.col : tableContext.origin.col + tableContext.origin.colSpan));
      const rowsCoveredByExpandedCells = new Set();
      tableContext.origins.forEach(function(cellOrigin, spanningCell) {
        if (cellOrigin.col < boundary && cellOrigin.col + cellOrigin.colSpan > boundary) {
          spanningCell.colSpan = cellOrigin.colSpan + 1;
          for (let row = cellOrigin.row; row < cellOrigin.row + cellOrigin.rowSpan; row++) rowsCoveredByExpandedCells.add(row);
        }
      });
      tableContext.rows.forEach(function(row, rowIndex) {
        if (rowsCoveredByExpandedCells.has(rowIndex)) return;
        const newCell = document.createElement(row.parentElement.tagName === 'THEAD' ? 'th' : 'td');
        newCell.innerHTML = '<br>';
        const reference = Array.from(row.cells).find(function(existingCell) {
          const existingOrigin = tableContext.origins.get(existingCell);
          return (existingOrigin ? existingOrigin.col : Number.MAX_SAFE_INTEGER) >= boundary;
        }) || null;
        row.insertBefore(newCell, reference);
      });
      finishTableStructureEdit(tableContext.cell, 'insert-column-' + position);
      return true;
    }


    function canDeleteSelectedTableRow() {
      const tableContext = getTableCellContext(activeTableCell);
      if (!tableContext) return false;
      const rowIndex = tableContext.rows.indexOf(activeTableCell.parentElement);
      return (tableContext.grid[rowIndex] || []).every(function(entry) {
        const origin = tableContext.origins.get(entry.cell);
        return origin && origin.row === rowIndex && origin.rowSpan === 1;
      });
    }

    function deleteSelectedTableRow() {
      const tableContext = getTableCellContext(activeTableCell);
      if (!tableContext || !canDeleteSelectedTableRow()) return false;
      const table = tableContext.table;
      activeTableCell.parentElement.remove();
      hideTableCellTools();
      if (!table.rows.length) {
        const wrapper = table.closest('.table-wrapper');
        (wrapper || table).remove();
      } else {
        table.dataset.mdRawTable = '1';
        const nextCell = table.querySelector('th,td');
        if (nextCell) showTableCellTools(nextCell);
      }
      emitChanged('delete-row');
      return true;
    }

    function getSelectedLogicalColumnContext() {
      const tableContext = getTableCellContext(activeTableCell);
      if (!tableContext) return null;
      const column = tableContext.origin.col;
      const entries = tableContext.grid.map(function(row) { return row[column]; }).filter(Boolean);
      return Object.assign({}, tableContext, { column: column, entries: entries });
    }

    function canDeleteSelectedTableColumn() {
      const tableContext = getSelectedLogicalColumnContext();
      if (!tableContext) return false;
      return tableContext.entries.every(function(entry) {
        const origin = tableContext.origins.get(entry.cell);
        return origin && origin.col === tableContext.column && origin.colSpan === 1;
      });
    }

    function deleteSelectedTableColumn() {
      const tableContext = getSelectedLogicalColumnContext();
      if (!tableContext || !canDeleteSelectedTableColumn()) return false;
      new Set(tableContext.entries.map(function(entry) { return entry.cell; })).forEach(function(cell) { cell.remove(); });
      hideTableCellTools();
      if (!tableContext.table.querySelector('th,td')) {
        const wrapper = tableContext.table.closest('.table-wrapper');
        (wrapper || tableContext.table).remove();
      } else {
        tableContext.table.dataset.mdRawTable = '1';
        showTableCellTools(tableContext.table.querySelector('th,td'));
      }
      emitChanged('delete-column');
      return true;
    }

    function deleteSelectedTable() {
      const table = activeTableCell && activeTableCell.closest('table');
      if (!table || !confirmAction('删除整个表格？')) return false;
      hideTableCellTools();
      const wrapper = table.closest('.table-wrapper');
      (wrapper || table).remove();
      emitChanged('delete-table');
      return true;
    }

    function normalizeFeishuTextColorsForExport(root) {
      if (typeof parser.getElementTextColorToken !== 'function') return;
      root.querySelectorAll('span').forEach(function(span) {
        const token = parser.getElementTextColorToken(span);
        Array.from(span.attributes).forEach(function(attribute) { span.removeAttribute(attribute.name); });
        if (token && textColors[token]) {
          span.setAttribute('text-color', token);
          span.style.color = textColors[token];
        }
      });
    }

    function createFeishuTableClone(table) {
      const clone = parser.cloneTableForExport(table);
      const grid = buildTableGrid(table).grid;
      const columnCount = Math.max.apply(Math, [1].concat(grid.map(function(row) { return row.length; })));
      if (!clone.querySelector(':scope > colgroup')) {
        const colgroup = document.createElement('colgroup');
        const measuredWidth = table.getBoundingClientRect().width || columnCount * 160;
        const columnWidth = Math.max(100, Math.min(300, Math.round(measuredWidth / columnCount)));
        for (let index = 0; index < columnCount; index++) {
          const col = document.createElement('col');
          col.setAttribute('width', columnWidth);
          colgroup.appendChild(col);
        }
        clone.insertBefore(colgroup, clone.firstChild);
      }
      clone.setAttribute('cellspacing', '0');
      clone.setAttribute('cellpadding', '0');
      clone.setAttribute('border', '1');
      clone.removeAttribute('style');
      clone.style.borderCollapse = 'collapse';
      clone.style.border = '1px solid #d0d3d8';
      clone.querySelectorAll('col').forEach(function(col) { col.removeAttribute('style'); });
      clone.querySelectorAll('th,td').forEach(function(cell) {
        const alignment = /^(left|center|right)$/.test(cell.style.textAlign) ? cell.style.textAlign : 'left';
        const backgroundToken = (cell.getAttribute('background-color') || '').toLowerCase();
        const backgroundColor = FEISHU_CELL_BACKGROUNDS[backgroundToken] || '';
        cell.removeAttribute('style');
        if (backgroundColor) cell.setAttribute('background-color', backgroundToken);
        else cell.removeAttribute('background-color');
        cell.style.border = '1px solid #d0d3d8';
        cell.style.padding = '6px 10px';
        cell.style.textAlign = alignment;
        cell.style.verticalAlign = 'top';
        if (backgroundColor) cell.style.backgroundColor = backgroundColor;
        cell.setAttribute('valign', 'top');
        cell.setAttribute('style', (cell.getAttribute('style') || '') + ';mso-number-format:"\\@";');
      });
      clone.querySelectorAll('th').forEach(function(cell) {
        cell.style.fontWeight = '600';
        if (!FEISHU_CELL_BACKGROUNDS[cell.getAttribute('background-color') || '']) cell.style.backgroundColor = '#f5f6f7';
      });
      normalizeFeishuTextColorsForExport(clone);
      return clone;
    }

    function getCellBackgroundState(cell) {
      return { token: (cell.getAttribute('background-color') || '').toLowerCase(), style: cell.style.backgroundColor || '' };
    }

    function setCellBackgroundState(cell, state) {
      const token = state && FEISHU_CELL_BACKGROUNDS[state.token] ? state.token : '';
      if (token) {
        cell.setAttribute('background-color', token);
        cell.style.backgroundColor = FEISHU_CELL_BACKGROUNDS[token];
      } else {
        cell.removeAttribute('background-color');
        if (state && state.style) cell.style.backgroundColor = state.style;
        else cell.style.removeProperty('background-color');
        if (!cell.getAttribute('style')) cell.removeAttribute('style');
      }
      const table = cell.closest('table');
      if (table) table.dataset.mdRawTable = '1';
    }

    function updateCellBackgroundPalette() {
      const activeToken = activeTableCell ? (activeTableCell.getAttribute('background-color') || '') : '';
      document.querySelectorAll('[data-cell-background]').forEach(function(button) {
        button.setAttribute('aria-pressed', String(button.dataset.cellBackground === activeToken));
      });
    }

    function clearCellBackgroundHistory() {
      cellBackgroundUndoStack.length = 0;
      cellBackgroundRedoStack.length = 0;
    }

    function syncCellBackgroundChange(cell, type) {
      if (activeTableCell === cell) updateCellBackgroundPalette();
      emitChanged(type);
      win.requestAnimationFrame(positionTableCellTools);
    }

    function undoCellBackground() {
      while (cellBackgroundUndoStack.length) {
        const record = cellBackgroundUndoStack.pop();
        if (!record.cell.isConnected) continue;
        setCellBackgroundState(record.cell, record.before);
        cellBackgroundRedoStack.push(record);
        syncCellBackgroundChange(record.cell, 'background-undo');
        return true;
      }
      return false;
    }

    function redoCellBackground() {
      while (cellBackgroundRedoStack.length) {
        const record = cellBackgroundRedoStack.pop();
        if (!record.cell.isConnected) continue;
        setCellBackgroundState(record.cell, record.after);
        cellBackgroundUndoStack.push(record);
        syncCellBackgroundChange(record.cell, 'background-redo');
        return true;
      }
      return false;
    }

    function applyCellBackground(token) {
      if (!activeTableCell || !activeTableCell.isConnected || (token && !FEISHU_CELL_BACKGROUNDS[token])) return false;
      const cell = activeTableCell;
      const before = getCellBackgroundState(cell);
      const after = { token: token || '', style: token ? FEISHU_CELL_BACKGROUNDS[token] : '' };
      if (before.token === after.token && (after.token || before.style === after.style)) return false;
      setCellBackgroundState(cell, after);
      cellBackgroundUndoStack.push({ cell: cell, before: before, after: after });
      cellBackgroundRedoStack.length = 0;
      syncCellBackgroundChange(cell, 'background');
      return true;
    }


    function positionTableCellTools() {
      if (!activeTableCell || !activeTableCell.isConnected || !menu.classList.contains('active')) return;
      const rect = activeTableCell.getBoundingClientRect();
      const outsideViewport = rect.bottom < 40 || rect.top > win.innerHeight - 24 || rect.right < 0 || rect.left > win.innerWidth;
      menu.style.visibility = outsideViewport ? 'hidden' : 'visible';
      if (outsideViewport) return;
      const toolsHeight = menu.offsetHeight;
      let top = rect.top - toolsHeight - 8;
      if (top < 44) top = rect.bottom + 8;
      if (top + toolsHeight > win.innerHeight - 28) top = Math.max(44, win.innerHeight - toolsHeight - 28);
      const left = Math.max(8, Math.min(rect.left, win.innerWidth - menu.offsetWidth - 8));
      menu.style.top = top + 'px';
      menu.style.left = left + 'px';
    }

    function setActiveCell(cell) {
      if (activeTableCell && activeTableCell !== cell) activeTableCell.classList.remove('table-cell-selected');
      activeTableCell = cell && editor.contains(cell) ? cell : null;
      return activeTableCell;
    }

    function getActiveCell() {
      return activeTableCell && activeTableCell.isConnected ? activeTableCell : null;
    }

    function showTableCellTools(cell) {
      if (!cell || isSourceMode()) return false;
      hideTextColorPalette();
      setActiveCell(cell);
      cell.classList.add('table-cell-selected');
      menu.classList.add('active');
      tools.mergeRight.disabled = !getMergeRightTarget(cell);
      tools.mergeDown.disabled = !getMergeDownTarget(cell);
      tools.split.disabled = cell.colSpan === 1 && cell.rowSpan === 1;
      tools.deleteRow.disabled = !canDeleteSelectedTableRow();
      tools.deleteColumn.disabled = !canDeleteSelectedTableColumn();
      updateCellBackgroundPalette();
      win.requestAnimationFrame(positionTableCellTools);
      return true;
    }

    function hideTableCellTools() {
      if (activeTableCell) activeTableCell.classList.remove('table-cell-selected');
      activeTableCell = null;
      menu.classList.remove('active');
      menu.style.visibility = '';
    }

    function listen(target, type, listener, optionsValue) {
      target.addEventListener(type, listener, optionsValue);
      removers.push(function() { target.removeEventListener(type, listener, optionsValue); });
    }

    function bind() {
      if (bound) return api;
      bound = true;
      listen(editor, 'click', function(event) {
        const cell = event.target.closest && event.target.closest('th,td');
        hideTableCellTools();
        if (cell && editor.contains(cell)) setActiveCell(cell);
      });
      listen(editor, 'contextmenu', function(event) {
        const cell = event.target.closest && event.target.closest('th,td');
        if (!cell || !editor.contains(cell)) {
          hideTableCellTools();
          return;
        }
        event.preventDefault();
        showTableCellTools(cell);
      });
      listen(menu, 'mousedown', function(event) { event.preventDefault(); });
      listen(menu, 'click', function(event) {
        if (event.target.closest('button') && !event.target.closest('[data-cell-background]')) clearCellBackgroundHistory();
      }, true);
      document.querySelectorAll('[data-cell-background]').forEach(function(button) {
        listen(button, 'click', function() { applyCellBackground(button.dataset.cellBackground); });
      });
      listen(tools.mergeRight, 'click', mergeTableCellRight);
      listen(tools.mergeDown, 'click', mergeTableCellDown);
      listen(tools.split, 'click', splitTableCell);
      listen(tools.insertRowAbove, 'click', function() { insertTableRow('above'); });
      listen(tools.insertRowBelow, 'click', function() { insertTableRow('below'); });
      listen(tools.insertColumnLeft, 'click', function() { insertTableColumn('left'); });
      listen(tools.insertColumnRight, 'click', function() { insertTableColumn('right'); });
      listen(tools.deleteRow, 'click', deleteSelectedTableRow);
      listen(tools.deleteColumn, 'click', deleteSelectedTableColumn);
      listen(tools.deleteTable, 'click', deleteSelectedTable);
      listen(document, 'mousedown', function(event) {
        if (menu.contains(event.target)) return;
        const cell = event.target.closest && event.target.closest('th,td');
        if (cell && editor.contains(cell)) return;
        hideTableCellTools();
      });
      if (editorWrapper) listen(editorWrapper, 'scroll', positionTableCellTools);
      listen(editor, 'scroll', positionTableCellTools, true);
      listen(win, 'resize', positionTableCellTools);
      listen(document, 'keydown', function(event) {
        const key = event.key.toLowerCase();
        if (event.ctrlKey && !event.altKey && key === 'z' && !event.shiftKey && cellBackgroundUndoStack.length) {
          if (undoCellBackground()) event.preventDefault();
          return;
        }
        if (event.ctrlKey && !event.altKey && ((key === 'y' && !event.shiftKey) || (key === 'z' && event.shiftKey)) && cellBackgroundRedoStack.length) {
          if (redoCellBackground()) event.preventDefault();
          return;
        }
        if (event.key === 'Escape' && menu.classList.contains('active')) hideTableCellTools();
      });
      return api;
    }

    function unbind() {
      while (removers.length) removers.pop()();
      bound = false;
      hideTableCellTools();
    }

    const api = Object.freeze({
      backgrounds: FEISHU_CELL_BACKGROUNDS,
      normalizeImportedCssBackground: normalizeImportedCssBackground,
      getFeishuCellBackgroundToken: getFeishuCellBackgroundToken,
      getImportedBackgroundDescriptor: getImportedBackgroundDescriptor,
      collectScopedElements: collectScopedElements,
      normalizeImportedCellBackgrounds: normalizeImportedCellBackgrounds,
      buildTableGrid: buildTableGrid,
      getTableCellContext: getTableCellContext,
      getActiveCell: getActiveCell,
      setActiveCell: setActiveCell,
      notifyChanged: notifyChanged,
      mergeTableCellRight: mergeTableCellRight,
      mergeTableCellDown: mergeTableCellDown,
      splitTableCell: splitTableCell,
      insertTableRow: insertTableRow,
      insertTableColumn: insertTableColumn,
      deleteSelectedTableRow: deleteSelectedTableRow,
      deleteSelectedTableColumn: deleteSelectedTableColumn,
      deleteSelectedTable: deleteSelectedTable,
      createFeishuTableClone: createFeishuTableClone,
      getCellBackgroundState: getCellBackgroundState,
      setCellBackgroundState: setCellBackgroundState,
      applyCellBackground: applyCellBackground,
      undoCellBackground: undoCellBackground,
      redoCellBackground: redoCellBackground,
      clearCellBackgroundHistory: clearCellBackgroundHistory,
      showTableCellTools: showTableCellTools,
      hideTableCellTools: hideTableCellTools,
      positionTableCellTools: positionTableCellTools,
      bind: bind,
      unbind: unbind
    });

    bind();
    return api;
  }

  namespace.Tables = Object.freeze({ create: create });
})(window);
