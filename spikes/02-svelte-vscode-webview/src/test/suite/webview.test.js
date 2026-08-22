const assert = require('assert')
const vscode = require('vscode')

const waitFor = (panel, type, ms = 20000) => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error(`timeout waiting for "${type}"`)), ms)
  const d = panel.webview.onDidReceiveMessage(m => {
    if (m.type === type) { clearTimeout(t); d.dispose(); res(m) }
  })
})

const report = {}

async function runMode(mode) {
  const ext = vscode.extensions.getExtension('spike.spike-svelte-vscode-webview')
    || vscode.extensions.all.find(e => e.id.endsWith('spike-svelte-vscode-webview'))
  await ext.activate()
  const panel = ext.exports.openPanel(mode)
  const msg = await waitFor(panel, 'probes')
  // RPC host → webview → host
  panel.webview.postMessage({ type: 'ping', payload: 'hello-from-extension' })
  const pong = await waitFor(panel, 'pong', 8000)
  report[mode] = { results: msg.results, rpc: pong.echo }
  panel.dispose()
}

suite('svelte in vscode webview', function () {
  this.timeout(90000)

  test('relaxed CSP', async () => {
    await runMode('relaxed')
    const r = report.relaxed
    assert.strictEqual(r.rpc, 'hello-from-extension', 'RPC round-trip failed')
    const EXPECTED_FAIL = ['fetch() relative URL (expected to fail in webview)']
    const fails = r.results.filter(x => !x.ok && !EXPECTED_FAIL.includes(x.name))
    console.log('\n===== RELAXED CSP =====')
    r.results.forEach(x => console.log(` ${x.ok ? 'PASS' : 'FAIL'}  ${x.name.padEnd(52)} ${x.detail}`))
    console.log(` RPC   PASS  extension ⇄ webview round-trip`)
    assert.ok(fails.length === 0, 'failed probes: ' + fails.map(f => f.name).join(', '))
  })

  test('strict CSP (no unsafe-inline, no wasm-unsafe-eval)', async () => {
    await runMode('strict')
    const r = report.strict
    console.log('\n===== STRICT CSP =====')
    r.results.forEach(x => console.log(` ${x.ok ? 'PASS' : 'FAIL'}  ${x.name.padEnd(52)} ${x.detail}`))
    console.log('\n(strict is informational — failures here tell us which relaxations are mandatory)\n')
  })
})
