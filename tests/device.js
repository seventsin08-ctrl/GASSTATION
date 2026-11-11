// Talks to the app running on an Android device/emulator through the WebView debug port (debug builds only).
//   adb forward tcp:9222 localabstract:webview_devtools_remote_$(adb shell pidof com.gasstation.manager)
//   node tests/device.js "<javascript expression>"      (the expression may return a Promise)
const http = require('http');
function targets() { return new Promise((res, rej) => http.get('http://localhost:9222/json', (r) => { let d = ''; r.on('data', (c) => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej)); }
async function evaluate(expr) {
  const t = (await targets()).filter((x) => x.type === 'page')[0];
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const out = await new Promise((res) => {
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id === 1) res(d.result); };
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: '(async () => (' + expr + '))().then((v) => JSON.stringify(v === undefined ? null : v))', awaitPromise: true, returnByValue: true, userGesture: true } }));
  });
  ws.close();
  if (out.exceptionDetails) throw new Error(JSON.stringify(out.exceptionDetails.exception || out.exceptionDetails));
  return JSON.parse(out.result.value);
}
module.exports = { evaluate };
if (require.main === module) evaluate(process.argv[2]).then((v) => { console.log(JSON.stringify(v, null, 1)); process.exit(0); }, (e) => { console.error('ERROR', e.message); process.exit(1); });
