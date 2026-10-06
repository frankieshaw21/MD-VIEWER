// Windows + Node 22+: offline browser regression for the desktop-only menu entry.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
const portCheck = createServer();
await new Promise((resolve, reject) => { portCheck.once('error', reject); portCheck.listen(19339, '127.0.0.1', resolve); });
await new Promise(resolve => portCheck.close(resolve));
const profile = await mkdtemp(path.join(tmpdir(), 'mdviewer-lark-browser-'));
const executable = process.env.MDVIEWER_TEST_EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const edge = spawn(executable, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=19339', '--user-data-dir=' + profile, pathToFileURL(path.resolve('md-viewer.html')).href], { stdio: 'ignore' });
let ws;
try {
  let target;
  for (let i = 0; i < 100; i++) {
    const targets = await fetch('http://127.0.0.1:19339/json/list').then(r => r.json()).catch(() => []);
    target = targets.find(t => t.url.includes('md-viewer.html'));
    if (target) break;
    await new Promise(r => setTimeout(r, 100));
  }
  assert.ok(target, 'Offline browser page not found');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = event => { const msg = JSON.parse(event.data); if (msg.id) { pending.get(msg.id)?.(msg); pending.delete(msg.id); } };
  async function evaluate(expression) {
    const requestId = ++id;
    const response = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('Browser CDP timeout')), 30000);
      pending.set(requestId, msg => { clearTimeout(timeout); resolve(msg); });
    });
    ws.send(JSON.stringify({ id: requestId, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
    const msg = await response;
    assert.ok(!msg.error && !msg.result.exceptionDetails, JSON.stringify(msg));
    return msg.result.result.value;
  }
  for (let i = 0; i < 100; i++) {
    if (await evaluate('!!window.MDViewer?.app?.state.get("ready")')) break;
    await new Promise(r => setTimeout(r, 100));
  }
  assert.equal(await evaluate('MDViewer.Desktop.available'), false);
  assert.equal(await evaluate('getComputedStyle(document.getElementById("desktopLarkSyncBtn")).display'), 'none');
  assert.equal(await evaluate(`(async()=>{const app=MDViewer.app,files=app.getPort('files'),editor=app.getPort('editor');await files.addFile(new File(['# Offline\\n\\nbody'],'offline.md'));editor.toggleSource();const source=document.getElementById('sourceEditor');source.value+='\\n\\n## Edited';source.dispatchEvent(new Event('input',{bubbles:true}));editor.toggleSource();return editor.getContent({flush:true}).includes('## Edited') && document.getElementById('editor').textContent.includes('Edited');})()`), true);
  console.log('PASS: offline Edge page, sync menu hidden, source/preview edit round trip');
} finally {
  ws?.close();
  if (edge.exitCode === null) execFileSync('taskkill.exe', ['/PID', String(edge.pid), '/T', '/F'], { stdio: 'ignore' });
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}
