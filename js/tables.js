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
    const selectedTableCells = new Set();
    const tableUndoStack = [];
    const tableRedoStack = [];
    const removers = [];
    const TABLE_HISTORY_LIMIT = 50;
    let selectionAnchorCell = null;
    let dragStartCell = null;
    let suppressSelectionClick = false;
    let historyRestoring = false;
    let tableHistoryArmed = false;
    let bound = false;


    function notifyChanged(type) {
      if (context && typeof context.emit === 'function') context.emit('table:changed', { type: type });
    }

    function emitChanged(type) {
      schedulePreviewSync();
      notifyChanged(type);
    }

    function getCurrentMarkdown() {
      return context.getPort('editor').getContent({ flush: true });
    }

    function captureTableHistory() {
      if (historyRestoring) return;
      const snapshot = getCurrentMarkdown();
      if (tableUndoStack[tableUndoStack.length - 1] !== snapshot) {
        tableUndoStack.push(snapshot);
        if (tableUndoStack.length > TABLE_HISTORY_LIMIT) tableUndoStack.shift();
      }
      tableRedoStack.length = 0;
      tableHistoryArmed = true;
    }

    function restoreTableHistory(source, destination, type) {
      if (!source.length) return false;
      const snapshot = source.pop();
      const current = getCurrentMarkdown();
      if (destination[destination.length - 1] !== current) {
        destination.push(current);
        if (destination.length > TABLE_HISTORY_LIMIT) destination.shift();
      }
      historyRestoring = true;
      tableHistoryArmed = true;
      Promise.resolve(context.getPort('files').replaceActiveContent(snapshot, { source: type }))
        .finally(function() { historyRestoring = false; });
      notifyChanged(type);
      return true;
    }

    function undoTableEdit() {
      return restoreTableHistory(tableUndoStack, tableRedoStack, 'table-undo');
    }

    function redoTableEdit() {
      return restoreTableHistory(tableRedoStack, tableUndoStack, 'table-redo');
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
      if (!cell || !target || selectedTableCells.size > 1) return false;
      captureTableHistory();
      appendMergedCellContent(cell, target);
      cell.colSpan += target.colSpan;
      target.remove();
      finishTableStructureEdit(cell, 'merge-right');
      return true;
    }

    function mergeTableCellDown() {
      const cell = activeTableCell;
      const target = getMergeDownTarget(cell);
      if (!cell || !target || selectedTableCells.size > 1) return false;
      captureTableHistory();
      appendMergedCellContent(cell, target);
      cell.rowSpan += target.rowSpan;
      target.remove();
      finishTableStructureEdit(cell, 'merge-down');
      return true;
    }

    function splitTableCell() {
      const cell = activeTableCell;
      const tableContext = getTableCellContext(cell);
      if (!tableContext || selectedTableCells.size > 1 || (tableContext.origin.rowSpan === 1 && tableContext.origin.colSpan === 1)) return false;
      captureTableHistory();
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
      if (!tableContext || selectedTableCells.size > 1) return false;
      captureTableHistory();
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
      if (!tableContext || selectedTableCells.size > 1) return false;
      captureTableHistory();
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
      if (!tableContext || selectedTableCells.size > 1 || !canDeleteSelectedTableRow()) return false;
      captureTableHistory();
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
      if (!tableContext || selectedTableCells.size > 1 || !canDeleteSelectedTableColumn()) return false;
      captureTableHistory();
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
      captureTableHistory();
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

    function createSelectedTableClone() {
      const cells = getSelectedCells();
      if (!cells.length) return null;
      const table = cells[0].closest('table');
      if (!table || cells.some(function(cell) { return cell.closest('table') !== table; })) return null;
      const tableContext = buildTableGrid(table);
      const origins = cells.map(function(cell) { return tableContext.origins.get(cell); }).filter(Boolean);
      if (!origins.length) return null;
      const top = Math.min.apply(Math, origins.map(function(origin) { return origin.row; }));
      const left = Math.min.apply(Math, origins.map(function(origin) { return origin.col; }));
      const bottom = Math.max.apply(Math, origins.map(function(origin) { return origin.row + origin.rowSpan - 1; }));
      const right = Math.max.apply(Math, origins.map(function(origin) { return origin.col + origin.colSpan - 1; }));
      const selected = new Set(cells);
      const clone = document.createElement('table');
      const body = clone.createTBody();
      for (let row = top; row <= bottom; row++) {
        const cloneRow = body.insertRow();
        for (let column = left; column <= right; column++) {
          const entry = tableContext.grid[row] && tableContext.grid[row][column];
          if (!entry || !selected.has(entry.cell)) {
            cloneRow.insertCell().innerHTML = '<br>';
            continue;
          }
          const origin = tableContext.origins.get(entry.cell);
          const firstRow = Math.max(top, origin.row);
          const firstColumn = Math.max(left, origin.col);
          if (row !== firstRow || column !== firstColumn) continue;
          const cellClone = entry.cell.cloneNode(true);
          cellClone.classList.remove('table-cell-selected', 'table-cell-multi-selected', 'table-cell-selection-anchor');
          const rowSpan = Math.min(bottom + 1, origin.row + origin.rowSpan) - firstRow;
          const colSpan = Math.min(right + 1, origin.col + origin.colSpan) - firstColumn;
          if (rowSpan > 1) cellClone.rowSpan = rowSpan; else cellClone.removeAttribute('rowspan');
          if (colSpan > 1) cellClone.colSpan = colSpan; else cellClone.removeAttribute('colspan');
          cloneRow.appendChild(cellClone);
        }
      }
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
      const cells = getSelectedCells();
      const tokens = new Set((cells.length ? cells : activeTableCell ? [activeTableCell] : [])
        .map(function(cell) { return cell.getAttribute('background-color') || ''; }));
      const activeToken = tokens.size === 1 ? Array.from(tokens)[0] : '';
      document.querySelectorAll('[data-cell-background]').forEach(function(button) {
        button.setAttribute('aria-pressed', String(button.dataset.cellBackground === activeToken));
      });
    }

    function clearCellBackgroundHistory() {
      if (historyRestoring) return;
      tableUndoStack.length = 0;
      tableRedoStack.length = 0;
      tableHistoryArmed = false;
    }

    function getSelectedCells() {
      return Array.from(selectedTableCells).filter(function(cell) { return cell.isConnected; });
    }

    function syncCellBackgroundChange(cells, type) {
      if (cells.indexOf(activeTableCell) >= 0) updateCellBackgroundPalette();
      emitChanged(type);
      win.requestAnimationFrame(positionTableCellTools);
    }

    function undoCellBackground() {
      return undoTableEdit();
    }

    function redoCellBackground() {
      return redoTableEdit();
    }

    function applyCellBackground(token) {
      if (!activeTableCell || !activeTableCell.isConnected || (token && !FEISHU_CELL_BACKGROUNDS[token])) return false;
      let cells = getSelectedCells();
      if (!cells.length || cells.indexOf(activeTableCell) < 0) cells = [activeTableCell];
      const after = { token: token || '', style: token ? FEISHU_CELL_BACKGROUNDS[token] : '' };
      const changedCells = cells.filter(function(cell) {
        const before = getCellBackgroundState(cell);
        return before.token !== after.token || (!after.token && before.style !== after.style);
      });
      if (!changedCells.length) return false;
      captureTableHistory();
      changedCells.forEach(function(cell) { setCellBackgroundState(cell, after); });
      syncCellBackgroundChange(changedCells, 'background');
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

    function clearSelectedCells() {
      selectedTableCells.forEach(function(cell) {
        cell.classList.remove('table-cell-multi-selected', 'table-cell-selection-anchor');
      });
      selectedTableCells.clear();
      selectionAnchorCell = null;
    }

    function setSelectedCellList(cells, activeCell, anchorCell) {
      clearSelectedCells();
      cells.filter(function(cell) { return cell && cell.isConnected && editor.contains(cell); }).forEach(function(cell) {
        selectedTableCells.add(cell);
        cell.classList.add('table-cell-multi-selected');
      });
      selectionAnchorCell = anchorCell && selectedTableCells.has(anchorCell) ? anchorCell : (cells[0] || null);
      if (selectionAnchorCell) selectionAnchorCell.classList.add('table-cell-selection-anchor');
      setActiveCell(activeCell && selectedTableCells.has(activeCell) ? activeCell : selectionAnchorCell);
      return getSelectedCells();
    }

    function selectSingleCell(cell) {
      return setSelectedCellList(cell ? [cell] : [], cell, cell);
    }

    function selectCellRange(anchor, target) {
      if (!anchor || !target || anchor.closest('table') !== target.closest('table')) return selectSingleCell(target);
      const tableContext = buildTableGrid(target.closest('table'));
      const start = tableContext.origins.get(anchor);
      const end = tableContext.origins.get(target);
      if (!start || !end) return selectSingleCell(target);
      const top = Math.min(start.row, end.row);
      const bottom = Math.max(start.row + start.rowSpan - 1, end.row + end.rowSpan - 1);
      const left = Math.min(start.col, end.col);
      const right = Math.max(start.col + start.colSpan - 1, end.col + end.colSpan - 1);
      const cells = [];
      tableContext.origins.forEach(function(origin, cell) {
        const intersects = origin.row <= bottom && origin.row + origin.rowSpan - 1 >= top &&
          origin.col <= right && origin.col + origin.colSpan - 1 >= left;
        if (intersects) cells.push(cell);
      });
      return setSelectedCellList(cells, target, anchor);
    }

    function toggleSelectedCell(cell) {
      if (!cell) return [];
      const current = getSelectedCells();
      if (current.length && current[0].closest('table') !== cell.closest('table')) return selectSingleCell(cell);
      if (selectedTableCells.has(cell)) selectedTableCells.delete(cell);
      else selectedTableCells.add(cell);
      const cells = Array.from(selectedTableCells);
      return setSelectedCellList(cells.length ? cells : [cell], cell, selectionAnchorCell || cell);
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
      if (!selectedTableCells.has(cell)) selectSingleCell(cell);
      else setActiveCell(cell);
      const multiple = selectedTableCells.size > 1;
      cell.classList.add('table-cell-selected');
      menu.classList.add('active');
      tools.mergeRight.disabled = multiple || !getMergeRightTarget(cell);
      tools.mergeDown.disabled = multiple || !getMergeDownTarget(cell);
      tools.split.disabled = multiple || (cell.colSpan === 1 && cell.rowSpan === 1);
      tools.insertRowAbove.disabled = multiple;
      tools.insertRowBelow.disabled = multiple;
      tools.insertColumnLeft.disabled = multiple;
      tools.insertColumnRight.disabled = multiple;
      tools.deleteRow.disabled = multiple || !canDeleteSelectedTableRow();
      tools.deleteColumn.disabled = multiple || !canDeleteSelectedTableColumn();
      updateCellBackgroundPalette();
      win.requestAnimationFrame(positionTableCellTools);
      return true;
    }

    function hideTableCellTools() {
      if (activeTableCell) activeTableCell.classList.remove('table-cell-selected');
      activeTableCell = null;
      clearSelectedCells();
      menu.classList.remove('active');
      menu.style.visibility = '';
    }

    function listen(target, type, listener, optionsValue) {
      target.addEventListener(type, listener, optionsValue);
      removers.push(function() { target.removeEventListener(type, listener, optionsValue); });
    }

    function getEventTableCell(event) {
      let node = event.target;
      let cell = node && node.closest ? node.closest('th,td') : null;
      if (!cell) {
        const selection = win.getSelection();
        node = selection && selection.anchorNode;
        if (node && node.nodeType !== 1) node = node.parentElement;
        cell = node && node.closest ? node.closest('th,td') : null;
      }
      return cell && editor.contains(cell) ? cell : null;
    }

    function getTableNavigationCells(table) {
      const tableContext = buildTableGrid(table);
      return Array.from(tableContext.origins.entries()).sort(function(left, right) {
        return left[1].row - right[1].row || left[1].col - right[1].col;
      }).map(function(entry) { return entry[0]; });
    }

    function focusTableCell(cell, atEnd) {
      if (!cell) return false;
      menu.classList.remove('active');
      menu.style.visibility = '';
      selectSingleCell(cell);
      try { editor.focus({ preventScroll: true }); } catch (error) { editor.focus(); }
      const range = document.createRange();
      range.selectNodeContents(cell);
      range.collapse(!atEnd);
      const selection = win.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      cell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      return true;
    }

    function handleTableTab(event) {
      if (event.key !== 'Tab' || event.ctrlKey || event.altKey || event.metaKey || isSourceMode()) return false;
      const cell = getEventTableCell(event);
      if (!cell) return false;
      const table = cell.closest('table');
      let cells = getTableNavigationCells(table);
      const currentIndex = cells.indexOf(cell);
      if (currentIndex < 0) return false;
      let target = cells[currentIndex + (event.shiftKey ? -1 : 1)];
      if (!target && !event.shiftKey) {
        const existingCells = new Set(cells);
        setActiveCell(cell);
        if (insertTableRow('below')) {
          cells = getTableNavigationCells(table);
          target = cells.find(function(candidate) { return !existingCells.has(candidate); });
        }
      }
      if (!target) return false;
      event.preventDefault();
      return focusTableCell(target, event.shiftKey);
    }

    function bind() {
      if (bound) return api;
      bound = true;
      listen(editor, 'mousedown', function(event) {
        if (event.button !== 0) return;
        const cell = getEventTableCell(event);
        dragStartCell = cell;
        if (!cell) return;
        if (event.shiftKey) {
          selectCellRange(selectionAnchorCell || activeTableCell || cell, cell);
          event.preventDefault();
        } else if (event.ctrlKey || event.metaKey) {
          toggleSelectedCell(cell);
          event.preventDefault();
        }
      });
      listen(editor, 'mouseover', function(event) {
        if (!dragStartCell || !(event.buttons & 1)) return;
        const cell = getEventTableCell(event);
        if (!cell || cell === dragStartCell || cell.closest('table') !== dragStartCell.closest('table')) return;
        suppressSelectionClick = true;
        selectCellRange(dragStartCell, cell);
        const selection = win.getSelection();
        if (selection) selection.removeAllRanges();
        event.preventDefault();
      });
      listen(document, 'mouseup', function() {
        dragStartCell = null;
      });
      listen(editor, 'click', function(event) {
        const cell = getEventTableCell(event);
        if (suppressSelectionClick) {
          suppressSelectionClick = false;
          event.preventDefault();
          return;
        }
        if (!cell) {
          hideTableCellTools();
          return;
        }
        menu.classList.remove('active');
        menu.style.visibility = '';
        if (!event.shiftKey && !event.ctrlKey && !event.metaKey) selectSingleCell(cell);
      });
      listen(editor, 'contextmenu', function(event) {
        const cell = getEventTableCell(event);
        if (!cell) {
          hideTableCellTools();
          return;
        }
        event.preventDefault();
        showTableCellTools(cell);
      });
      listen(menu, 'mousedown', function(event) { event.preventDefault(); });
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
        if (handleTableTab(event)) return;
        const key = event.key.toLowerCase();
        if (event.ctrlKey && !event.altKey && key === 'z' && !event.shiftKey && tableHistoryArmed && tableUndoStack.length) {
          if (undoTableEdit()) event.preventDefault();
          return;
        }
        if (event.ctrlKey && !event.altKey && ((key === 'y' && !event.shiftKey) || (key === 'z' && event.shiftKey)) &&
            tableHistoryArmed && tableRedoStack.length) {
          if (redoTableEdit()) event.preventDefault();
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
      getSelectedCells: getSelectedCells,
      selectSingleCell: selectSingleCell,
      selectCellRange: selectCellRange,
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
      createSelectedTableClone: createSelectedTableClone,
      getCellBackgroundState: getCellBackgroundState,
      setCellBackgroundState: setCellBackgroundState,
      applyCellBackground: applyCellBackground,
      undoTableEdit: undoTableEdit,
      redoTableEdit: redoTableEdit,
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
