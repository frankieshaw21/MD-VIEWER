(function(global) {
  'use strict';
  const namespace = global.MDViewer || (global.MDViewer = {});
  const webview = global.chrome && global.chrome.webview;
  if (!webview) {
    namespace.Desktop = Object.freeze({ available: false });
    return;
  }

  let sequence = 0;
  let started = false;
  let context = null;
  const pending = new Map();
  const queuedPaths = [];

  function post(message) { webview.postMessage(message); }
  function request(action, payload) {
    return new Promise(function(resolve, reject) {
      const id = 'desktop-' + (++sequence);
      pending.set(id, { resolve: resolve, reject: reject });
      post(Object.assign({ kind: 'request', id: id, action: action }, payload || {}));
    });
  }
  function updateTitle() {
    if (!context) return;
    const files = context.getPort('files');
    const file = files && files.getActiveFile();
    const dirty = files && files.hasUnsavedChanges();
    post({ kind: 'title', value: (dirty ? '● ' : '') + (file ? file.name : 'MD Viewer') });
  }
  async function openPaths(paths) {
    if (!paths || !paths.length) return;
    if (!context || !context.state.get('ready')) {
      queuedPaths.push.apply(queuedPaths, paths);
      return;
    }
    await context.getPort('files').openDesktopFiles(paths);
  }

  webview.addEventListener('message', function(event) {
    const message = event.data || {};
    if (message.kind === 'response') {
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      message.ok ? waiter.resolve(message.data) : waiter.reject(new Error(message.error || '桌面操作失败'));
    } else if (message.kind === 'open-files') {
      openPaths(message.paths || []).catch(function(error) { alert(error.message); });
    } else if (message.kind === 'update-download-progress' && updateButton) {
      updateButton.textContent = '下载更新 ' + message.percent + '%';
    }
  });

  let checkingUpdates = false;
  let updateButton = null;
  let downloadedUpdate = null;
  let updateStatusTimer = null;
  async function installDownloadedUpdate(button) {
    button.disabled = true;
    button.textContent = '准备安装…';
    try {
      await request('install-update');
    } catch (error) {
      button.disabled = false;
      button.textContent = '安装 ' + downloadedUpdate;
      global.alert('无法安装更新：' + (error && error.message ? error.message : String(error)));
    }
  }
  async function checkUpdates(button) {
    if (downloadedUpdate) return installDownloadedUpdate(button);
    if (checkingUpdates) return;
    checkingUpdates = true;
    if (updateStatusTimer) global.clearTimeout(updateStatusTimer);
    button.disabled = true;
    button.textContent = '正在检查…';
    try {
      const update = await request('check-updates');
      if (update && update.version && update.url) {
        button.textContent = '发现 ' + update.version;
        if (global.confirm('发现新版本 ' + update.version + '。是否在后台下载更新包？下载期间可继续编辑文档。')) {
          button.textContent = '下载更新 0%';
          await request('download-update', { version: update.version });
          downloadedUpdate = update.version;
          button.textContent = '安装 ' + update.version;
        }
      } else {
        button.textContent = '已是最新版本';
      }
    } catch (error) {
      button.textContent = '检查失败';
      global.alert('检查软件更新失败：' + (error && error.message ? error.message : String(error)));
    } finally {
      checkingUpdates = false;
      button.disabled = false;
      if (!downloadedUpdate) updateStatusTimer = global.setTimeout(function() {
        button.textContent = '检查软件更新';
        updateStatusTimer = null;
      }, 4000);
    }
  }

  function start(nextContext) {
    if (started) return;
    started = true;
    context = nextContext;
    document.body.classList.add('desktop-mode');
    const button = document.getElementById('desktopDefaultBtn');
    if (button) button.style.display = '';
    updateButton = document.getElementById('desktopCheckUpdatesBtn');
    if (updateButton) {
      updateButton.style.display = '';
      updateButton.addEventListener('click', function() { checkUpdates(updateButton); });
    }
    context.on('file:activated', updateTitle);
    context.on('file:modified', updateTitle);
    context.on('document:saved', updateTitle);
    if (queuedPaths.length) openPaths(queuedPaths.splice(0)).catch(console.error);
    updateTitle();
    post({ kind: 'ready' });
  }

  namespace.Desktop = Object.freeze({
    available: true,
    start: start,
    openFilesDialog: function() { return request('open-dialog'); },
    readFile: function(path) { return request('read-file', { path: path }); },
    writeFile: function(path, content) { return request('write-file', { path: path, content: content }); },
    statFile: function(path) { return request('stat-file', { path: path }); },
    openExternal: function(url) { return request('open-external', { url: url }); },
    resolveLink: function(href, basePath) { return request('resolve-link', { href: href, basePath: basePath }); },
    chooseDefaultApp: function() { return request('choose-default'); }
  });
  global.chooseDefaultApp = function() {
    return namespace.Desktop.chooseDefaultApp().catch(function(error) { alert(error.message); });
  };
})(window);
