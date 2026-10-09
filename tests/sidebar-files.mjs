// Uses a dedicated debug browser session and in-memory Markdown only.
import assert from 'node:assert/strict';
const endpoint = process.argv[2] || 'http://127.0.0.1:19332';
const targets = await (await fetch(endpoint + '/json/list')).json();
const target = targets.find(t => t.url.includes('md-viewer.html'));
assert.ok(target, 'Application page not found');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
const response = new Promise(resolve => { ws.onmessage = event => {
  const message = JSON.parse(event.data); if (message.id === 1) resolve(message);
}; });
ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: {
  awaitPromise: true, returnByValue: true,
  expression: `(async function() {
    const files = MDViewer.app.getPort('files');
    const button = document.getElementById('sidebarOpenFile');
    const actions = document.getElementById('sidebarFileActions');
    const original = window.openFile;
    let invoked = false, task;
    try {
      switchTab('files');
      if (actions.hidden || button.getBoundingClientRect().width <= 0) throw Error('File selection not visible');
      if (document.getElementById('tabBrowse')) throw Error('Unexpected browse tab');
      window.openFile = function() {
        invoked = true;
        task = files.addFile(new File(['# Sidebar selection\\n\\nRead me'], 'sidebar-test.md'));
      };
      button.click(); await task;
      if (!invoked || !document.getElementById('editor').textContent.includes('Sidebar selection')) throw Error('Selection did not open');
      if (!document.getElementById('fileList').textContent.includes('sidebar-test.md')) throw Error('File list missing selection');
      switchTab('outline');
      if (!actions.hidden) throw Error('Selection shown on outline tab');
      switchTab('files');
      if (actions.hidden) throw Error('Selection not restored');
      for (const theme of ['dark', 'eye-care']) {
        document.body.classList.add(theme);
        if (getComputedStyle(button).color !== getComputedStyle(actions).color) throw Error('Theme color');
        document.body.classList.remove(theme);
      }
      return { sidebarSelection: true, opensMarkdown: true, fileList: true, tabs: true, themes: true, picker: 'mocked' };
    } finally { window.openFile = original; }
  })()`
} }));
try {
  const message = await response;
  assert.ok(!message.error && !message.result.exceptionDetails, JSON.stringify(message));
  console.log(message.result.result.value);
} finally { ws.close(); }
