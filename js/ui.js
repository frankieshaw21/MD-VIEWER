(function(global) {
  'use strict';
  const namespace = global.MDViewer || (global.MDViewer = {});

  function create(options) {
    options = options || {};
    const context = options.context;
    if (!context || typeof context.getPort !== 'function') throw new TypeError('UI requires context');

    let started = false;
    let editor, files, history;
    let minimapFrame = null;
    let minimapUpdateFrame = null;
    let headingTrackingTimer = null;
    let draggingMinimap = false;
    let editorEl, sourceEditor, wrapper, sidebar, fileList, outlineList;

    function emit(name, payload) { context.emit(name, payload); }
    function setState(key, value) {
      const previous = context.state.get(key);
      context.state.set(key, value);
      if (previous !== value) emit('state:changed', { key: key, value: value, previous: previous });
      return value;
    }
    function escapeHtml(value) {
      const div = document.createElement('div'); div.textContent = String(value || ''); return div.innerHTML;
    }
    function formatTime(value) {
      const date = new Date(Number(value));
      if (!value || Number.isNaN(date.getTime())) return '--';
      const pad = function(number) { return String(number).padStart(2, '0'); };
      return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' +
        pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds());
    }

    function renderFileList(payload) {
      const entries = payload && payload.files ? payload.files : files.listFiles();
      fileList.innerHTML = '';
      entries.forEach(function(file) {
        const item = document.createElement('li');
        item.className = file.active ? 'active' : '';
        item.dataset.fileIndex = file.index;
        const icon = document.createElement('span'); icon.textContent = '📄';
        const name = document.createElement('span'); name.textContent = file.name;
        const close = document.createElement('span'); close.className = 'close-btn'; close.textContent = '×';
        close.dataset.closeFile = file.index;
        item.append(icon, name, close); fileList.appendChild(item);
      });
    }

    function renderActive(payload) {
      const file = payload && payload.file;
      const filename = context.elements.filename;
      const modifiedIndicator = context.elements.modifiedIndicator;
      const lastModified = context.elements.lastModified;
      filename.textContent = file ? file.name : '未打开文件';
      filename.classList.toggle('modified', Boolean(payload && payload.modified));
      modifiedIndicator.textContent = payload && payload.modified ? '已修改' : '';
      lastModified.textContent = '更新时间: ' + formatTime(file && file.lastModified);
      renderPermission(file);
    }
    function renderModified(payload) {
      const file = payload.file;
      context.elements.filename.classList.toggle('modified', payload.modified);
      context.elements.modifiedIndicator.textContent = payload.modified ? '已修改' : '';
      if (file) context.elements.filename.textContent = file.name;
    }
    function renderMetadata(payload) {
      if (!payload || payload.file !== files.getActiveFile()) return;
      context.elements.lastModified.textContent = '更新时间: ' + formatTime(payload.file.lastModified);
    }
    function renderPermission(file) {
      const hint = document.getElementById('linkFileHint'); if (!hint) return;
      const needed = file && !file.serverPath && (!file.handle || file.needsPermission);
      hint.style.display = needed ? '' : 'none';
      if (needed) hint.textContent = file.handle
        ? '⚠ 点击授权文件访问，启用实时更新' : '⚠ 点击重新关联文件，启用实时更新';
    }
    function showSaved(payload) {
      const name = payload.file ? payload.file.name : 'document.md';
      context.elements.filename.textContent = name + ' ✓ 已保存';
      setTimeout(function() {
        const active = files.getActiveFile(); context.elements.filename.textContent = active ? active.name : '未打开文件';
      }, 1800);
      context.elements.modifiedIndicator.textContent = '';
    }

    function scheduleActiveHeading() {
      if (headingTrackingTimer) return;
      headingTrackingTimer = setTimeout(function() {
        headingTrackingTimer = null;
        editor.updateActiveHeading();
      }, 100);
    }

    function toggleSidebar() { sidebar.classList.toggle('hidden'); }
    function scrollToHeading(index) { return editor.scrollToHeading(index); }
    function switchTab(tab) {
      document.getElementById('tabFiles').classList.toggle('active', tab === 'files');
      document.getElementById('tabOutline').classList.toggle('active', tab === 'outline');
      fileList.style.display = tab === 'files' ? '' : 'none';
      outlineList.style.display = tab === 'outline' ? '' : 'none';
      if (tab === 'outline') editor.updateOutline();
    }

    function applyContentWidth(mode, persist) {
      const modes = ['standard','wide','full'];
      const contentWidth = modes.includes(mode) ? mode : 'standard';
      document.body.classList.remove('width-wide','width-full');
      if (contentWidth !== 'standard') document.body.classList.add('width-' + contentWidth);
      const labels = { standard: '标准', wide: '宽版', full: '全宽' };
      const button = document.getElementById('widthBtn'); button.textContent = labels[contentWidth];
      button.dataset.tip = '内容宽度：' + labels[contentWidth] + '（点击切换）';
      setState('contentWidth', contentWidth);
      if (persist !== false) localStorage.setItem('md-viewer-content-width', contentWidth);
      scheduleMinimapRefresh();
    }
    function toggleContentWidth() {
      const modes = ['standard','wide','full'];
      const current = context.state.get('contentWidth') || 'standard';
      applyContentWidth(modes[(modes.indexOf(current) + 1) % modes.length], true);
    }

    function applyTheme(value, persist) {
      const theme = ['light','eye-care','dark'].includes(value) ? value : 'light';
      document.body.classList.remove('dark','eye-care');
      if (theme !== 'light') document.body.classList.add(theme);
      document.getElementById('themeBtn').textContent = theme === 'light' ? '🌙' : theme === 'eye-care' ? '🌿' : '☀️';
      setState('theme', theme);
      if (persist !== false) localStorage.setItem('md-viewer-theme', theme);
      if (typeof global.mermaid !== 'undefined') {
        try { global.mermaid.initialize({ startOnLoad: false, theme: theme === 'dark' ? 'dark' : 'default', securityLevel: 'loose' }); }
        catch (error) { console.warn('Mermaid appearance update failed.', error); }
      }
      const file = files.getActiveFile();
      if (file && editorEl.querySelector('.mermaid-container')) editor.replaceDocument(editor.getContent({ flush: true }), { source: 'appearance' });
    }
    function toggleTheme() {
      const theme = context.state.get('theme') || 'light';
      applyTheme(theme === 'light' ? 'eye-care' : theme === 'eye-care' ? 'dark' : 'light', true);
    }

    function paletteElements() {
      return { palette: document.getElementById('textColorPalette'), button: document.getElementById('textColorBtn') };
    }
    function positionTextColorPalette() {
      const elements = paletteElements(); if (!elements.palette.classList.contains('active')) return;
      const rect = elements.button.getBoundingClientRect();
      elements.palette.style.top = Math.max(8, Math.min(global.innerHeight - elements.palette.offsetHeight - 8, rect.bottom + 7)) + 'px';
      elements.palette.style.left = Math.max(8, Math.min(rect.left, global.innerWidth - elements.palette.offsetWidth - 8)) + 'px';
    }
    function hideTextColorPalette() {
      const elements = paletteElements(); elements.palette.classList.remove('active'); elements.button.classList.remove('active');
      elements.button.setAttribute('aria-expanded', 'false');
    }
    function toggleTextColorPalette() {
      const elements = paletteElements();
      if (elements.palette.classList.contains('active')) return hideTextColorPalette();
      if (!editor.captureColorSelection()) return;
      const tables = context.getPort('tables'); if (tables) tables.hideTableCellTools();
      elements.palette.classList.add('active'); elements.button.classList.add('active'); elements.button.setAttribute('aria-expanded', 'true');
      requestAnimationFrame(positionTextColorPalette);
    }
    function copyCode(button) {
      const code = button.closest('pre').querySelector('code'); if (!code) return;
      const done = function() { button.textContent = '已复制 ✓'; button.classList.add('copied');
        setTimeout(function() { button.textContent = '复制'; button.classList.remove('copied'); }, 2000); };
      const fallback = function() {
        const area = document.createElement('textarea'); area.value = code.textContent; document.body.appendChild(area);
        area.select(); document.execCommand('copy'); area.remove(); done();
      };
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(code.textContent).then(done).catch(fallback);
      } else fallback();
    }

    function updateMinimap() {
      const minimap = document.getElementById('minimap'); const thumb = document.getElementById('minimapThumb');
      const total = wrapper.scrollHeight; const visible = wrapper.clientHeight;
      if (total <= visible || context.state.get('isSourceMode')) { thumb.style.display = 'none'; return; }
      thumb.style.display = '';
      const height = Math.max(20, visible / total * minimap.clientHeight);
      thumb.style.height = height + 'px';
      thumb.style.top = (wrapper.scrollTop / (total - visible) * (minimap.clientHeight - height)) + 'px';
    }
    function scheduleMinimapUpdate() {
      if (minimapUpdateFrame !== null) return;
      minimapUpdateFrame = requestAnimationFrame(function() { minimapUpdateFrame = null; updateMinimap(); });
    }
    function updateMinimapMarkers() {
      const markers = document.getElementById('minimapMarkers'); const minimap = document.getElementById('minimap');
      const total = wrapper.scrollHeight;
      markers.innerHTML = Array.from(editorEl.querySelectorAll('h1,h2,h3')).map(function(heading) {
        return '<div class="marker ' + heading.tagName.toLowerCase() + '" style="top:' + (heading.offsetTop / total * minimap.clientHeight) + 'px"></div>';
      }).join('');
    }
    function scheduleMinimapRefresh() {
      if (minimapFrame !== null) return;
      minimapFrame = requestAnimationFrame(function() {
        minimapFrame = null; updateMinimap(); updateMinimapMarkers();
      });
    }

    function bindSidebarResize() {
      const handle = document.getElementById('sidebarResize'); let active = false, startX = 0, startWidth = 0;
      handle.addEventListener('mousedown', function(event) {
        event.preventDefault(); active = true; startX = event.clientX; startWidth = sidebar.offsetWidth;
        sidebar.classList.add('resizing'); handle.classList.add('active');
        document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none';
      });
      document.addEventListener('mousemove', function(event) {
        if (!active) return;
        sidebar.style.width = Math.max(140, Math.min(global.innerWidth * 0.5, startWidth + event.clientX - startX)) + 'px';
      });
      document.addEventListener('mouseup', function() {
        if (!active) return; active = false; sidebar.classList.remove('resizing'); handle.classList.remove('active');
        document.body.style.cursor = ''; document.body.style.userSelect = '';
        localStorage.setItem('md-viewer-sidebar-width', sidebar.style.width);
      });
      const saved = localStorage.getItem('md-viewer-sidebar-width'); if (saved) sidebar.style.width = saved;
    }

    function bindMinimap() {
      const minimap = document.getElementById('minimap'); const thumb = document.getElementById('minimapThumb');
      thumb.addEventListener('mousedown', function(event) { event.preventDefault(); draggingMinimap = true; minimap.classList.add('active'); });
      document.addEventListener('mousemove', function(event) {
        if (!draggingMinimap) return;
        const rect = minimap.getBoundingClientRect(); const ratio = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
        wrapper.scrollTop = ratio * (wrapper.scrollHeight - wrapper.clientHeight);
      });
      document.addEventListener('mouseup', function() { draggingMinimap = false; minimap.classList.remove('active'); });
      minimap.addEventListener('click', function(event) {
        if (event.target === thumb) return; const rect = minimap.getBoundingClientRect();
        wrapper.scrollTo({ top: (event.clientY - rect.top) / rect.height * (wrapper.scrollHeight - wrapper.clientHeight), behavior: 'smooth' });
      });
    }

    function bindEvents() {
      fileList.addEventListener('click', function(event) {
        const close = event.target.closest('[data-close-file]');
        if (close) return files.closeFile(close.dataset.closeFile, event);
        const item = event.target.closest('[data-file-index]'); if (item) files.switchFile(item.dataset.fileIndex);
      });
      outlineList.addEventListener('click', function(event) {
        const item = event.target.closest('[data-heading-index]'); if (item) scrollToHeading(item.dataset.headingIndex);
      });
      const palette = paletteElements();
      palette.button.addEventListener('pointerdown', function() { editor.invoke('rememberSelection'); }, true);
      palette.palette.addEventListener('mousedown', function(event) { event.preventDefault(); });
      palette.palette.querySelectorAll('[data-text-color]').forEach(function(button) {
        button.addEventListener('click', function() { editor.applyTextColor(button.dataset.textColor); hideTextColorPalette(); });
      });
      document.addEventListener('mousedown', function(event) {
        if (!palette.palette.contains(event.target) && !palette.button.contains(event.target)) hideTextColorPalette();
      });
      editorEl.addEventListener('click', function(event) {
        const copy = event.target.closest('.code-copy-btn');
        if (copy) {
          // Parser-rendered buttons keep the compatibility onclick bridge; only
          // handle buttons without that bridge here to avoid copying twice.
          if (!copy.hasAttribute('onclick')) copyCode(copy);
          return;
        }
        if (event.target.tagName === 'IMG' && !event.target.closest('.mermaid-container')) {
          const lightbox = document.getElementById('lightbox'); lightbox.querySelector('img').src = event.target.src; lightbox.classList.add('active');
        }
      });
      document.getElementById('lightbox').addEventListener('click', function(event) { event.currentTarget.classList.remove('active'); });
      wrapper.addEventListener('scroll', function() {
        scheduleMinimapUpdate(); scheduleActiveHeading(); hideTextColorPalette();
        document.getElementById('backToTop').classList.toggle('visible', wrapper.scrollTop > 300);
      });
      document.getElementById('backToTop').addEventListener('click', function() { wrapper.scrollTo({ top: 0, behavior: 'smooth' }); });
      document.addEventListener('dragover', function(event) { event.preventDefault(); context.elements.dragOverlay.classList.add('active'); });
      document.addEventListener('dragleave', function(event) { if (!event.relatedTarget) context.elements.dragOverlay.classList.remove('active'); });
      document.addEventListener('drop', function(event) {
        event.preventDefault(); context.elements.dragOverlay.classList.remove('active'); files.addFiles(event.dataTransfer.files);
      });
      global.addEventListener('resize', function() { positionTextColorPalette(); scheduleMinimapRefresh(); });
      document.getElementById('fileBrowser').addEventListener('click', function(event) { if (event.target === event.currentTarget) files.closeFileBrowser(); });
    }

    function bindShortcuts() {
      document.addEventListener('keydown', function(event) {
        const key = event.key.toLowerCase();
        if (event.key === 'Escape') {
          hideTextColorPalette(); document.getElementById('lightbox').classList.remove('active');
          files.closeFileBrowser(); history.closeHistory();
        }
        if (!event.ctrlKey) return;
        if (key === 'o') { event.preventDefault(); files.openFile(); }
        else if (key === 's') { event.preventDefault(); files.saveFile(); }
        else if (key === 'r') { event.preventDefault(); files.reloadFile(); }
        else if (key === '/') { event.preventDefault(); editor.invoke('toggleSource'); }
        else if (key === 'p') { event.preventDefault(); global.print(); }
        else if (key === 'b') { event.preventDefault(); editor.invoke('fmt', ['bold']); }
        else if (key === 'i') { event.preventDefault(); editor.invoke('fmt', ['italic']); }
      });
    }

    function subscribe() {
      context.on('files:list-changed', renderFileList);
      context.on('file:activated', renderActive);
      context.on('file:modified', renderModified);
      context.on('file:metadata-changed', renderMetadata);
      context.on('document:saved', showSaved);
      context.on('permission:changed', function(payload) { renderPermission(payload.file); });
      context.on('file:external-conflict', function() { context.elements.modifiedIndicator.textContent = '有未保存修改（磁盘文件也已更新）'; });
      context.on('document:changed', editor.scheduleOutline);
      context.on('document:replaced', function() { editor.scheduleOutline(); scheduleMinimapRefresh(); });
      context.on('mode:changed', function() { editor.updateOutline(); scheduleMinimapRefresh(); });
      context.on('render:completed', function() { editor.updateOutline(); scheduleMinimapRefresh(); });
      context.on('render:enhanced', scheduleMinimapRefresh);
    }

    function start() {
      if (started) return api;
      editor = context.getPort('editor'); files = context.getPort('files'); history = context.getPort('history');
      if (!editor || !files || !history) throw new Error('UI dependencies are incomplete');
      editorEl = context.elements.editor; sourceEditor = context.elements.sourceEditor;
      wrapper = document.getElementById('editorWrapper'); sidebar = context.elements.sidebar;
      fileList = context.elements.fileList; outlineList = context.elements.outlineList;
      started = true;
      subscribe(); bindEvents(); bindShortcuts(); bindSidebarResize(); bindMinimap();
      applyTheme(localStorage.getItem('md-viewer-theme') || context.state.get('theme') || 'light', false);
      applyContentWidth(localStorage.getItem('md-viewer-content-width') || context.state.get('contentWidth') || 'standard', false);
      renderFileList(); editor.updateOutline(); scheduleMinimapRefresh();
      return api;
    }

    const api = Object.freeze({
      start: start, toggleSidebar: toggleSidebar, switchTab: switchTab,
      scrollToHeading: scrollToHeading, toggleTextColorPalette: toggleTextColorPalette,
      hideTextColorPalette: hideTextColorPalette, toggleContentWidth: toggleContentWidth,
      toggleTheme: toggleTheme, copyCode: copyCode
    });
    return api;
  }

  namespace.UI = Object.freeze({ create: create });
})(window);