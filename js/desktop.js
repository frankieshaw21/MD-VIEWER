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
    }
  });

  function start(nextContext) {
    if (started) return;
    started = true;
    context = nextContext;
    document.body.classList.add('desktop-mode');
    const button = document.getElementById('desktopDefaultBtn');
    if (button) button.style.display = '';
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
    chooseDefaultApp: function() { return request('choose-default'); }
  });
  global.chooseDefaultApp = function() {
    return namespace.Desktop.chooseDefaultApp().catch(function(error) { alert(error.message); });
  };
})(window);
