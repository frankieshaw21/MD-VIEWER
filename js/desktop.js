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

  async function syncLark(button) {
    const files = context.getPort('files');
    const file = files.getActiveFile();
    if (!file || !file.desktopPath) return global.alert('请先打开本地 Markdown 文件。');
    context.getPort('editor').getContent({ flush: true });
    if (files.hasUnsavedChanges()) return global.alert('请先保存所有未保存的文档，再同步飞书。');
    const key = 'mdviewer-lark-url:' + file.desktopPath;
    const url = global.prompt('飞书 Wiki / Docx 链接（需先安装 lark-cli 并完成用户授权）', localStorage.getItem(key) || '');
    if (!url) return;
    const direction = global.prompt('输入 push 上传本地到飞书，或 pull 下载飞书到本地。\n首次上传会覆盖远端，下载会覆盖本地并保留备份。Markdown 不保留所有飞书样式和评论。', 'push');
    if (direction !== 'push' && direction !== 'pull') return;
    if (!global.confirm(direction === 'push' ? '确认以已保存的本地内容更新飞书？' : '确认下载飞书内容覆盖本地文件？原内容将备份。')) return;
    button.disabled = true;
    button.textContent = '正在同步…';
    try {
      const result = await request('lark-sync', { path: file.desktopPath, url: url, direction: direction });
      localStorage.setItem(key, url);
      if (direction === 'pull' && files.getActiveFile() === file) await files.reloadFile();
      global.alert('飞书同步成功。' + (result.backup ? '\n本地备份：' + result.backup : ''));
    } catch (error) { global.alert('飞书同步失败：' + error.message); }
    finally { button.disabled = false; button.textContent = '同步飞书文档'; }
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
      syncButton.addEventListener('click', function() { syncLark(syncButton); });
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
