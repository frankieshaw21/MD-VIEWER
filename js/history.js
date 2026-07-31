(function(global) {
  'use strict';

  const namespace = global.MDViewer || (global.MDViewer = {});

  function create(options) {
    options = options || {};
    const win = options.window || global;
    const document = options.document || win.document;
    const elements = options.elements || {};
    const context = options.context;
    if (!context || typeof context.getPort !== 'function') throw new TypeError('History requires context');
    const parser = context.getPort('parser');
    const getActiveFile = function() { return context.getPort('files').getActiveFile(); };
    const getCurrentContentPort = function(file) { return context.getPort('files').getCurrentContent(file); };
    const replaceActiveContent = function(content) { return context.getPort('files').replaceActiveContent(content); };
    const onHistoryKeyAssigned = function() {
      win.setTimeout(function() {
        const files = context.getPort('files');
        if (files && typeof files.markSessionDirty === 'function') files.markSessionDirty();
      }, 0);
    };
    const confirmAction = options.confirm || win.confirm.bind(win);
    const alertAction = options.alert || win.alert.bind(win);
    const logger = options.console || win.console;
    const indexedDB = options.indexedDB || win.indexedDB;
    const IDBKeyRange = options.IDBKeyRange || win.IDBKeyRange;
    const crypto = options.crypto || win.crypto;
    const setTimer = options.setTimeout || win.setTimeout.bind(win);
    const clearTimer = options.clearTimeout || win.clearTimeout.bind(win);
    const now = options.now || function() { return Date.now(); };
    const random = options.random || Math.random;
    const HISTORY_LIMIT = 30;
    const AUTO_SNAPSHOT_DELAY = 1500;

    if (!document || typeof document.createElement !== 'function') throw new TypeError('History requires a document');
    if (!parser || typeof parser.mdToHtml !== 'function') throw new TypeError('History requires a parser');
    if (typeof getActiveFile !== 'function') throw new TypeError('History requires getActiveFile');
    if (typeof getCurrentContentPort !== 'function') throw new TypeError('History requires getCurrentContent');
    if (typeof replaceActiveContent !== 'function') throw new TypeError('History requires replaceActiveContent');
    ['modal', 'title', 'list', 'previewMeta', 'previewContent'].forEach(function(name) {
      if (!elements[name]) throw new TypeError('History requires elements.' + name);
    });

    let historyDbPromise = null;
    let historySnapshotTimer = null;
    const historyWriteQueues = new Map();

    function emit(eventName, payload) {
      if (context && typeof context.emit === 'function') context.emit(eventName, payload);
    }
    function ensureHistoryKey(file) {
      if (!file) return '';
      if (!file.historyKey) {
        if (file.serverPath) {
          file.historyKey = 'server:' + file.serverPath.replace(/\\/g, '/').toLowerCase();
        } else {
          const id = crypto && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : now() + '-' + random().toString(36).slice(2);
          file.historyKey = 'local:' + id;
        }
        if (typeof onHistoryKeyAssigned === 'function') onHistoryKeyAssigned(file, file.historyKey);
      }
      return file.historyKey;
    }

    function openHistoryDB() {
      if (historyDbPromise) return historyDbPromise;
      historyDbPromise = new Promise(function(resolve, reject) {
        const request = indexedDB.open('md-viewer-history', 1);
        request.onupgradeneeded = function(event) {
          const db = event.target.result;
          if (!db.objectStoreNames.contains('snapshots')) {
            const store = db.createObjectStore('snapshots', { keyPath: 'id', autoIncrement: true });
            store.createIndex('fileKey', 'fileKey', { unique: false });
          }
        };
        request.onsuccess = function(event) { resolve(event.target.result); };
        request.onerror = function() { reject(request.error); };
      });
      return historyDbPromise;
    }

    function waitForTransaction(transaction) {
      return new Promise(function(resolve, reject) {
        transaction.oncomplete = resolve;
        transaction.onerror = function() { reject(transaction.error); };
        transaction.onabort = function() { reject(transaction.error || new Error('History transaction aborted')); };
      });
    }

    async function getHistorySnapshots(fileKey) {
      if (!fileKey) return [];
      const db = await openHistoryDB();
      const transaction = db.transaction('snapshots', 'readonly');
      const request = transaction.objectStore('snapshots').index('fileKey').getAll(IDBKeyRange.only(fileKey));
      const entries = await new Promise(function(resolve, reject) {
        request.onsuccess = function() { resolve(request.result || []); };
        request.onerror = function() { reject(request.error); };
      });
      return entries.sort(function(a, b) { return b.createdAt - a.createdAt; });
    }

    async function getHistorySnapshot(id) {
      const db = await openHistoryDB();
      const transaction = db.transaction('snapshots', 'readonly');
      const request = transaction.objectStore('snapshots').get(Number(id));
      return new Promise(function(resolve, reject) {
        request.onsuccess = function() { resolve(request.result || null); };
        request.onerror = function() { reject(request.error); };
      });
    }

    function createHistorySnapshot(file, reason, contentOverride) {
      if (!file) return Promise.resolve();
      const fileKey = ensureHistoryKey(file);
      const content = String(contentOverride !== undefined ? contentOverride : file.content || '');
      const previous = historyWriteQueues.get(fileKey) || Promise.resolve();
      const job = previous.catch(function() {}).then(async function() {
        const existing = await getHistorySnapshots(fileKey);
        if (existing[0] && existing[0].content === content) return;
        const db = await openHistoryDB();
        const transaction = db.transaction('snapshots', 'readwrite');
        const store = transaction.objectStore('snapshots');
        const createdAt = now();
        store.add({ fileKey: fileKey, fileName: file.name, createdAt: createdAt, reason: reason, content: content });
        existing.slice(HISTORY_LIMIT - 1).forEach(function(entry) { store.delete(entry.id); });
        await waitForTransaction(transaction);
        emit('history:snapshot-created', {
          fileKey: fileKey,
          fileName: file.name,
          reason: reason,
          createdAt: createdAt
        });
      });
      historyWriteQueues.set(fileKey, job);
      return job.catch(function(error) {
        if (logger && typeof logger.warn === 'function') logger.warn('Unable to save history snapshot.', error);
      });
    }

    function getCurrentEditorContent(file) {
      if (!file) return '';
      return String(getCurrentContentPort(file) || '');
    }

    function scheduleHistorySnapshot() {
      const file = getActiveFile();
      if (!file) return;
      if (historySnapshotTimer) clearTimer(historySnapshotTimer);
      historySnapshotTimer = setTimer(function() {
        historySnapshotTimer = null;
        createHistorySnapshot(file, '自动编辑快照', getCurrentEditorContent(file));
      }, AUTO_SNAPSHOT_DELAY);
    }
    async function showHistory() {
      const file = getActiveFile();
      if (!file) {
        alertAction('请先打开 Markdown 文件');
        return;
      }
      await createHistorySnapshot(file, '当前编辑状态', getCurrentEditorContent(file));
      elements.title.textContent = '历史记录 · ' + file.name;
      elements.modal.classList.add('active');
      elements.list.innerHTML = '<div class="fb-empty">正在加载...</div>';
      try {
        renderHistoryList(await getHistorySnapshots(ensureHistoryKey(file)));
      } catch (error) {
        elements.list.innerHTML = '<div class="fb-empty">历史记录加载失败</div>';
      }
    }

    function renderHistoryList(entries) {
      elements.list.innerHTML = '';
      if (!entries.length) {
        elements.list.innerHTML = '<div class="fb-empty">暂无历史记录</div>';
        elements.previewMeta.textContent = '选择左侧版本进行预览';
        elements.previewContent.innerHTML = '<div class="fb-empty">暂无预览</div>';
        return;
      }
      entries.forEach(function(entry) {
        const item = document.createElement('div');
        item.className = 'history-item';
        item.dataset.snapshotId = entry.id;
        const meta = document.createElement('div');
        meta.className = 'history-meta';
        meta.textContent = new Date(entry.createdAt).toLocaleString();
        const reason = document.createElement('span');
        reason.className = 'history-reason';
        reason.textContent = entry.reason || '历史快照';
        meta.appendChild(reason);
        const excerpt = document.createElement('div');
        excerpt.className = 'history-excerpt';
        excerpt.textContent = entry.content.replace(/\s+/g, ' ').slice(0, 140) || '（空文档）';
        const actions = document.createElement('div');
        actions.className = 'history-actions';
        const previewButton = document.createElement('button');
        previewButton.className = 'history-preview-button';
        previewButton.textContent = '预览';
        previewButton.onclick = function(event) {
          event.stopPropagation();
          renderHistoryPreview(entry);
        };
        const restore = document.createElement('button');
        restore.className = 'history-restore';
        restore.textContent = '回退';
        restore.onclick = function(event) {
          event.stopPropagation();
          restoreHistorySnapshot(entry.id);
        };
        actions.append(previewButton, restore);
        item.append(meta, excerpt, actions);
        item.onclick = function() { renderHistoryPreview(entry); };
        elements.list.appendChild(item);
      });
      renderHistoryPreview(entries[0]);
    }

    function renderHistoryPreview(entry) {
      elements.list.querySelectorAll('.history-item').forEach(function(item) {
        item.classList.toggle('active', Number(item.dataset.snapshotId) === Number(entry.id));
      });
      elements.previewMeta.textContent =
        new Date(entry.createdAt).toLocaleString() + ' · ' + (entry.reason || '历史快照') +
        ' · ' + entry.content.length + ' 字符';

      const template = document.createElement('template');
      template.innerHTML = parser.mdToHtml(entry.content);
      template.content.querySelectorAll('script, iframe, object, embed, form, meta, link, style').forEach(function(element) {
        element.remove();
      });
      template.content.querySelectorAll('*').forEach(function(element) {
        Array.from(element.attributes).forEach(function(attribute) {
          if (attribute.name.toLowerCase().startsWith('on')) element.removeAttribute(attribute.name);
        });
        ['href', 'src'].forEach(function(name) {
          const value = element.getAttribute(name) || '';
          if (/^\s*javascript:/i.test(value)) element.removeAttribute(name);
        });
        if (element.tagName === 'A') {
          element.setAttribute('target', '_blank');
          element.setAttribute('rel', 'noopener noreferrer');
        }
      });
      elements.previewContent.replaceChildren(template.content.cloneNode(true));
      elements.previewContent.scrollTop = 0;
    }

    function closeHistory() {
      elements.modal.classList.remove('active');
    }
    async function restoreHistorySnapshot(id) {
      const entry = await getHistorySnapshot(id);
      const current = getActiveFile();
      if (!entry || !current || entry.fileKey !== ensureHistoryKey(current)) return;
      if (!confirmAction('回退到该历史版本？回退结果不会立即写入磁盘。')) return;
      await createHistorySnapshot(current, '回退前', getCurrentEditorContent(current));
      await replaceActiveContent(entry.content, {
        source: 'history',
        snapshotId: entry.id,
        fileKey: entry.fileKey,
        reason: entry.reason || '历史快照'
      });
      closeHistory();
      emit('history:restored', {
        fileKey: entry.fileKey,
        fileName: current.name,
        snapshotId: entry.id,
        reason: entry.reason || '历史快照'
      });
    }

    async function clearCurrentHistory() {
      const current = getActiveFile();
      if (!current || !confirmAction('清空当前文件的全部历史记录？')) return;
      const fileKey = ensureHistoryKey(current);
      const entries = await getHistorySnapshots(fileKey);
      const db = await openHistoryDB();
      const transaction = db.transaction('snapshots', 'readwrite');
      const store = transaction.objectStore('snapshots');
      entries.forEach(function(entry) { store.delete(entry.id); });
      await waitForTransaction(transaction);
      renderHistoryList([]);
      emit('history:cleared', {
        fileKey: fileKey,
        fileName: current.name,
        deletedCount: entries.length
      });
    }

    return Object.freeze({
      ensureHistoryKey: ensureHistoryKey,
      openHistoryDB: openHistoryDB,
      waitForTransaction: waitForTransaction,
      getHistorySnapshots: getHistorySnapshots,
      getHistorySnapshot: getHistorySnapshot,
      createHistorySnapshot: createHistorySnapshot,
      getCurrentEditorContent: getCurrentEditorContent,
      scheduleHistorySnapshot: scheduleHistorySnapshot,
      showHistory: showHistory,
      renderHistoryList: renderHistoryList,
      renderHistoryPreview: renderHistoryPreview,
      closeHistory: closeHistory,
      restoreHistorySnapshot: restoreHistorySnapshot,
      clearCurrentHistory: clearCurrentHistory
    });
  }

  namespace.History = Object.freeze({ create: create });
})(window);
