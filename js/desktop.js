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

  let larkBusy = false;
  let larkFile = null;
  function larkStatus(kind, message) {
    const status = document.getElementById('larkSyncStatus');
    status.dataset.kind = kind;
    status.textContent = message;
    status.hidden = !message;
  }
  function openLarkSync() {
    larkFile = context.getPort('files').getActiveFile();
    document.getElementById('larkSyncFile').textContent = larkFile ? larkFile.name : '尚未打开本地文件';
    const key = larkFile && larkFile.desktopPath ? 'mdviewer-lark-url:' + larkFile.desktopPath : null;
    document.getElementById('larkSyncUrl').value = key ? localStorage.getItem(key) || '' : '';
    larkStatus('', '');
    document.getElementById('larkSyncDialog').showModal();
  }
  async function syncLark(direction) {
    if (larkBusy) return;
    const files = context.getPort('files');
    const file = larkFile;
    if (!file || !file.desktopPath) return larkStatus('error', '请先打开本地 Markdown 文件。');
    if (files.getActiveFile() !== file) return larkStatus('error', '当前文档已切换，请关闭窗口后重新打开同步。');
    context.getPort('editor').getContent({ flush: true });
    if (files.hasUnsavedChanges()) return larkStatus('error', '请先保存所有未保存的文档，再同步飞书。');
    const url = document.getElementById('larkSyncUrl').value.trim();
    if (!url) return larkStatus('error', '请填写飞书文档链接。');
    larkStatus('', '');
    if (!global.confirm(direction === 'push' ? '确认以已保存的本地内容更新飞书？首次上传将覆盖远端。' : '确认下载飞书内容覆盖本地文件？原内容将备份。')) return;
    larkBusy = true;
    const controls = ['larkSyncPush', 'larkSyncPull', 'larkSyncClose', 'larkSyncUrl'];
    controls.forEach(function(id) { document.getElementById(id).disabled = true; });
    larkStatus('progress', '正在同步，请稍候…');
    try {
      const result = await request('lark-sync', { path: file.desktopPath, url: url, direction: direction });
      localStorage.setItem('mdviewer-lark-url:' + file.desktopPath, url);
      let reloaded = true;
      if (direction === 'pull' && files.getActiveFile() === file) reloaded = await files.reloadFile();
      larkStatus('success', '飞书同步成功。' + (reloaded === false ? '\n本地文件已更新；编辑器保留你的未保存改动。' : '') + (result.backup ? '\n本地备份：' + result.backup : ''));
    } catch (error) {
      larkStatus('error', '同步失败\n原因：' + error.message);
      if (/lark-cli|授权|登录|权限/.test(error.message)) document.getElementById('larkAuthHelp').open = true;
    } finally {
      larkBusy = false;
      controls.forEach(function(id) { document.getElementById(id).disabled = false; });
    }
  }

  function start(nextContext) {
    if (started) return;
    started = true;
    context = nextContext;
    document.body.classList.add('desktop-mode');
    const button = document.getElementById('desktopDefaultBtn');
    if (button) button.style.display = '';
    const syncButton = document.getElementById('desktopLarkSyncBtn');
    if (syncButton) {
      syncButton.style.display = '';
      syncButton.addEventListener('click', openLarkSync);
      document.getElementById('larkSyncPush').addEventListener('click', function() { syncLark('push'); });
      document.getElementById('larkSyncPull').addEventListener('click', function() { syncLark('pull'); });
      document.getElementById('larkSyncClose').addEventListener('click', function() { if (!larkBusy) document.getElementById('larkSyncDialog').close(); });
      document.getElementById('larkSyncDialog').addEventListener('cancel', function(event) { if (larkBusy) event.preventDefault(); });
    }
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
