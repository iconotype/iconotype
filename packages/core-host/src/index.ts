/**
 * The ONLY per-target code in the app. web / tauri / vscode each supply one of these;
 * the UI never imports a host module directly, it receives a Host from Svelte context.
 */
/**
 * Byte payloads are pinned to an ArrayBuffer backing store. Since TS 5.7 a bare
 * Uint8Array is Uint8Array<ArrayBufferLike>, which could be SharedArrayBuffer-backed
 * and is therefore rejected by BlobPart / FileSystemWriteChunkType. Pinning here beats
 * casting at every call site.
 */
export type Bytes = Uint8Array<ArrayBuffer>

export interface FileEntry { name: string; path: string; kind: 'file' | 'directory' }
export interface Disposable { dispose(): void }
export type FsEvent = { type: 'create' | 'change' | 'delete'; path: string }

export interface HostFs {
  read(path: string): Promise<Bytes>
  readText(path: string): Promise<string>
  write(path: string, data: Bytes | string): Promise<void>
  list(path: string): Promise<FileEntry[]>
  remove(path: string): Promise<void>
  exists(path: string): Promise<boolean>
  watch?(path: string, cb: (e: FsEvent) => void): Disposable
}

export interface HostCapabilities {
  /** a real filesystem (tauri/vscode/node) vs a sandboxed one (OPFS) */
  realFs: boolean
  watch: boolean
  /** can offer a native save dialog rather than a browser download */
  saveDialog: boolean
}

export interface Host {
  name: 'web' | 'desktop' | 'vscode' | 'memory'
  fs: HostFs
  capabilities: HostCapabilities
  /**
   * Absolute base for runtime-loaded assets (wasm, fonts, icon data).
   *
   * CONSTRAINT 4 — a relative fetch() inside a VSCode webview 403s: relative URLs
   * resolve against the vscode-webview:// origin, not the extension folder. Every
   * host answers this question, and nothing in the app fetches without it.
   */
  assetBase(): string
  pickFiles(opts?: { accept?: string[]; multiple?: boolean }): Promise<Array<{ name: string; data: Bytes }>>
  saveAs(name: string, data: Bytes | string): Promise<void>
  clipboard: { readText(): Promise<string>; writeText(text: string): Promise<void> }
}

/** In-memory host — the default for tests and for the CLI's dry runs. */
export function createMemoryHost(seed: Record<string, string | Bytes> = {}): Host {
  const files = new Map<string, Bytes>()
  let clipboardText = ''
  const enc = new TextEncoder()
  const dec = new TextDecoder()
  for (const [k, v] of Object.entries(seed)) files.set(k, typeof v === 'string' ? enc.encode(v) : v)

  return {
    name: 'memory',
    capabilities: { realFs: false, watch: false, saveDialog: false },
    assetBase: () => '',
    fs: {
      async read(path) {
        const f = files.get(path)
        if (!f) throw new Error(`ENOENT: ${path}`)
        return f
      },
      async readText(path) { return dec.decode(await this.read(path)) },
      async write(path, data) { files.set(path, typeof data === 'string' ? enc.encode(data) : data) },
      async list(prefix) {
        const seen = new Set<string>()
        const out: FileEntry[] = []
        for (const path of files.keys()) {
          if (!path.startsWith(prefix)) continue
          const rest = path.slice(prefix.length).replace(/^\//, '')
          const head = rest.split('/')[0]!
          if (!head || seen.has(head)) continue
          seen.add(head)
          out.push({ name: head, path: `${prefix}/${head}`.replace(/\/+/g, '/'), kind: rest.includes('/') ? 'directory' : 'file' })
        }
        return out
      },
      async remove(path) { files.delete(path) },
      async exists(path) { return files.has(path) },
    },
    async pickFiles() { return [] },
    async saveAs(name, data) { files.set(name, typeof data === 'string' ? enc.encode(data) : data) },
    clipboard: {
      async readText() { return clipboardText },
      async writeText(t) { clipboardText = t },
    },
  }
}
