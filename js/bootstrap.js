(function(global) {
  'use strict';
  const namespace = global.MDViewer || (global.MDViewer = {});

  function create(options) {
    options = options || {};
    const win = options.window || global;
    const document = options.document || win.document;
    let context = null;
    let composed = false;
    let bridged = false;
    let started = false;

    function compose() {
      if (composed) return context;
      const byId = function(id) { return document.getElementById(id); };
      const colors = Object.freeze({
        red: '#d83931', orange: '#de7802', yellow: '#dc9b04', green: '#2d9f46',
        blue: '#3370ff', purple: '#7b67ee', gray: '#646a73'
      });
      const nextContext = namespace.Context.createContext({
        elements: {
          editor: byId('editor'), sourceEditor: byId('sourceEditor'), editorWrapper: byId('editorWrapper'),
          fileInput: byId('fileInput'), dragOverlay: byId('dragOverlay'), filename: byId('filename'),
          wordCount: byId('wordCount'), lineCount: byId('lineCount'), lastModified: byId('lastModified'),
          modifiedIndicator: byId('modifiedIndicator'), linkFileHint: byId('linkFileHint'),
          fileList: byId('fileList'), outlineList: byId('outlineList'), sidebar: byId('sidebar'),
          sidebarResize: byId('sidebarResize'), tabFiles: byId('tabFiles'), tabOutline: byId('tabOutline'),
          sourceBtn: byId('sourceBtn'), widthBtn: byId('widthBtn'), themeBtn: byId('themeBtn'),
          minimap: byId('minimap'), minimapMarkers: byId('minimapMarkers'), minimapThumb: byId('minimapThumb'),
          backToTop: byId('backToTop'), lightbox: byId('lightbox'), textColorPalette: byId('textColorPalette'),
          textColorBtn: byId('textColorBtn'), fileBrowser: byId('fileBrowser'), fbPathInput: byId('fbPathInput'),
          fbList: byId('fbList'), historyModal: byId('historyModal'), historyTitle: byId('historyTitle'),
          historyList: byId('historyList'), historyPreviewMeta: byId('historyPreviewMeta'),
          historyPreviewContent: byId('historyPreviewContent'), tableCellTools: byId('tableCellTools')
        },
        env: {
          protocol: win.location.protocol,
          hostname: win.location.hostname,
          isFileMode: win.location.protocol === 'file:',
          isServerMode: /https?:/.test(win.location.protocol) && /^(localhost|127\.0\.0\.1)$/.test(win.location.hostname),
          supportsFileSystemAccess: typeof win.showOpenFilePicker === 'function'
        },
        state: {
          viewMode: 'preview', isSourceMode: false, isSplitMode: false,
          theme: 'light', contentWidth: 'standard', modified: false,
          previewDirty: false, sessionDirty: false, ready: false, activeFileIndex: -1
        }
      });
      let mermaidSequence = 0;
      nextContext.registerPort('parser', namespace.Parser.create({
        document: document, textColors: colors, nextMermaidId: function() { return ++mermaidSequence; }
      }));
      nextContext.registerPort('editor', namespace.Editor.create({ context: nextContext }));
      nextContext.registerPort('files', namespace.Files.create({ context: nextContext }));
      nextContext.registerPort('history', namespace.History.create({
        window: win, context: nextContext,
        elements: { modal: byId('historyModal'), title: byId('historyTitle'), list: byId('historyList'),
          previewMeta: byId('historyPreviewMeta'), previewContent: byId('historyPreviewContent') }
      }));

      nextContext.registerPort('tables', namespace.Tables.create({
        window: win, document: document, context: nextContext, editor: byId('editor'), textColors: colors,
        tools: {
          menu: byId('tableCellTools'), editorWrapper: byId('editorWrapper'),
          mergeRight: byId('mergeCellRightBtn'), mergeDown: byId('mergeCellDownBtn'), split: byId('splitCellBtn'),
          insertRowAbove: byId('insertRowAboveBtn'), insertRowBelow: byId('insertRowBelowBtn'),
          insertColumnLeft: byId('insertColumnLeftBtn'), insertColumnRight: byId('insertColumnRightBtn'),
          deleteRow: byId('deleteTableRowBtn'), deleteColumn: byId('deleteTableColumnBtn'), deleteTable: byId('deleteTableBtn')
        }
      }));
      nextContext.registerPort('clipboard', namespace.Clipboard.create({
        window: win, document: document, location: win.location, context: nextContext,
        editor: byId('editor'), sourceEditor: byId('sourceEditor'), textColors: colors
      }));
      nextContext.registerPort('ui', namespace.UI.create({ context: nextContext }));
      nextContext.registerPort('sourceTools', namespace.SourceTools.create({ context: nextContext }));
      nextContext.registerPort('search', namespace.Search.create({ context: nextContext }));
      nextContext.registerPort('mermaidTools', namespace.MermaidTools.create({ context: nextContext }));
      context = nextContext;
      namespace.app = context;
      composed = true;
      return context;
    }

    function bridge() {
      compose();
      if (bridged) return;
      bridged = true;
      const editorNames = ['fmt','insertHeading','insertCodeBlock','insertLink','insertImage','insertQuote',
        'insertChecklist','insertTable','insertHR','insertMermaid','toggleSource','toggleSplit'];
      const fileNames = ['openFile','reloadFile','saveFile','saveAll','switchFile','closeFile','relinkCurrentFile',
        'closeFileBrowser','fbGoUp','fbNavigate'];
      const uiNames = ['toggleSidebar','switchTab','scrollToHeading','toggleTextColorPalette','toggleContentWidth','toggleTheme','copyCode'];
      editorNames.forEach(function(name) {
        win[name] = function() { return context.getPort('editor').invoke(name, arguments); };
      });
      fileNames.forEach(function(name) {
        win[name] = function() { return context.getPort('files')[name].apply(null, arguments); };
      });
      uiNames.forEach(function(name) {
        win[name] = function() { return context.getPort('ui')[name].apply(null, arguments); };
      });
      ['showHistory','closeHistory','clearCurrentHistory','restoreHistorySnapshot'].forEach(function(name) {
        win[name] = function() { return context.getPort('history')[name].apply(null, arguments); };
      });
    }

    function start() {
      compose(); bridge();
      if (started) return api;
      started = true;
      if ('serviceWorker' in win.navigator) {
        win.navigator.serviceWorker.getRegistrations().then(function(registrations) {
          registrations.forEach(function(registration) { registration.unregister(); });
        }).catch(function() {});
      }
      context.getPort('sourceTools').start();
      context.getPort('editor').start();
      context.getPort('search').start();
      context.getPort('mermaidTools').start();
      context.getPort('ui').start();
      Promise.resolve(context.getPort('files').start()).then(function() {
        const previous = context.state.get('ready');
        context.state.set('ready', true);
        context.emit('state:changed', { key: 'ready', value: true, previous: previous });
        context.emit('app:ready', context);
        if (namespace.Desktop && namespace.Desktop.available) namespace.Desktop.start(context);
      }).catch(function(error) {
        started = false;
        console.error('MDViewer startup failed.', error);
      });
      return api;
    }

    const api = Object.freeze({ compose: compose, bridge: bridge, start: start });
    return api;
  }

  namespace.Bootstrap = Object.freeze({ create: create });
  const app = namespace.Bootstrap.create({ window: global, document: global.document });
  if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', app.start);
  else app.start();
})(window);