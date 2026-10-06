// Run against a dedicated Edge/WebView2 debugging session; uses in-memory documents only.
import assert from 'node:assert/strict';
const endpoint = process.argv[2] || 'http://127.0.0.1:19331';
const targets = await (await fetch(endpoint + '/json/list')).json();
const target = targets.find(t => t.url.includes('md-viewer.html'));
assert.ok(target);
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0;
const pending = new Map();
ws.onmessage = event => { const m = JSON.parse(event.data); if (m.id) { pending.get(m.id)(m); pending.delete(m.id); } };
async function evaluate(expression) {
  const requestId = ++id;
  const response = new Promise(resolve => pending.set(requestId, resolve));
  ws.send(JSON.stringify({ id: requestId, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  const m = await response;
  assert.ok(!m.error && !m.result.exceptionDetails, JSON.stringify(m));
  return m.result.result.value;
}
try {
  const result = await evaluate(`(async () => {
    const app = MDViewer.app, files = app.getPort('files'), editor = app.getPort('editor');
    const parser = app.getPort('parser');
    const original = '# 2. 产品现状\\n\\n\\n## 2.1 Hash 配置现状\\n\\n\\n### 2.1.1 ECMP Hash';
    if (editor.getViewMode() !== 'preview') editor.toggleSource();
    await files.addFile(new File([original], 'blank-lines-' + Date.now() + '.md'));
    const root = document.getElementById('editor');
    const gaps = Array.from(root.querySelectorAll('.md-blank-lines')).map(el => ({ count: el.dataset.mdBlankLines, height: el.getBoundingClientRect().height, line: parseFloat(getComputedStyle(el).lineHeight) }));
    root.querySelector('h2').textContent = 'Edited';
    root.dispatchEvent(new Event('input', { bubbles: true }));
    editor.toggleSource();
    const edited = document.getElementById('sourceEditor').value;
    editor.toggleSource();
    root.querySelector('h2').textContent = 'Edited again';
    root.dispatchEvent(new Event('input', { bubbles: true }));
    editor.toggleSource();
    const editedAgain = document.getElementById('sourceEditor').value;
    editor.toggleSplit();
    const splitGaps = root.querySelectorAll('.md-blank-lines').length;
    const wrapper = document.createElement('div');
    const roundTrips = [1, 2, 4].map(count => {
      const md = '# A' + '\\n'.repeat(count + 1) + '## B';
      wrapper.innerHTML = parser.mdToHtml(md);
      return { md, saved: parser.domToMd(wrapper).trim() };
    });
    wrapper.innerHTML = parser.mdToHtml('\\x60\\x60\\x60\\nA\\n\\nB\\n\\x60\\x60\\x60');
    return { original, gaps, edited, editedAgain, splitGaps, roundTrips,
      codeGaps: wrapper.querySelectorAll('.md-blank-lines').length,
      code: wrapper.querySelector('code').textContent };
  })()`);
  assert.equal(result.gaps.length, 2);
  for (const gap of result.gaps) { assert.equal(gap.count, '2'); assert.ok(Math.abs(gap.height - 2 * gap.line) < 1); }
  assert.equal(result.edited, result.original.replace('2.1 Hash 配置现状', 'Edited'));
  assert.equal(result.editedAgain, result.original.replace('2.1 Hash 配置现状', 'Edited again'));
  assert.equal(result.splitGaps, 2);
  for (const r of result.roundTrips) assert.equal(r.saved, r.md);
  assert.equal(result.codeGaps, 0);
  assert.match(result.code, /A\n\nB/);
  console.log('PASS: heading gaps have exact line heights; preview edits, repeated round trips, split mode and fenced code.');
} finally { ws.close(); }
