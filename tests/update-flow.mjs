import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

async function scenario({ consent = true, downloadError = false, installError = false } = {}) {
  let receive;
  const actions = [], alerts = [];
  const button = { style: {}, disabled: false, textContent: '', addEventListener(_, fn) { this.click = fn; } };
  const window = {
    chrome: { webview: {
      addEventListener(_, fn) { receive = fn; },
      postMessage(message) {
        if (message.kind !== 'request') return;
        actions.push(message.action);
        queueMicrotask(() => {
          if (message.action === 'download-update') receive({ data: { kind: 'update-download-progress', percent: 100 } });
          const error = message.action === 'download-update' && downloadError ? '校验失败' : message.action === 'install-update' && installError ? '请先保存文档' : null;
          receive({ data: { kind: 'response', id: message.id, ok: !error, error,
            data: message.action === 'check-updates' ? { version: '9.0.0', url: 'https://example.com' } : {} } });
          if (message.action === 'install-update') receive({ data: { kind: 'update-download-progress', percent: 100 } });
        });
      }
    } },
    confirm: () => consent, alert: text => alerts.push(text), setTimeout: () => 1, clearTimeout() {}
  };
  const document = { body: { classList: { add() {} } }, getElementById: id => id === 'desktopCheckUpdatesBtn' ? button : null };
  vm.runInNewContext(fs.readFileSync('js/desktop.js', 'utf8'), { window, document, console });
  window.MDViewer.Desktop.start({ state: { get: () => true }, on() {}, getPort: () => ({ getActiveFile: () => null, hasUnsavedChanges: () => false }) });
  const settle = () => new Promise(resolve => setImmediate(resolve));
  button.click();
  await settle();
  return { actions, alerts, button, settle };
}
const success = await scenario();
assert.deepEqual(success.actions, ['check-updates', 'download-update', 'install-update']);
assert.equal(success.button.textContent, '准备安装…');
assert.equal(success.button.disabled, true);
const blocked = await scenario({ installError: true });
assert.equal(blocked.button.textContent, '安装 9.0.0');
assert.equal(blocked.button.disabled, false);
assert.match(blocked.alerts[0], /请先保存/);
blocked.button.click();
await blocked.settle();
assert.equal(blocked.actions.filter(a => a === 'download-update').length, 1);
assert.equal(blocked.actions.filter(a => a === 'install-update').length, 2);
assert.deepEqual((await scenario({ consent: false })).actions, ['check-updates']);
assert.deepEqual((await scenario({ downloadError: true })).actions, ['check-updates', 'download-update']);
console.log('PASS: automatic install, late progress, blocked-install retry, cancellation, verification failure (mock bridge; no real installation).');
