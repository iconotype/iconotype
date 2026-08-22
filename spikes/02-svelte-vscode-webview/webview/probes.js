// Every capability core-* needs inside a VSCode webview, probed at runtime.
const probe = async (name, fn) => {
  try { const detail = await fn(); return { name, ok: true, detail: detail ?? '' } }
  catch (e) { return { name, ok: false, detail: e.message } }
}

export async function runProbes() {
  return Promise.all([
    probe('theme CSS vars', () => {
      const v = getComputedStyle(document.documentElement).getPropertyValue('--vscode-editor-background').trim()
      if (!v) throw new Error('--vscode-editor-background empty')
      return v
    }),
    probe('theme kind attribute', () => {
      const k = document.body.dataset.vscodeThemeKind || document.body.className
      if (!k) throw new Error('no theme kind on body')
      return k
    }),
    probe('external stylesheet loaded (CSP style-src)', () => {
      const bg = getComputedStyle(document.querySelector('button')).backgroundColor
      if (!bg || bg === 'rgba(0, 0, 0, 0)') throw new Error('component CSS not applied')
      return bg
    }),
    probe('svelte transition runs under strict style-src', async () => {
      await new Promise(r => requestAnimationFrame(r))
      const el = document.querySelector('ul')
      const anims = el ? el.getAnimations().length : 0
      const injected = [...document.querySelectorAll('style')].some(s => /svelte-|@keyframes/.test(s.textContent || ''))
      return `WAAPI animations=${anims}, runtime <style> injected=${injected}` +
        (injected ? " → needs style-src 'unsafe-inline'" : ' → no unsafe-inline needed')
    }),
    probe('data: URI image (glyph previews)', () => new Promise((res, rej) => {
      const img = new Image()
      img.onload = () => res(`${img.width}x${img.height}`)
      img.onerror = () => rej(new Error('blocked by img-src'))
      img.src = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16"/></svg>')
    })),
    probe('blob: URL image', () => new Promise((res, rej) => {
      const url = URL.createObjectURL(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8"/></svg>'], { type: 'image/svg+xml' }))
      const img = new Image()
      img.onload = () => res('ok'); img.onerror = () => rej(new Error('blocked by img-src blob:'))
      img.src = url
    })),
    probe('WebAssembly (woff2-encoder needs this)', async () => {
      // minimal valid wasm module: (module (func (export "f") (result i32) i32.const 42))
      const bytes = new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,127,3,2,1,0,7,5,1,1,102,0,0,10,6,1,4,0,65,42,11])
      const { instance } = await WebAssembly.instantiate(bytes)
      const v = instance.exports.f()
      if (v !== 42) throw new Error('bad result ' + v)
      return "ok → CSP needs 'wasm-unsafe-eval'"
    }),
    probe('OffscreenCanvas (PNG export)', () => {
      const c = new OffscreenCanvas(8, 8); const ctx = c.getContext('2d')
      ctx.fillRect(0, 0, 8, 8)
      return typeof c.convertToBlob === 'function' ? 'ok' : 'no convertToBlob'
    }),
    probe('Web Worker from blob (offload font build)', () => new Promise((res, rej) => {
      try {
        const url = URL.createObjectURL(new Blob(['self.onmessage=e=>self.postMessage(e.data*2)'], { type: 'text/javascript' }))
        const w = new Worker(url)
        const to = setTimeout(() => rej(new Error('worker timeout (worker-src?)')), 2500)
        w.onmessage = (e) => { clearTimeout(to); w.terminate(); res('echo ' + e.data) }
        w.onerror = (e) => { clearTimeout(to); rej(new Error('worker blocked: ' + (e.message || 'unknown'))) }
        w.postMessage(21)
      } catch (e) { rej(e) }
    })),
    probe('localStorage', () => { localStorage.setItem('k', '1'); return 'available: ' + localStorage.getItem('k') }),
    probe('IndexedDB', () => (typeof indexedDB !== 'undefined' ? 'available' : (() => { throw new Error('absent') })())),
    probe('OPFS (navigator.storage.getDirectory)', async () => {
      if (!navigator.storage?.getDirectory) throw new Error('absent — Host adapter must use extension fs')
      const d = await navigator.storage.getDirectory(); return 'root: ' + d.name
    }),
    probe('fetch() relative URL (expected to fail in webview)', async () => {
      const r = await fetch('./probe-asset.json')
      if (!r.ok) throw new Error('status ' + r.status + ' — relative URLs are NOT extension resources')
      return 'unexpectedly ok'
    }),
    probe('fetch() via asWebviewUri base (wasm/font loading)', async () => {
      const base = document.querySelector('meta[name=asset-base]')?.content
      if (!base) throw new Error('no asset-base meta (running outside vscode)')
      const r = await fetch(base + '/probe-asset.json')
      if (!r.ok) throw new Error('status ' + r.status)
      return JSON.stringify(await r.json())
    }),
    probe('structuredClone (op log transfer)', () => (structuredClone({ a: new Uint8Array([1, 2, 3]) }).a.length === 3 ? 'ok' : 'bad')),
  ])
}
