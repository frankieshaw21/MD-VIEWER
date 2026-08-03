(function(global) {
  'use strict';
  const namespace = global.MDViewer || (global.MDViewer = {});

  function create(options) {
    options = options || {};
    const context = options.context;
    if (!context || typeof context.getPort !== 'function') throw new TypeError('Files requires context');
    const desktop = namespace.Desktop || { available: false };

    let started = false;
    let editor, history;
    let openFiles = [];
    let activeFileIndex = -1;
    let browserPath = '';
    let sessionRetryAt = 0;
    let sessionWarningShown = false;
    let sessionTimer = null;
    let handleDbPromise = null;
    let autoWatchTimer = null;
    let autoWatchBusy = false;
    let serverWatchTimer = null;
    let serverWatchBusy = false;
    let serverMtime = null;

    function emit(name, payload) { context.emit(name, payload); }
    function setState(key, value) {
      const previous = context.state.get(key);
      context.state.set(key, value);
      if (previous !== value) emit('state:changed', { key: key, value: value, previous: previous });
      return value;
    }
    function getActiveFile() { return activeFileIndex >= 0 ? openFiles[activeFileIndex] || null : null; }
    function getActiveIndex() { return activeFileIndex; }
    function getModified() { return Boolean(context.state.get('modified')); }
    function listFiles() {
      return openFiles.map(function(file, index) {
        return { index: index, name: file.name, modified: file.content !== file.savedContent,
          active: index === activeFileIndex, lastModified: file.lastModified || null,
          needsPermission: Boolean(file.needsPermission), serverPath: file.serverPath || null,
          desktopPath: file.desktopPath || null };
      });
    }
    function publishList() { emit('files:list-changed', { files: listFiles(), activeIndex: activeFileIndex }); }
    function markSessionDirty() { setState('sessionDirty', true); }
    function setModified(value) {
      const next = Boolean(value && getActiveFile());
      const previous = getModified();
      if (previous === next) { markSessionDirty(); return previous; }
      setState('modified', next);
      emit('file:modified', { file: getActiveFile(), modified: next });
      publishList();
      markSessionDirty();
      return next;
    }

    function updateActiveContent(content, meta) {
      const file = getActiveFile();
      if (!file) return false;
      file.content = String(content || '');
      const nextModified = file.content !== file.savedContent;
      setState('modified', nextModified);
      markSessionDirty();
      emit('file:content-updated', { file: file, content: file.content, modified: nextModified, meta: meta || null });
      emit('file:modified', { file: file, modified: nextModified });
      return true;
    }

    function getCurrentContent(file) {
      const current = getActiveFile();
      if (file && current === file && editor) return editor.getContent({ flush: true });
      return file ? String(file.content || '') : current ? String(current.content || '') : '';
    }

    async function replaceActiveContent(content, meta) {
      const file = getActiveFile();
      if (!file) return false;
      file.content = String(content || '');
      const nextModified = file.content !== file.savedContent;
      setState('modified', nextModified);
      editor.replaceDocument(file.content, meta || { source: 'files' });
      markSessionDirty();
      emit('file:modified', { file: file, modified: nextModified });
      return true;
    }

    function normalizeRecord(file, content, handle) {
      return {
        name: file.name, content: String(content || ''), savedContent: String(content || ''),
        handle: handle || null, serverPath: null, desktopPath: null, historyKey: null,
        lastModified: file.lastModified || Date.now(), fileSize: file.size,
        needsPermission: false
      };
    }

    function readBlobText(blob) {
      if (blob && typeof blob.text === 'function') return blob.text();
      return new Promise(function(resolve, reject) {
        const reader = new FileReader();
        reader.onload = function() { resolve(String(reader.result || '')); };
        reader.onerror = function() { reject(reader.error || new Error('无法读取文件')); };
        reader.readAsText(blob);
      });
    }

    async function addFile(file, handle) {
      const content = await readBlobText(file);
      const existing = openFiles.findIndex(function(item) {
        return handle ? item.handle === handle || item.name === file.name : item.name === file.name;
      });
      if (existing >= 0) {
        Object.assign(openFiles[existing], normalizeRecord(file, content, handle || openFiles[existing].handle));
        await switchFile(existing);
      } else {
        openFiles.push(normalizeRecord(file, content, handle));
        await switchFile(openFiles.length - 1);
        emit('file:opened', { file: getActiveFile(), index: activeFileIndex });
      }
      publishList(); markSessionDirty(); saveHandlesToDB();
      return getActiveFile();
    }

    async function addFiles(filesValue) {
      for (const file of Array.from(filesValue || [])) await addFile(file, null);
    }

    async function openFile() {
      if (desktop.available) {
        try { return openDesktopFiles(await desktop.openFilesDialog()); }
        catch (error) { alert(error.message); return false; }
      }
      if (context.env.isServerMode) return openFileBrowser();
      if (global.showOpenFilePicker) {
        try {
          const handles = await global.showOpenFilePicker({ multiple: true,
            types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md','.markdown','.txt'] } }] });
          for (const handle of handles) await addFile(await handle.getFile(), handle);
          return;
        } catch (error) {
          if (error.name !== 'AbortError') console.error(error);
          return;
        }
      }
      context.elements.fileInput.click();
    }

    async function switchFile(index) {
      index = Number(index);
      if (index < 0 || index >= openFiles.length) return false;
      const previous = getActiveFile();
      if (previous && editor) {
        previous.content = editor.getContent({ flush: true });
        await history.createHistorySnapshot(previous, '切换文件前', previous.content);
      }
      activeFileIndex = index;
      const file = getActiveFile();
      history.ensureHistoryKey(file);
      history.createHistorySnapshot(file, '打开文件', file.savedContent);
      const nextModified = file.content !== file.savedContent;
      setState('activeFileIndex', activeFileIndex);
      setState('modified', nextModified);
      editor.replaceDocument(file.content, { source: 'file-activation', index: index });
      emit('file:activated', { file: file, index: index, modified: nextModified });
      publishList(); markSessionDirty(); configureServerWatch();
      return true;
    }

    async function closeFile(index, event) {
      if (event) event.stopPropagation();
      index = Number(index);
      if (index < 0 || index >= openFiles.length) return false;
      const closed = openFiles[index];
      if (index === activeFileIndex && editor) closed.content = editor.getContent({ flush: true });
      if (closed.content !== closed.savedContent && !confirm('“' + closed.name + '”有未保存修改，确定关闭吗？')) return false;
      openFiles.splice(index, 1);
      emit('file:closed', { file: closed, index: index });
      if (!openFiles.length) {
        activeFileIndex = -1;
        setState('activeFileIndex', -1); setState('modified', false);
        editor.showEmpty(); emit('file:activated', { file: null, index: -1, modified: false });
      } else {
        if (index < activeFileIndex) activeFileIndex--;
        if (index === activeFileIndex || activeFileIndex >= openFiles.length) {
          activeFileIndex = Math.min(index, openFiles.length - 1);
          const file = getActiveFile();
          const nextModified = file.content !== file.savedContent;
          setState('modified', nextModified);
          editor.replaceDocument(file.content, { source: 'file-close' });
          emit('file:activated', { file: file, index: activeFileIndex, modified: nextModified });
        }
        setState('activeFileIndex', activeFileIndex);
      }
      publishList(); markSessionDirty(); saveHandlesToDB(); configureServerWatch();
      return true;
    }

    async function saveFile() {
      const file = getActiveFile();
      const content = editor.getContent({ flush: true });
      if (file) {
        file.content = content;
        await history.createHistorySnapshot(file, '保存前磁盘版本', file.savedContent);
        await history.createHistorySnapshot(file, '保存版本', content);
      }
      let savedToHandle = false;
      if (file && file.desktopPath && desktop.available) {
        try {
          const metadata = await desktop.writeFile(file.desktopPath, content);
          file.lastModified = metadata.lastModified; file.fileSize = metadata.size;
          savedToHandle = true;
        } catch (error) {
          alert('保存失败：' + error.message);
          return false;
        }
      }
      if (!savedToHandle && file && file.handle) {
        try {
          let permission = typeof file.handle.queryPermission === 'function'
            ? await file.handle.queryPermission({ mode: 'readwrite' }) : 'granted';
          if (permission !== 'granted' && typeof file.handle.requestPermission === 'function') {
            permission = await file.handle.requestPermission({ mode: 'readwrite' });
          }
          if (permission === 'granted') {
            const writable = await file.handle.createWritable();
            await writable.write(content); await writable.close();
            const diskFile = await file.handle.getFile();
            file.lastModified = diskFile.lastModified; file.fileSize = diskFile.size;
            savedToHandle = true;
          }
        } catch (error) { console.warn('Direct file save failed; using download fallback.', error); }
      }
      if (!savedToHandle) {
        const blob = new Blob([content], { type: 'text/markdown' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob); link.download = file ? file.name : 'document.md'; link.click();
        URL.revokeObjectURL(link.href);
      }
      if (file) file.savedContent = content;
      setState('modified', false); markSessionDirty();
      emit('document:saved', { file: file, content: content }); publishList();
      return true;
    }

    async function reloadFile() {
      const file = getActiveFile();
      if (!file) { alert('请先打开 Markdown 文件'); return false; }
      const local = editor.getContent({ flush: true });
      if (local !== file.savedContent && !confirm('当前文件有未保存修改。重新加载会丢弃修改，是否继续？')) return false;
      await history.createHistorySnapshot(file, '重新加载前', local);
      let content, diskFile;
      if (file.desktopPath && desktop.available) {
        const data = await desktop.readFile(file.desktopPath);
        content = data.content;
        diskFile = { lastModified: data.lastModified, size: data.size };
      } else if (file.serverPath) {
        const response = await fetch('/api/read?file=' + encodeURIComponent(file.serverPath));
        if (!response.ok) throw new Error('读取文件失败（HTTP ' + response.status + '）');
        content = await response.text();
      } else if (file.handle) {
        let permission = await file.handle.queryPermission({ mode: 'read' });
        if (permission !== 'granted') permission = await file.handle.requestPermission({ mode: 'read' });
        if (permission !== 'granted') throw new Error('未获得文件读取权限');
        diskFile = await file.handle.getFile(); content = await readBlobText(diskFile);
      } else {
        if (global.showOpenFilePicker) return relinkCurrentFile(true);
        const input = document.createElement('input'); input.type = 'file'; input.accept = '.md,.markdown,.txt';
        input.onchange = async function(event) {
          const selected = event.target.files[0]; if (!selected) return;
          const nextContent = await readBlobText(selected);
          file.name = selected.name; file.content = file.savedContent = nextContent;
          file.lastModified = selected.lastModified; file.fileSize = selected.size;
          setState('modified', false);
          editor.replaceDocument(nextContent, { source: 'reload' });
          emit('file:activated', { file: file, index: activeFileIndex, modified: false });
          markSessionDirty(); publishList();
        };
        input.click(); return true;
      }
      file.content = file.savedContent = content;
      if (diskFile) { file.lastModified = diskFile.lastModified; file.fileSize = diskFile.size; }
      setState('modified', false);
      editor.replaceDocument(content, { source: 'reload' });
      emit('file:activated', { file: file, index: activeFileIndex, modified: false });
      markSessionDirty(); publishList(); return true;
    }

    async function relinkCurrentFile(reloadAfter) {
      const file = getActiveFile();
      if (!file || !global.showOpenFilePicker) return false;
      try {
        let handle = file.handle;
        if (handle) {
          const permission = await handle.requestPermission({ mode: 'read' });
          if (permission !== 'granted') handle = null;
        }
        if (!handle) [handle] = await global.showOpenFilePicker({ multiple: false,
          types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md','.markdown','.txt'] } }] });
        file.handle = handle; file.needsPermission = false;
        emit('permission:changed', { file: file, permission: 'granted' });
        await saveHandlesToDB();
        if (reloadAfter) return reloadFile();
        const diskFile = await handle.getFile();
        file.name = diskFile.name; file.lastModified = diskFile.lastModified; file.fileSize = diskFile.size;
        publishList(); markSessionDirty(); return true;
      } catch (error) {
        if (error.name !== 'AbortError') console.warn('Relink failed.', error);
        file.needsPermission = true;
        emit('permission:changed', { file: file, permission: 'denied' });
        return false;
      }
    }

    function serverTicks(value) {
      const ticks = Number(value);
      return Number.isFinite(ticks) ? Math.floor(ticks / 10000 - 62135596800000) : null;
    }
    async function applyExternal(file, content, lastModified, size) {
      const isActive = getActiveFile() === file;
      const local = isActive ? editor.getContent({ flush: true }) : file.content;
      file.lastModified = lastModified || file.lastModified;
      file.fileSize = size === undefined ? file.fileSize : size;
      emit('file:metadata-changed', { file: file, index: openFiles.indexOf(file) });
      if (content === file.savedContent) return;
      if (local !== file.savedContent && local !== content) {
        file.externalContent = content;
        file.externalLastModified = file.lastModified;
        emit('file:external-conflict', { file: file, active: isActive });
        return;
      }
      await history.createHistorySnapshot(file, '外部更新前', local);
      file.content = file.savedContent = content;
      delete file.externalContent;
      delete file.externalLastModified;
      if (isActive) {
        setState('modified', false);
        editor.replaceDocument(content, { source: 'external' });
        emit('file:activated', { file: file, index: activeFileIndex, modified: false });
      }
      markSessionDirty(); publishList();
    }

    async function pollLocal() {
      if (document.hidden || autoWatchBusy) return;
      const file = getActiveFile();
      if (!file || ((!file.handle || file.needsPermission) && !file.desktopPath)) return;
      autoWatchBusy = true;
      try {
        if (file.desktopPath && desktop.available) {
          const stat = await desktop.statFile(file.desktopPath);
          if (stat.exists && (stat.lastModified !== file.lastModified || stat.size !== file.fileSize)) {
            const data = await desktop.readFile(file.desktopPath);
            await applyExternal(file, data.content, data.lastModified, data.size);
          }
        } else {
          const diskFile = await file.handle.getFile();
          if (diskFile.lastModified !== file.lastModified || diskFile.size !== file.fileSize) {
            await applyExternal(file, await readBlobText(diskFile), diskFile.lastModified, diskFile.size);
          }
        }
      } catch (error) {
        if (!file.desktopPath && (error.name === 'NotAllowedError' || error.name === 'SecurityError')) {
          file.needsPermission = true;
          emit('permission:changed', { file: file, permission: 'prompt' });
        }
      } finally { autoWatchBusy = false; }
    }

    async function pollServer() {
      if (document.hidden || serverWatchBusy) return;
      const file = getActiveFile();
      if (!file || !file.serverPath) return;
      serverWatchBusy = true;
      try {
        const response = await fetch('/api/mtime?file=' + encodeURIComponent(file.serverPath));
        if (!response.ok || getActiveFile() !== file) return;
        const next = await response.text();
        file.lastModified = serverTicks(next);
        if (serverMtime && next !== serverMtime) {
          const contentResponse = await fetch('/api/read?file=' + encodeURIComponent(file.serverPath));
          if (contentResponse.ok && getActiveFile() === file) await applyExternal(file, await contentResponse.text(), file.lastModified);
        }
        serverMtime = next;
      } finally { serverWatchBusy = false; }
    }

    function configureServerWatch() {
      if (serverWatchTimer) { clearInterval(serverWatchTimer); serverWatchTimer = null; }
      serverMtime = null;
      if (context.env.isServerMode && getActiveFile() && getActiveFile().serverPath) {
        serverWatchTimer = setInterval(pollServer, 800); pollServer();
      }
    }

    function openFileBrowser() {
      const modal = document.getElementById('fileBrowser');
      if (modal) modal.classList.add('active');
      return fbNavigate(browserPath || '');
    }
    function closeFileBrowser() {
      const modal = document.getElementById('fileBrowser'); if (modal) modal.classList.remove('active');
    }
    function renderBrowser(data) {
      const list = document.getElementById('fbList');
      const input = document.getElementById('fbPathInput');
      if (input) input.value = data.path === 'DRIVES' ? '（所有磁盘）' : data.path;
      if (!list) return;
      list.innerHTML = '';
      (data.dirs || []).concat(data.files || []).forEach(function(entry) {
        const item = document.createElement('div');
        const directory = (data.dirs || []).includes(entry);
        item.className = 'fb-item ' + (directory ? 'fb-dir' : 'fb-file');
        item.innerHTML = '<span class="fb-icon">' + (directory ? '📁' : '📄') + '</span><span></span>';
        item.lastElementChild.textContent = entry.name;
        item.onclick = function() { directory ? fbNavigate(entry.path) : openServerFile(entry.path).then(closeFileBrowser); };
        list.appendChild(item);
      });
      if (!list.children.length) list.innerHTML = '<div class="fb-empty">此文件夹没有可用文件</div>';
    }

    async function fbNavigate(path) {
      try {
        const response = await fetch('/api/list?dir=' + encodeURIComponent(path || ''));
        if (!response.ok) throw new Error('无法读取目录');
        const data = await response.json(); browserPath = data.path; renderBrowser(data); return data;
      } catch (error) {
        const list = document.getElementById('fbList'); if (list) list.innerHTML = '<div class="fb-empty">服务器连接失败</div>';
      }
    }
    async function fbGoUp() {
      const response = await fetch('/api/list?dir=' + encodeURIComponent(browserPath || ''));
      const data = await response.json(); if (data.parent !== null && data.parent !== undefined) return fbNavigate(data.parent);
    }
    async function openDesktopFile(path) {
      if (!desktop.available || !path) return null;
      const data = await desktop.readFile(path);
      let index = openFiles.findIndex(function(file) {
        return file.desktopPath && file.desktopPath.toLowerCase() === data.path.toLowerCase();
      });
      if (index < 0) {
        openFiles.push({ name: data.name, content: data.content, savedContent: data.content,
          handle: null, serverPath: null, desktopPath: data.path, historyKey: null,
          lastModified: data.lastModified, fileSize: data.size, needsPermission: false });
        index = openFiles.length - 1;
        emit('file:opened', { file: openFiles[index], index: index });
      } else if (openFiles[index].content === openFiles[index].savedContent) {
        openFiles[index].content = openFiles[index].savedContent = data.content;
        openFiles[index].lastModified = data.lastModified; openFiles[index].fileSize = data.size;
      }
      await switchFile(index); markSessionDirty(); publishList();
      return openFiles[index];
    }
    async function openDesktopFiles(paths) {
      let result = null;
      for (const path of Array.from(paths || [])) result = await openDesktopFile(path);
      return result;
    }
    async function openServerFile(path) {
      const response = await fetch('/api/read?file=' + encodeURIComponent(path));
      if (!response.ok) throw new Error('无法读取文件: ' + path);
      const content = await response.text();
      let index = openFiles.findIndex(function(file) { return file.serverPath === path; });
      if (index < 0) {
        openFiles.push({ name: path.split(/[\\/]/).pop(), content: content, savedContent: content,
          handle: null, serverPath: path, desktopPath: null, lastModified: null, needsPermission: false });
        index = openFiles.length - 1;
        emit('file:opened', { file: openFiles[index], index: index });
      } else openFiles[index].content = openFiles[index].savedContent = content;
      await switchFile(index); markSessionDirty(); return openFiles[index];
    }

    function openHandleDB() {
      if (handleDbPromise) return handleDbPromise;
      handleDbPromise = new Promise(function(resolve, reject) {
        const request = indexedDB.open('md-viewer-handles', 1);
        request.onupgradeneeded = function(event) {
          const db = event.target.result;
          if (!db.objectStoreNames.contains('handles')) db.createObjectStore('handles', { keyPath: 'name' });
        };
        request.onsuccess = function(event) { resolve(event.target.result); };
        request.onerror = function() { reject(request.error); };
      });
      return handleDbPromise;
    }
    async function saveHandlesToDB() {
      try {
        const db = await openHandleDB(); const tx = db.transaction('handles', 'readwrite');
        const store = tx.objectStore('handles'); store.clear();
        openFiles.forEach(function(file) { if (file.handle) store.put({ name: file.name, handle: file.handle }); });
      } catch (error) { console.warn('Unable to persist file handles.', error); }
    }
    async function restoreHandlesFromDB() {
      try {
        const db = await openHandleDB(); const store = db.transaction('handles', 'readonly').objectStore('handles');
        const records = await new Promise(function(resolve, reject) {
          const request = store.getAll(); request.onsuccess = function() { resolve(request.result || []); };
          request.onerror = function() { reject(request.error); };
        });
        records.forEach(function(record) {
          const file = openFiles.find(function(item) { return item.name === record.name; });
          if (file) file.handle = record.handle;
        });
        await silentRefreshAll();
      } catch (error) { console.warn('Unable to restore file handles.', error); }
    }

    async function silentRefreshAll() {
      for (const file of openFiles) {
        if (!file.handle) continue;
        try {
          const permission = typeof file.handle.queryPermission === 'function'
            ? await file.handle.queryPermission({ mode: 'read' }) : 'granted';
          file.needsPermission = permission !== 'granted';
          emit('permission:changed', { file: file, permission: permission });
          if (permission !== 'granted') continue;
          const diskFile = await file.handle.getFile();
          const changed = file.lastModified !== diskFile.lastModified ||
            (file.fileSize !== undefined && file.fileSize !== diskFile.size);
          if (changed) await applyExternal(file, await readBlobText(diskFile), diskFile.lastModified, diskFile.size);
          else { file.lastModified = diskFile.lastModified; file.fileSize = diskFile.size; }
        } catch (error) {
          file.needsPermission = true;
          emit('permission:changed', { file: file, permission: 'prompt' });
        }
      }
      publishList();
      const active = getActiveFile();
      if (active) emit('file:metadata-changed', { file: active, index: activeFileIndex });
    }

    function saveSession(force) {
      if (!context.state.get('sessionDirty') || (!force && Date.now() < sessionRetryAt)) return;
      if (!force && editor && typeof editor.canPersistSession === 'function' && !editor.canPersistSession()) return;
      const active = getActiveFile();
      if (active && editor) active.content = editor.getContent({ flush: true });
      try {
        localStorage.setItem('md-viewer-session', JSON.stringify({
          activeIndex: activeFileIndex,
          files: openFiles.map(function(file) {
            return { name: file.name, content: file.content,
              savedContent: file.savedContent === file.content ? null : file.savedContent,
              serverPath: file.serverPath || null, desktopPath: file.desktopPath || null,
              historyKey: file.historyKey || null,
              lastModified: file.lastModified || null, fileSize: file.fileSize === undefined ? null : file.fileSize };
          })
        }));
        setState('sessionDirty', false);
        sessionRetryAt = 0;
        sessionWarningShown = false;
      } catch (error) {
        sessionRetryAt = Date.now() + 60000;
        if (!sessionWarningShown) {
          sessionWarningShown = true;
          console.warn('Session cache is full or unavailable; retrying in 60 seconds.', error);
        }
      }
    }
    async function restoreSession() {
      try {
        const raw = localStorage.getItem('md-viewer-session'); if (!raw) return;
        const data = JSON.parse(raw);
        openFiles = (data.files || []).map(function(file) {
          return { name: file.name, content: String(file.content || ''),
            savedContent: file.savedContent === null || file.savedContent === undefined ? String(file.content || '') : String(file.savedContent),
            handle: null, serverPath: file.serverPath || null, desktopPath: file.desktopPath || null,
            historyKey: file.historyKey || null,
            lastModified: file.lastModified || null, fileSize: file.fileSize === null ? undefined : file.fileSize,
            needsPermission: !file.serverPath && !file.desktopPath };
        });
        if (!openFiles.length) return;
        activeFileIndex = Math.max(0, Math.min(Number(data.activeIndex) || 0, openFiles.length - 1));
        const file = getActiveFile();
        const nextModified = file.content !== file.savedContent;
        setState('activeFileIndex', activeFileIndex); setState('modified', nextModified);
        editor.replaceDocument(file.content, { source: 'session' });
        history.ensureHistoryKey(file); history.createHistorySnapshot(file, '会话恢复', file.savedContent);
        emit('file:activated', { file: file, index: activeFileIndex, modified: nextModified });
        publishList(); await restoreHandlesFromDB(); configureServerWatch();
      } catch (error) { console.warn('Unable to restore session.', error); }
    }

    function bind() {
      context.elements.fileInput.addEventListener('change', function(event) {
        addFiles(event.target.files); event.target.value = '';
      });
      document.addEventListener('visibilitychange', function() { if (!document.hidden) { pollLocal(); pollServer(); } });
      global.addEventListener('focus', function() { pollLocal(); pollServer(); });
      global.addEventListener('beforeunload', function() { saveSession(true); });
    }
    async function start() {
      if (started) return api;
      editor = context.getPort('editor'); history = context.getPort('history');
      if (!editor || !history) throw new Error('Files dependencies are incomplete');
      started = true; bind();
      autoWatchTimer = setInterval(pollLocal, 1000);
      sessionTimer = setInterval(saveSession, 5000);
      await restoreSession();
      return api;
    }

    function hasUnsavedChanges() {
      const active = getActiveFile();
      if (active && editor) active.content = editor.getContent({ flush: true });
      return openFiles.some(function(file) { return file.content !== file.savedContent; });
    }

    const api = Object.freeze({
      start: start, openFile: openFile, addFile: addFile, addFiles: addFiles,
      openDesktopFile: openDesktopFile, openDesktopFiles: openDesktopFiles,
      reloadFile: reloadFile, saveFile: saveFile, switchFile: switchFile, closeFile: closeFile,
      listFiles: listFiles, getActiveFile: getActiveFile, getActiveIndex: getActiveIndex,
      hasUnsavedChanges: hasUnsavedChanges,
      updateActiveContent: updateActiveContent, getCurrentContent: getCurrentContent,
      replaceActiveContent: replaceActiveContent, setModified: setModified,
      relinkCurrentFile: relinkCurrentFile, markSessionDirty: markSessionDirty,
      openFileBrowser: openFileBrowser, closeFileBrowser: closeFileBrowser,
      fbNavigate: fbNavigate, fbGoUp: fbGoUp, openServerFile: openServerFile
    });
    return api;
  }

  namespace.Files = Object.freeze({ create: create });
})(window);