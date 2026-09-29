import * as vscode from 'vscode'
import type { IconFont, IconFontRegistry } from './registry.js'

/**
 * Dropping SVGs onto the sidebar.
 *
 * The same drop reaches us two ways: the Fonts tree gets a VS Code DataTransfer, and
 * the Icons grid — a webview — gets a DOM one it forwards as uris or file contents.
 * Both end in the same `add` call, so a drop does exactly what "Add Icons from SVG…"
 * does: one save, codepoints allocated, warnings in the output panel.
 */

/** Something to import: where it came from, and a way to read it. */
export interface SvgSource {
  name: string
  read(): Promise<string>
}

/** Directories never worth descending into when a folder is dropped. */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out'])
/** a dropped home directory should not turn into a ten-minute walk */
const MAX_FILES = 2000

export const isSvg = (path: string): boolean => /\.svg$/i.test(path)

/**
 * The SVGs behind a list of dropped uris. Folders are walked, because dragging an
 * icon folder in is the most natural way to add a set; anything that is not an SVG
 * is skipped rather than reported, since a folder of icons usually has a README.
 */
export async function svgsIn(uris: readonly vscode.Uri[]): Promise<vscode.Uri[]> {
  const out: vscode.Uri[] = []
  const visit = async (uri: vscode.Uri, depth: number): Promise<void> => {
    if (out.length >= MAX_FILES) return
    let type: vscode.FileType
    try { type = (await vscode.workspace.fs.stat(uri)).type } catch { return }
    if (type & vscode.FileType.Directory) {
      if (depth > 8) return
      const entries = await vscode.workspace.fs.readDirectory(uri)
      entries.sort(([a], [b]) => a.localeCompare(b))
      for (const [name] of entries) {
        if (SKIP_DIRS.has(name) || name.startsWith('.')) continue
        await visit(vscode.Uri.joinPath(uri, name), depth + 1)
      }
      return
    }
    if (isSvg(uri.path)) out.push(uri)
  }
  for (const uri of uris) await visit(uri, 0)
  return out
}

export const fromUri = (uri: vscode.Uri): SvgSource => ({
  name: uri.path.split('/').pop()!,
  read: async () => new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)),
})

/** `text/uri-list`: one uri per line, `#` lines are comments. */
export const parseUriList = (text: string): vscode.Uri[] =>
  text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).flatMap((l) => {
    try { return [vscode.Uri.parse(l, true)] } catch { return [] }
  })

type Node = { font?: IconFont }

/** Drop SVG files or folders from the Explorer (or the OS) onto a font in the tree. */
export class FontTreeDropController implements vscode.TreeDragAndDropController<Node> {
  readonly dropMimeTypes = ['text/uri-list', 'files']
  readonly dragMimeTypes: string[] = []

  constructor(
    private registry: IconFontRegistry,
    private pickFont: () => Promise<IconFont | undefined>,
    private add: (font: IconFont, sources: SvgSource[]) => Promise<void>,
  ) {}

  async handleDrop(target: Node | undefined, data: vscode.DataTransfer): Promise<void> {
    const uris: vscode.Uri[] = []
    const files: SvgSource[] = []
    const list = await data.get('text/uri-list')?.asString()
    if (list) uris.push(...parseUriList(list))
    data.forEach((item) => {
      const file = item.asFile()
      if (!file) return
      // a file with a uri is one we can stat (and walk, if it is a folder)
      if (file.uri) { if (!uris.some((u) => u.toString() === file.uri!.toString())) uris.push(file.uri) }
      else if (isSvg(file.name)) files.push({ name: file.name, read: async () => new TextDecoder().decode(await file.data()) })
    })

    const sources = [...(await svgsIn(uris)).map(fromUri), ...files]
    if (!sources.length) {
      vscode.window.showWarningMessage('Iconotype: nothing to add — drop .svg files or a folder of them.')
      return
    }
    // dropped on an icon row means its font; on empty space, ask
    const font = (target?.font && this.registry.get(target.font.uri)) || await this.pickFont()
    if (font) await this.add(font, sources)
  }
}
