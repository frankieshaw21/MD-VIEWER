// Node 22+; start Edge/WebView2 with a dedicated profile and remote debugging.
// Usage: node tests/performance-regression.mjs http://127.0.0.1:19331
// Uses temporary in-memory files; desktop save tests belong to a separate harness.
import assert from 'node:assert/strict';
const endpoint = process.argv[2] || 'http://127.0.0.1:19331';
const targets = await (await fetch(endpoint + '/json/list')).json();
const target = targets.find(t => t.url.includes('md-viewer.html'));
assert.ok(target, 'Application page not found');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0;
const pending = new Map();
ws.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id); }
};
async function evaluate(expression) {
  const requestId = ++id;
  const response = new Promise(resolve => pending.set(requestId, resolve));
  ws.send(JSON.stringify({ id: requestId, method: 'Runtime.evaluate', params: {
    expression, awaitPromise: true, returnByValue: true
  } }));
  const message = await response;
  assert.ok(!message.error && !message.result.exceptionDetails, JSON.stringify(message));
  return message.result.result.value;
}
try {
  assert.equal(await evaluate('MDViewer.app.state.get("ready")'), true);
  const functional = await evaluate(`(async function() {
    const app = MDViewer.app, files = app.getPort('files'), editor = app.getPort('editor');
    const source = document.getElementById('sourceEditor'), root = document.getElementById('editor');
    const wait = () => new Promise(resolve => setTimeout(resolve, 450));
    const preview = () => { if (editor.getViewMode() !== 'preview') editor.toggleSource(); };
    const toSource = () => { if (editor.getViewMode() !== 'source') editor.toggleSource(); };
    const results = {};
    preview();
    await files.addFile(new File(['# First\\n\\nBody'], 'regression-first.md'));
    const original = root.firstElementChild;
    toSource(); preview();
    results.unchangedPreviewReused = root.firstElementChild === original;
    toSource();
    source.value += '\\n\\n## Added';
    source.dispatchEvent(new Event('input', { bubbles: true }));
    results.contentImmediate = editor.getContent().endsWith('## Added') && app.state.get('modified');
    results.nativeWhilePending = source.closest('.source-editor-shell').classList.contains('source-editor-pending') &&
      getComputedStyle(source).color !== 'rgba(0, 0, 0, 0)';
    await wait();
    results.outlineSettled = editor.getOutline().some(h => h.text === 'Added') &&
      document.getElementById('outlineList').textContent.includes('Added');
    results.highlightSettled = !source.closest('.source-editor-shell').classList.contains('source-editor-pending');
    preview();
    results.editedPreviewRebuilt = root.firstElementChild !== original && root.textContent.includes('Added');
    root.querySelector('h1').textContent = 'Preview edit';
    root.dispatchEvent(new Event('input', { bubbles: true }));
    toSource();
    results.previewEditFlushed = editor.getContent().includes('Preview edit');
    preview();
    results.previewEditSurvives = root.querySelector('h1').textContent === 'Preview edit';
    toSource();
    source.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    source.value += '\\n组合输入';
    source.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
    await wait();
    results.composingNative = source.closest('.source-editor-shell').classList.contains('source-editor-pending');
    source.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    await wait();
    results.compositionCommitted = editor.getContent().includes('组合输入') &&
      !source.closest('.source-editor-shell').classList.contains('source-editor-pending');
    editor.toggleSplit();
    source.value += '\\n\\n## Split change';
    source.dispatchEvent(new Event('input', { bubbles: true }));
    await wait();
    results.splitUpdated = root.textContent.includes('Split change');
    preview();
    await files.addFile(new File(['# Second'], 'regression-second.md'));
    toSource(); preview();
    results.fileIdentity = root.textContent.includes('Second') && !root.textContent.includes('First');
    toSource(); editor.replaceDocument('# Replacement', { source: 'regression' }); preview();
    results.replacementInvalidates = root.textContent.includes('Replacement') && !root.textContent.includes('Second');
    await files.addFile(new File(['# First\\n\\n<details>\\n<summary>Hidden</summary>\\n\\n## Hidden heading\\n\\n</details>\\n\\n## Visible heading\\n\\n' + 'paragraph\\n\\n'.repeat(80)], 'regression-details.md'));
    await wait();
    root.querySelector(':scope > h2').scrollIntoView({ behavior: 'instant', block: 'start' });
    editor.updateActiveHeading();
    results.foldedHeading = document.querySelector('#outlineList .active-heading')?.textContent === 'Visible heading';
    root.querySelector('details').open = true;
    await wait();
    root.querySelector(':scope > h2').scrollIntoView({ behavior: 'instant', block: 'start' });
    editor.updateActiveHeading();
    results.expandedHeading = document.getElementById('outlineList').children.length === 3 &&
      document.querySelector('#outlineList .active-heading')?.textContent === 'Visible heading';
    editor.scrollToHeading(0); editor.updateActiveHeading();
    results.singleActive = document.querySelectorAll('#outlineList .active-heading').length === 1;
    return results;
  })()`);
  console.log('functional', functional);
  for (const [name, passed] of Object.entries(functional)) assert.equal(passed, true, name);
  for (const repeats of [1000, 5000, 17000]) {
    const result = await evaluate(`(async function() {
      const app = MDViewer.app, files = app.getPort('files'), editor = app.getPort('editor');
      const text = ('# Heading\\n\\n中文段落 **bold** and code.\\n\\n- first\\n- second\\n\\n').repeat(${repeats});
      if (editor.getViewMode() !== 'preview') editor.toggleSource();
      await files.addFile(new File([text], 'regression-perf-${repeats}.md'));
      const first = document.getElementById('editor').firstElementChild;
      let start = performance.now(); editor.toggleSource(); const sourceMs = performance.now() - start;
      start = performance.now(); editor.toggleSource(); const unchangedPreviewMs = performance.now() - start;
      const reused = first === document.getElementById('editor').firstElementChild;
      editor.toggleSource();
      const source = document.getElementById('sourceEditor'); source.value += 'x';
      start = performance.now(); source.dispatchEvent(new Event('input', { bubbles: true }));
      const inputMs = performance.now() - start;
      await new Promise(resolve => setTimeout(resolve, 700));
      start = performance.now(); editor.toggleSource(); const changedPreviewMs = performance.now() - start;
      return { chars: text.length, sourceMs, inputMs, unchangedPreviewMs, changedPreviewMs, reused,
        edited: document.getElementById('editor').textContent.endsWith('x') };
    })()`);
    console.log('performance', result);
    assert.equal(result.reused, true);
    assert.equal(result.edited, true);
  }
} finally { ws.close(); }
