import {
  BaseDirectory, exists as fsExists, mkdir, readDir, readFile, readTextFile, remove as fsRemove,
  watch as fsWatch, writeFile, writeTextFile,
} from '@tauri-apps/plugin-fs'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager'
import { appDataDir, basename, join } from '@tauri-apps/api/path'
import type { Bytes, Disposable, FileEntry, Host } from './index.js'

/**
 * Desktop host: a real filesystem, native dialogs, and file watching.
 *
 * Two kinds of path arrive here. Relative ones ("projects/x/project.json") are the
 * app's own storage and are resolved inside the app data directory — the same layout
 * the web host keeps in OPFS, so `persistence.ts` does not care which it is talking to.
 * Absolute ones come from a dialog and are used as given: opening a project from
 * anywhere on disk is the point of a desktop build.
 */

/** Windows drive letters count too, or every C:\… path would land in app data. */
export const isAbsolutePath = (path: string): boolean =>
  path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)

/**
 * Relative paths are scoped to the app data dir; the plugin does that for us.
 *
 * Exported because this one decision separates "the app's own storage" from "a file
 * the user picked", and getting it backwards would either scatter project files across
 * the user's disk or make an opened file unwritable.
 */
export const scope = (path: string): { baseDir?: BaseDirectory } =>
  isAbsolutePath(path) ? {} : { baseDir: BaseDirectory.AppData }

const parent = (path: string) => path.replace(/\/+$/, '').split('/').slice(0, -1).join('/')

export function createTauriHost(): Host {
  const enc = new TextEncoder()

  const ensureDir = async (path: string) => {
    const dir = parent(path)
    if (!dir) return
    try {
      await mkdir(dir, { recursive: true, ...scope(path) })
    } catch {
      // already there, or the parent of an absolute path we do not own
    }
  }

  return {
    name: 'desktop',
    capabilities: { realFs: true, watch: true, saveDialog: true },
    /**
     * The window's own origin. Tauri serves the bundle from `tauri://localhost` (and
     * `http://tauri.localhost` on Windows), so a relative asset URL is correct here —
     * unlike in a VSCode webview, which is what `assetBase` exists for.
     */
    assetBase: () => new URL('./', location.href).href,
    sampleProjectUrl: () => new URL('./sample/alpimaps.json', location.href).href,

    fs: {
      async read(path) {
        return await readFile(path, scope(path)) as Bytes
      },
      async readText(path) {
        return await readTextFile(path, scope(path))
      },
      async write(path, data) {
        await ensureDir(path)
        if (typeof data === 'string') await writeTextFile(path, data, scope(path))
        else await writeFile(path, data, scope(path))
      },
      async list(path): Promise<FileEntry[]> {
        const entries = await readDir(path, scope(path))
        return entries.map((e) => ({
          name: e.name,
          path: `${path.replace(/\/+$/, '')}/${e.name}`,
          kind: e.isDirectory ? 'directory' : 'file',
        }))
      },
      async remove(path) {
        await fsRemove(path, { recursive: true, ...scope(path) })
      },
      async exists(path) {
        try { return await fsExists(path, scope(path)) } catch { return false }
      },
      watch(path, cb): Disposable {
        // the plugin resolves its unwatch fn asynchronously; dispose has to wait for it
        const stopping = fsWatch(path, (event) => {
          const kind = typeof event.type === 'object' && event.type !== null
            ? Object.keys(event.type)[0] ?? 'change'
            : 'change'
          for (const changed of event.paths) {
            cb({
              type: kind.startsWith('create') ? 'create' : kind.startsWith('remove') ? 'delete' : 'change',
              path: changed,
            })
          }
        }, { recursive: true, ...scope(path) })
        return { dispose: () => { void stopping.then((stop) => stop()).catch(() => {}) } }
      },
    },

    async pickFiles(opts) {
      const selected = await openDialog({
        multiple: opts?.multiple ?? true,
        filters: opts?.accept?.length
          ? [{ name: 'Icon sources', extensions: opts.accept.map((a) => a.replace(/^\./, '')) }]
          : undefined,
      })
      if (!selected) return []
      const paths = Array.isArray(selected) ? selected : [selected]
      return await Promise.all(paths.map(async (path) => ({
        name: await basename(path),
        data: await readFile(path) as Bytes,
      })))
    },

    /** A real save dialog, not a download: the point of shipping a desktop build. */
    async saveAs(name, data) {
      const path = await saveDialog({ defaultPath: name })
      if (!path) return
      if (typeof data === 'string') await writeTextFile(path, data)
      else await writeFile(path, data)
    },

    clipboard: { readText: () => readText(), writeText: (t) => writeText(t) },
  }
}

/** Absolute path of the app's own project storage, for showing the user where it is. */
export const projectStorageDir = async (): Promise<string> => await join(await appDataDir(), 'projects')
