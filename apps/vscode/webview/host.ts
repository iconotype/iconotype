import type { Bytes, Host } from '@iconotype/core-host'

interface VsCodeApi { postMessage(msg: unknown): void; getState(): unknown; setState(s: unknown): void }
declare function acquireVsCodeApi(): VsCodeApi

let api: VsCodeApi | null | undefined
export const vscodeApi = (): VsCodeApi | null => {
  if (api === undefined) api = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null
  return api
}

/** RPC over postMessage; fs calls are served by the extension host. */
let seq = 0
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
window.addEventListener('message', (e: MessageEvent) => {
  const m = e.data as { type?: string; id?: number; result?: unknown; error?: string }
  if (m?.type !== 'rpc:result' || m.id === undefined) return
  const p = pending.get(m.id)
  if (!p) return
  pending.delete(m.id)
  m.error ? p.reject(new Error(m.error)) : p.resolve(m.result)
})

const call = <T,>(method: string, ...args: unknown[]): Promise<T> =>
  new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
    vscodeApi()?.postMessage({ type: 'rpc', id, method, args })
  })

export function createWebviewHost(): Host {
  /**
   * CONSTRAINT 4 — relative fetch() 403s inside a webview: relative URLs resolve
   * against the vscode-webview:// origin, not the extension folder. The extension
   * injects <meta name="asset-base"> and everything loads from there.
   */
  const assetBase = document.querySelector<HTMLMetaElement>('meta[name=asset-base]')?.content ?? ''
  const dec = new TextDecoder()

  return {
    name: 'vscode',
    capabilities: { realFs: true, watch: true, saveDialog: true },
    assetBase: () => assetBase,
    fs: {
      async read(path) { return new Uint8Array(await call<number[]>('fs.read', path)) as Bytes },
      async readText(path) { return dec.decode(await this.read(path)) },
      async write(path, data) { await call('fs.write', path, typeof data === 'string' ? data : [...data]) },
      list: (path) => call('fs.list', path),
      remove: (path) => call('fs.remove', path),
      exists: (path) => call('fs.exists', path),
    },
    pickFiles: (opts) => call('pickFiles', opts),
    saveAs: (name, data) => call('saveAs', name, typeof data === 'string' ? data : [...data]),
    clipboard: { readText: () => call('clipboard.read'), writeText: (t) => call('clipboard.write', t) },
  }
}
