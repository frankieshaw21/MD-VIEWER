// Windows + Node 22+. Build desktop/publish first. No real Feishu calls.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';

const portCheck = createServer();
await new Promise((resolve, reject) => { portCheck.once('error', reject); portCheck.listen(19338, '127.0.0.1', resolve); });
await new Promise(resolve => portCheck.close(resolve));

const running = execFileSync('powershell.exe', ['-NoProfile', '-Command', '(Get-Process MDViewer -ErrorAction SilentlyContinue | Measure-Object).Count'], { encoding: 'utf8' }).trim();
assert.equal(running, '0', 'Close MD Viewer before isolated desktop tests');
const temp = await realpath(await mkdtemp(path.join(tmpdir(), 'mdviewer-lark-ui-')));
const local = path.join(temp, '中文 文档.md');
const other = path.join(temp, 'other.md');
const remote = path.join(temp, 'remote.json');
const mock = path.join(temp, 'mock.ps1');
const trusted = path.join(process.env.LOCALAPPDATA, 'MDViewer', 'trusted-files.json');
const previousTrusted = await readFile(trusted).catch(() => null);
const baselineFolder = path.join(process.env.APPDATA, 'MDViewer', 'lark-sync');
const baseline = path.join(baselineFolder, createHash('sha256').update(local.toUpperCase() + '\nhttps://test.feishu.cn/docx/test').digest('hex').toUpperCase() + '.json');
const endpoint = 'http://127.0.0.1:19338';
let app, ws;
async function remoteContent(revision, content, mode = 'ok') {
  await writeFile(remote, JSON.stringify({ revision_id: revision, content, mode }), 'utf8');
}
try {
  await writeFile(local, '# 本地初始\n\n正文');
  await writeFile(other, '# Second');
  await remoteContent(1, '# 飞书初始');
  await writeFile(mock, `param([Parameter(ValueFromRemainingArguments=$true)][string[]]$a)
$r = Get-Content -LiteralPath $env:MDVIEWER_MOCK_REMOTE -Raw -Encoding UTF8 | ConvertFrom-Json
if ($r.mode -eq 'failure') { [Console]::Error.WriteLine('mock permission denied'); exit 3 }
if ($r.mode -eq 'malformed') { Write-Output 'not json'; exit 0 }
if ($r.mode -eq 'missing') { [Console]::Error.WriteLine('[MDVIEWER_CLI_NOT_FOUND] #< CLIXML <Objs>secret</Objs>'); exit 127 }
if ($r.mode -eq 'expired') { [Console]::Error.WriteLine('user token expired'); exit 2 }
if ($r.mode -eq 'delay') { Start-Sleep -Seconds 2 }
if ($a[1] -eq '+update') {
  $rev = $a[[Array]::IndexOf($a, '--revision-id') + 1]
  if ([long]$rev -ne $r.revision_id) { exit 4 }
  $p = $a[[Array]::IndexOf($a, '--content') + 1].Substring(1)
  $r.content = [IO.File]::ReadAllText($p)
  $r.revision_id++
  [IO.File]::WriteAllText($env:MDVIEWER_MOCK_REMOTE, ($r | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
}
@{ok=$true;data=@{document=$r;result='success'}} | ConvertTo-Json -Depth 5 -Compress
`, 'utf8');
  app = spawn(path.resolve('desktop/publish/MDViewer.exe'), [local, other], {
    env: { ...process.env, LARK_MD_SYNC_CLI: mock, MDVIEWER_MOCK_REMOTE: remote,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=19338',
      WEBVIEW2_USER_DATA_FOLDER: path.join(temp, 'webview') }, stdio: 'ignore'
  });
  let target;
  for (let i = 0; i < 100; i++) {
    const targets = await fetch(endpoint + '/json/list').then(r => r.json()).catch(() => []);
    target = targets.find(t => t.url.includes('md-viewer.html'));
    if (target) break;
    await new Promise(r => setTimeout(r, 200));
  }
  assert.ok(target, 'Latest desktop WebView2 page not found');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = event => { const msg = JSON.parse(event.data); if (msg.id) { pending.get(msg.id)?.(msg); pending.delete(msg.id); } };
  async function evaluate(expression) {
    const requestId = ++id;
    const response = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { pending.delete(requestId); reject(new Error('CDP evaluate timeout')); }, 30000);
      pending.set(requestId, msg => { clearTimeout(timeout); resolve(msg); });
    });
    ws.send(JSON.stringify({ id: requestId, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
    const msg = await response;
    assert.ok(!msg.error && !msg.result.exceptionDetails, JSON.stringify(msg));
    return msg.result.result.value;
  }
  for (let i = 0; i < 60; i++) {
    if (await evaluate('!!(window.MDViewer?.app?.state.get("ready"))')) break;
    await new Promise(r => setTimeout(r, 200));
  }
  // Replace only blocking JS dialogs; click the actual UI handler, native bridge and CLI remain real.
  await evaluate(`window.__alerts=[]; window.alert=m=>__alerts.push(m); window.__prompts=[]; window.prompt=()=>__prompts.shift(); window.__confirm=true; window.confirm=()=>__confirm;`);
  await evaluate(`MDViewer.app.getPort('files').switchFile(0)`);
  assert.equal(await evaluate('MDViewer.app.getPort("files").getActiveFile().desktopPath'), local);
  assert.equal(await evaluate('getComputedStyle(document.getElementById("desktopLarkSyncBtn")).display !== "none"'), true);
  assert.equal(await evaluate('MDViewer.app.getPort("files").listFiles().length'), 2, 'Isolated profile should not restore user documents');
  async function sync(direction, url = 'https://test.feishu.cn/docx/test') {
    return evaluate(`(async()=>{ const d=document.getElementById('larkSyncDialog');if(d.open)d.close();document.getElementById('desktopLarkSyncBtn').click();document.getElementById('larkSyncUrl').value=${JSON.stringify(url)};const b=document.getElementById(${JSON.stringify(direction === 'push' ? 'larkSyncPush' : 'larkSyncPull')});b.click();for(let i=0;i<150 && b.disabled;i++)await new Promise(r=>setTimeout(r,100));if(b.disabled)throw Error('Sync did not finish');const s=document.getElementById('larkSyncStatus');return s.hidden?[]:[s.textContent];})()`);
  }
  const initial = await sync('push');
  assert.ok(initial.some(a => a.includes('同步成功')), JSON.stringify(initial));
  assert.equal(JSON.parse(await readFile(remote, 'utf8')).content, '# 本地初始\n\n正文');
  console.log('PASS UI upload via native bridge + Unicode local path');
  await remoteContent(3, '# 远端更新');
  assert.ok((await sync('push')).some(a => a.includes('同步冲突')));
  assert.equal(JSON.parse(await readFile(remote, 'utf8')).content, '# 远端更新');
  console.log('PASS remote revision conflict refuses upload');
  assert.ok((await sync('pull')).some(a => a.includes('同步成功')));
  assert.equal(await readFile(local, 'utf8'), '# 远端更新');
  assert.equal(await evaluate('MDViewer.app.getPort("editor").getContent({flush:true})'), '# 远端更新');
  const backups = (await readdir(temp)).filter(n => n.includes('.lark-backup-'));
  assert.equal(backups.length, 1);
  assert.equal(await readFile(path.join(temp, backups[0]), 'utf8'), '# 本地初始\n\n正文');
  console.log('PASS pull, backup content, editor reload');
  await evaluate(`(()=>{const e=MDViewer.app.getPort('editor');if(e.getViewMode()!=='source')e.toggleSource();const s=document.getElementById('sourceEditor');s.value='# 未保存';s.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  assert.ok((await sync('push')).some(a => a.includes('先保存')));
  assert.equal(await readFile(local, 'utf8'), '# 远端更新');
  console.log('PASS unsaved editor blocks sync');
  await evaluate(`MDViewer.app.getPort('files').reloadFile()`);
  assert.ok((await sync('pull', 'https://example.com/docx/test')).some(a => a.includes('有效的飞书')));
  console.log('PASS invalid URL rejected by native host');
  await evaluate(`__confirm=false`);
  assert.deepEqual(await sync('pull'), []);
  await evaluate(`__confirm=true`);
  assert.equal((await readdir(temp)).filter(n => n.includes('.lark-backup-')).length, 1);
  console.log('PASS cancelled sync makes no backup or write');
  for (const mode of ['failure', 'malformed', 'missing', 'expired']) {
    await remoteContent(4, '# Failure should not overwrite', mode);
    const result = await sync('pull');
    assert.ok(result.some(a => a.includes('同步失败')), JSON.stringify(result));
    assert.equal(await readFile(local, 'utf8'), '# 远端更新');
    assert.equal(await evaluate('document.getElementById("larkSyncPull").disabled'), false);
    assert.ok(!result.join('').includes('CLIXML') && !result.join('').includes('<Objs>') && !result.join('').includes('secret'));
    if (mode === 'missing') assert.ok(result[0].includes('未找到 lark-cli'));
    if (mode === 'expired') assert.ok(result[0].includes('登录已过期'));
  }
  console.log('PASS concise missing CLI / expired auth / permission failures without raw logs');
  if (process.env.MDVIEWER_PREVIEW_DIR) {
    await remoteContent(4, '# Preview only', 'missing');
    await sync('pull');
    async function cdp(method, params) {
      const requestId = ++id;
      const response = new Promise(resolve => pending.set(requestId, resolve));
      ws.send(JSON.stringify({ id: requestId, method, params }));
      const msg = await response;
      assert.ok(!msg.error, JSON.stringify(msg));
      return msg.result;
    }
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1200, height: 1100, deviceScaleFactor: 1, mobile: false });
    await (await import('node:fs/promises')).mkdir(process.env.MDVIEWER_PREVIEW_DIR, { recursive: true });
    for (const [name, open] of [['failure', false], ['authorization', true]]) {
      await evaluate(`document.getElementById('larkAuthHelp').open=${open};document.getElementById('larkSyncDialog').scrollTop=0`);
      await new Promise(r => setTimeout(r, 150));
      const clip = await evaluate(`(()=>{const r=document.getElementById('larkSyncDialog').getBoundingClientRect();return {x:r.x-12,y:r.y-12,width:r.width+24,height:r.height+24,scale:1};})()`);
      const shot = await cdp('Page.captureScreenshot', { format: 'png', clip });
      await writeFile(path.join(process.env.MDVIEWER_PREVIEW_DIR, name + '.png'), Buffer.from(shot.data, 'base64'));
    }
    console.log('PASS captured latest desktop dialog previews');
  }
  // Native authorization boundary, no handler bypass to file access.
  assert.equal(await evaluate(`(async()=>{ const id='test-unauthorized'; const response=new Promise(resolve=>{const fn=e=>{if(e.data.id===id){chrome.webview.removeEventListener('message',fn);resolve(e.data)}};chrome.webview.addEventListener('message',fn)});chrome.webview.postMessage({kind:'request',id,action:'lark-sync',path:${JSON.stringify(path.join(temp, 'not-authorized.md'))},url:'https://test.feishu.cn/docx/test',direction:'pull'});return (await response).ok;})()`), false);
  console.log('PASS native unauthorized file path rejected');
  await remoteContent(4, '# Slow remote', 'delay');
  const slow = evaluate(`(async()=>{document.getElementById('larkSyncDialog').close();document.getElementById('desktopLarkSyncBtn').click();document.getElementById('larkSyncUrl').value='https://test.feishu.cn/docx/test';document.getElementById('larkSyncPull').click();await new Promise(r=>setTimeout(r,300));const e=MDViewer.app.getPort('editor');if(e.getViewMode()!=='source')e.toggleSource();const s=document.getElementById('sourceEditor');s.value='# 期间新改动';s.dispatchEvent(new Event('input',{bubbles:true}));__confirm=false;for(let i=0;i<150 && document.getElementById('larkSyncPull').disabled;i++)await new Promise(r=>setTimeout(r,100));return {content:MDViewer.app.getPort('editor').getContent({flush:true}),alerts:__alerts};})()`);
  const slowResult = await slow;
  assert.equal(slowResult.content, '# 期间新改动');
  assert.equal(await readFile(local, 'utf8'), '# Slow remote');
  console.log('PASS edits during download survive declined reload');
  await evaluate(`(async()=>{__confirm=true; await MDViewer.app.getPort('files').reloadFile();})()`);
  // Regression: source editing and actual desktop save.
  await evaluate(`(async()=>{const e=MDViewer.app.getPort('editor');if(e.getViewMode()!=='source')e.toggleSource();const s=document.getElementById('sourceEditor');s.value+='\\n\\n## 保存验证';s.dispatchEvent(new Event('input',{bubbles:true}));await MDViewer.app.getPort('files').saveFile();})()`);
  assert.ok((await readFile(local, 'utf8')).endsWith('## 保存验证'));
  console.log('PASS source edit + desktop save regression');
  await evaluate(`window.close()`);
} finally {
  ws?.close();
  if (app && app.exitCode === null) {
    await new Promise(r => setTimeout(r, 500));
    if (app.exitCode === null) execFileSync('taskkill.exe', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' });
  }
  if (previousTrusted) await writeFile(trusted, previousTrusted); else await rm(trusted, { force: true });
  await rm(baseline, { force: true });
  await rm(baseline + '.tmp', { force: true });
  // WebView2 descendants can take a moment to release profile handles.
  await rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}
