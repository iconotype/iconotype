import type { Bytes, Host, FileEntry } from './index.js'

/** Browser host: OPFS for project storage, downloads for export. */
export function createWebHost(assetBase = '/'): Host {
  const enc = new TextEncoder()
  const dec = new TextDecoder()

  const dir = async (path: string, create = false) => {
    let handle = await navigator.storage.getDirectory()
    for (const part of path.split('/').filter(Boolean)) handle = await handle.getDirectoryHandle(part, { create })
    return handle
  }
  const split = (path: string) => {
    const parts = path.split('/').filter(Boolean)
    return { dirPath: parts.slice(0, -1).join('/'), file: parts.at(-1)! }
  }

  return {
    name: 'web',
    capabilities: { realFs: false, watch: false, saveDialog: false },
    assetBase: () => assetBase,
    fs: {
      async read(path) {
        const { dirPath, file } = split(path)
        const fh = await (await dir(dirPath)).getFileHandle(file)
        return new Uint8Array(await (await fh.getFile()).arrayBuffer()) satisfies Bytes
      },
      async readText(path) { return dec.decode(await this.read(path)) },
      async write(path, data) {
        const { dirPath, file } = split(path)
        const fh = await (await dir(dirPath, true)).getFileHandle(file, { create: true })
        const w = await fh.createWritable()
        // Blob rather than the raw view: Uint8Array<ArrayBufferLike> is not assignable
        // to FileSystemWriteChunkType (it could be backed by a SharedArrayBuffer)
        await w.write(new Blob([typeof data === 'string' ? enc.encode(data) : data]))
        await w.close()
      },
      async list(path) {
        const out: FileEntry[] = []
        const handle = await dir(path)
        for await (const [name, h] of (handle as unknown as AsyncIterable<[string, FileSystemHandle]>)) {
          out.push({ name, path: `${path}/${name}`.replace(/\/+/g, '/'), kind: h.kind === 'directory' ? 'directory' : 'file' })
        }
        return out
      },
      async remove(path) {
        const { dirPath, file } = split(path)
        await (await dir(dirPath)).removeEntry(file, { recursive: true })
      },
      async exists(path) {
        try { await this.read(path); return true } catch { return false }
      },
    },
    async pickFiles(opts) {
      return new Promise((resolve) => {
        const input = document.createElement('input')
        input.type = 'file'
        input.multiple = opts?.multiple ?? true
        if (opts?.accept) input.accept = opts.accept.join(',')
        input.onchange = async () => {
          const files = [...(input.files ?? [])]
          resolve(await Promise.all(files.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) as Bytes }))))
        }
        input.click()
      })
    },
    async saveAs(name, data) {
      const blob = new Blob([typeof data === 'string' ? data : data])
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.click()
      URL.revokeObjectURL(url)
    },
    clipboard: {
      readText: () => navigator.clipboard.readText(),
      writeText: (t) => navigator.clipboard.writeText(t),
    },
  }
}
