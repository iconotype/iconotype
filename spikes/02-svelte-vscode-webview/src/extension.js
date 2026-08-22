const vscode = require('vscode')
const fs = require('fs')
const path = require('path')

const nonce = () => [...Array(32)].map(() => Math.random().toString(36)[2]).join('')

/** Strict-first CSP. Each relaxation below is a spike finding, not a default. */
function csp(webview, n, mode) {
  const s = webview.cspSource
  const strict = [
    `default-src 'none'`,
    `img-src ${s} data: blob:`,
    `style-src ${s}`,                       // no 'unsafe-inline' — does Svelte survive?
    `script-src 'nonce-${n}'`,              // no 'wasm-unsafe-eval' — does wasm survive?
    `font-src ${s}`,
    `connect-src ${s}`,
  ]
  const relaxed = [
    `default-src 'none'`,
    `img-src ${s} data: blob:`,
    `style-src ${s} 'unsafe-inline'`,
    `script-src 'nonce-${n}' 'wasm-unsafe-eval'`,
    `font-src ${s}`,
    `connect-src ${s} blob: data:`,
    `worker-src blob:`,
  ]
  return (mode === 'strict' ? strict : relaxed).join('; ') + ';'
}

function html(webview, root, mode) {
  const n = nonce()
  const dist = vscode.Uri.joinPath(root, 'dist', 'webview')
  let h = fs.readFileSync(path.join(dist.fsPath, 'index.html'), 'utf8')
  // rewrite ./assets/x → vscode-webview resource URI
  h = h.replace(/(src|href)="\.\/([^"]+)"/g, (_, attr, p) =>
    `${attr}="${webview.asWebviewUri(vscode.Uri.joinPath(dist, ...p.split('/')))}"`)
  // nonce every script tag
  h = h.replace(/<script /g, `<script nonce="${n}" `)
  h = h.replace('<!--CSP-->', `<meta http-equiv="Content-Security-Policy" content="${csp(webview, n, mode)}">`
    // relative URLs do NOT resolve to extension resources — hand the app an absolute base
    + `\n<meta name="asset-base" content="${webview.asWebviewUri(dist)}">`)
  return h
}

function open(context, mode) {
  const panel = vscode.window.createWebviewPanel('spike', `Spike (${mode})`, vscode.ViewColumn.One, {
    enableScripts: true,
    localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview')],
    retainContextWhenHidden: true,
  })
  panel.webview.html = html(panel.webview, context.extensionUri, mode)
  return panel
}

function activate(context) {
  context.subscriptions.push(vscode.commands.registerCommand('spike.open', () => open(context, 'relaxed')))
  // whatever activate() RETURNS becomes extension.exports — that is the test seam
  return { openPanel: (mode) => open(context, mode) }
}

module.exports = { activate, deactivate() {} }
